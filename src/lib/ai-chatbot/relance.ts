// Relance des conversations chatbot inactives (≥ 2 h, incomplètes).
//
// Extrait de src/app/api/ai-chatbot/relance/route.ts. Défauts corrigés
// (démontrés dans tests/ai-chatbot-relance.test.ts) :
//
// 1. PORTÉE : la route balayait TOUS les tenants, et le bouton « Lancer la
//    relance maintenant » l'appelait sans secret. Si CRON_SECRET est défini, le
//    bouton échoue toujours (401) ; s'il ne l'est pas, n'importe qui — y compris
//    un autre marchand — déclenche des WhatsApp depuis le numéro de TOUS les
//    marchands. Désormais : un utilisateur connecté ne relance que SES
//    sessions ; le balayage multi-tenant exige CRON_SECRET (refusé s'il n'est
//    pas configuré).
// 2. RAFALE : jusqu'à 50 envois enchaînés sans pause, hors plafond journalier
//    et hors journal `messages` (donc invisibles pour le quota). Désormais :
//    au plus UN envoi par tenant et par exécution, plafond + warm-up vérifiés,
//    espacement 20 s depuis le dernier envoi, et l'envoi est journalisé.
// 3. INSTANCE : `.eq('user_id').single()` sans service_type — échoue dès qu'un
//    marchand a deux instances (auto/sav/suivi), et relancerait une session SAV
//    depuis le numéro de confirmation. Désormais : instance du service de la
//    session.
// 4. DOUBLE ENVOI : lecture puis mise à jour de relance_sent ; deux exécutions
//    simultanées relançaient deux fois. Désormais : prise atomique.

import type { createServiceClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';
import { ANTI_SPAM, remainingDailyQuota } from '@/lib/whatsapp/anti-spam';
import { logEvent, maskPhone } from '@/lib/security/safe-log';

type Client = ReturnType<typeof createServiceClient>;

export const RELANCE_AFTER_MS = 2 * 60 * 60 * 1000;
export const RELANCE_SCAN_LIMIT = 50;

// Textes inchangés (décision produit — cf. rapport : formulation marocaine
// « dyalek / bghiti » alors que le prompt exige la darija algérienne).
export const RELANCE_MESSAGES: Record<string, string> = {
  auto_confirmation: `Salam 👋 Wach mazal bghiti tkmml commande dyalek? Kolchi 3endna rak, ghir 3tina isem w wilaya w produit 😊`,
  sav: `Salam, wach mazal 3andek mushkil? Hna ready nsa3dek — qul liya shu sir 🙏`,
  tracking: `Salam! Wach tqdar t3tini raqm l-colis dyalek bach nchefu statut? 📦`,
};

const SERVICE_TYPES = new Set(['auto_confirmation', 'sav', 'tracking']);

interface StaleSession {
  id: string;
  user_id: string;
  channel: string;
  contact_id: string;
  template_type: string | null;
}

export interface RelanceResult {
  relanced: number;
  skipped: Record<string, number>;
}

/**
 * @param tenantId  limite aux sessions de ce tenant (appel utilisateur) ;
 *                  undefined = tous les tenants (appel planifié authentifié).
 */
export async function runRelance(supabase: Client, tenantId?: string): Promise<RelanceResult> {
  const cutoff = new Date(Date.now() - RELANCE_AFTER_MS).toISOString();
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);

  let q = supabase
    .from('ai_chat_sessions')
    .select('id, user_id, channel, contact_id, template_type')
    .eq('is_complete', false)
    .eq('human_handover', false)
    .eq('relance_sent', false)
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(RELANCE_SCAN_LIMIT);
  if (tenantId) q = q.eq('user_id', tenantId);

  const { data: sessions } = await q;
  if (!sessions?.length) return { relanced: 0, skipped };

  const served = new Set<string>(); // un envoi max par tenant et par exécution
  let relanced = 0;

  for (const s of sessions as StaleSession[]) {
    if (s.channel !== 'whatsapp') continue;
    if (served.has(s.user_id)) {
      skip('one_per_tenant');
      continue;
    }

    const service = SERVICE_TYPES.has(s.template_type ?? '')
      ? (s.template_type as string)
      : 'auto_confirmation';

    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('instance_name, connected')
      .eq('user_id', s.user_id)
      .eq('service_type', service)
      .maybeSingle();
    if (!instance?.connected) {
      skip('instance_not_connected');
      continue;
    }

    // Plafond journalier (warm-up compris) + espacement, comme tout envoi.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - ANTI_SPAM.THROTTLE_MIN_MS).toISOString();
    const [{ count: sentToday }, { data: prof }, { count: sentRecently }] = await Promise.all([
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', s.user_id)
        .eq('status', 'envoye')
        .gte('sent_at', since),
      supabase
        .from('profiles')
        .select('whatsapp_warmup_started_at')
        .eq('id', s.user_id)
        .maybeSingle(),
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', s.user_id)
        .eq('status', 'envoye')
        .gte('sent_at', recent),
    ]);
    if (remainingDailyQuota(sentToday ?? 0, prof?.whatsapp_warmup_started_at ?? null) <= 0) {
      skip('daily_limit');
      continue;
    }
    if ((sentRecently ?? 0) > 0) {
      skip('spacing');
      continue;
    }

    // Prise atomique : une seule exécution relance cette session.
    const { data: claimed } = await supabase
      .from('ai_chat_sessions')
      .update({ relance_sent: true, updated_at: new Date().toISOString() })
      .eq('id', s.id)
      .eq('user_id', s.user_id)
      .eq('relance_sent', false)
      .select('id');
    if (!Array.isArray(claimed) || claimed.length !== 1) {
      skip('already_claimed');
      continue;
    }
    served.add(s.user_id);

    const ev = await resolveEvolutionCreds(s.user_id);
    const text = RELANCE_MESSAGES[service] ?? RELANCE_MESSAGES.auto_confirmation;
    const number = (s.contact_id || '').replace('@s.whatsapp.net', '').replace('@g.us', '');
    let ok = false;
    if (ev.url && ev.key) {
      try {
        const res = await fetch(`${ev.url}/message/sendText/${instance.instance_name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ev.key },
          body: JSON.stringify({ number, text }),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
    }

    if (ok) {
      // Journalisé : la relance compte dans le plafond journalier.
      await supabase.from('messages').insert({
        user_id: s.user_id,
        tracking_number: '',
        customer_name: '',
        customer_whatsapp: number,
        message: text,
        status: 'envoye',
        sent_at: new Date().toISOString(),
      });
      relanced++;
    } else {
      skip('send_failed'); // relance_sent reste true : jamais rejouée
    }
    logEvent(ok ? 'info' : 'warn', 'chatbot.relance', {
      tenant_id: s.user_id,
      contact: maskPhone(number),
      status: ok ? 'sent' : 'failed',
    });
  }

  return { relanced, skipped };
}
