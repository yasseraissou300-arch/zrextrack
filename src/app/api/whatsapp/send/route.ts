import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';
import { ANTI_SPAM, randomThrottle, sleep, varyMessage, remainingDailyQuota } from '@/lib/whatsapp/anti-spam';

// Envoie un message WhatsApp via Evolution API en utilisant l'instance
// « auto_confirmation » de l'utilisateur (la même que celle de l'onglet
// Connexion sur la page /messages).
//
// Cette route remplace l'ancien backend WhatsApp privé (WHATSAPP_BACKEND_URL)
// qui n'est plus déployé. Le résultat : ce que tu vois dans « Connexion »
// est exactement ce qui est utilisé pour envoyer — finis les 200 échecs
// silencieux dus à une desynchro entre le statut affiché et le backend
// réellement appelé.

const DEFAULT_SERVICE = 'auto_confirmation';

interface EvCreds { url: string; key: string }

function normalizePhone(phone: string): string {
  const clean = (phone || '').replace(/[\s\-()+.]/g, '');
  if (clean.startsWith('213')) return clean;
  if (clean.startsWith('00213')) return clean.slice(2);
  if (clean.startsWith('0')) return '213' + clean.slice(1);
  if (clean.length === 9) return '213' + clean;
  return clean;
}

interface Instance {
  instance_name: string;
  connected: boolean;
}

async function getReadyInstance(userId: string, ev: EvCreds): Promise<{ instance: Instance | null; reason?: string }> {
  if (!ev.url || !ev.key) {
    return { instance: null, reason: 'Evolution API non configurée (EVOLUTION_API_URL/KEY manquants)' };
  }
  const service = createServiceClient();
  const { data: row } = await service
    .from('whatsapp_instances')
    .select('instance_name, connected')
    .eq('user_id', userId)
    .eq('service_type', DEFAULT_SERVICE)
    .single();

  if (!row) return { instance: null, reason: 'Aucune instance WhatsApp pour cet utilisateur — connecte-toi d\'abord dans l\'onglet Connexion' };

  // Confirme l'état live (évite d'envoyer dans le vide si l'instance est tombée)
  try {
    const r = await fetch(`${ev.url}/instance/connectionState/${row.instance_name}`, {
      headers: { apikey: ev.key },
    });
    if (r.ok) {
      const j = await r.json();
      const isOpen = (j.instance?.state || j.state) === 'open';
      if (!isOpen) return { instance: null, reason: `WhatsApp non connecté (état Evolution : ${j.instance?.state || j.state || 'inconnu'})` };
    }
  } catch (e: any) {
    return { instance: null, reason: `Evolution injoignable : ${e?.message || 'erreur réseau'}` };
  }
  return { instance: row };
}

// « Connection Closed » est le pattern d'erreur Evolution quand son socket
// Baileys est mort en arrière-plan alors que connectionState dit encore « open ».
// On le détecte spécifiquement pour court-circuiter la boucle et afficher un
// message d'action clair au lieu de spammer 200 lignes du même error texte.
function isSessionDead(errText: string): boolean {
  return /Connection Closed/i.test(errText) || /Connection Failure/i.test(errText) || /precondition/i.test(errText);
}

async function sendOne(ev: EvCreds, instanceName: string, phone: string, text: string): Promise<{ ok: boolean; error?: string; sessionDead?: boolean }> {
  try {
    const res = await fetch(`${ev.url}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ev.key },
      body: JSON.stringify({ number: phone, text }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const dead = isSessionDead(errText);
      return {
        ok: false,
        error: dead
          ? 'Session WhatsApp expirée (Connection Closed) — reconnecte le QR'
          : `Evolution HTTP ${res.status}: ${errText.slice(0, 200)}`,
        sessionDead: dead,
      };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau Evolution' };
  }
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const body = await request.json();
  const { recipients } = body;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ error: 'Aucun destinataire' }, { status: 400 });
  }

  // BYOK : serveur Evolution de l'utilisateur (ou fallback plateforme)
  const ev = await resolveEvolutionCreds(user.id);

  // Pre-flight pour les envois en masse : on évite N tentatives ratées si
  // la session Evolution est tombée
  const { instance, reason } = await getReadyInstance(user.id, ev);
  if (!instance) {
    return NextResponse.json({
      error: reason || 'WhatsApp non prêt',
      code: 'NOT_CONNECTED',
      hint: 'Va dans l\'onglet Connexion et reconnecte WhatsApp avant de renvoyer.',
      sent: 0,
      failed: 0,
      results: [],
    }, { status: 503 });
  }

  // ── ANTI-SPAM : plafond journalier glissant ─────────────────────────────
  // On compte les envois RÉUSSIS des 24 dernières heures. Si on dépasse, on
  // refuse le batch entièrement plutôt que de risquer la suspension du numéro.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: sentToday } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'envoye')
    .gte('sent_at', since);

  const remaining = remainingDailyQuota(sentToday ?? 0);
  if (remaining <= 0) {
    return NextResponse.json({
      error: `Plafond journalier atteint (${ANTI_SPAM.DAILY_LIMIT} messages/24h)`,
      code: 'DAILY_LIMIT_REACHED',
      hint: 'Cette limite protège ton numéro WhatsApp d\'être suspendu pour spam. Attends que la fenêtre glissante de 24h se libère.',
      sent: 0,
      failed: 0,
      sentToday: sentToday ?? 0,
      dailyLimit: ANTI_SPAM.DAILY_LIMIT,
      results: [],
    }, { status: 429 });
  }
  // Si le batch dépasse le quota restant, on prévient et on coupe.
  const willSend = Math.min(recipients.length, remaining);
  const skippedForQuota = recipients.length - willSend;

  interface SendResult {
    tracking: string;
    client: string;
    status: 'envoye' | 'echec';
    error: string;
  }
  const results: SendResult[] = [];
  let sessionDeadDetected = false;
  let consecutiveErrors = 0;
  let circuitBroken = false;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const to = normalizePhone(r.whatsapp);
    let status: 'envoye' | 'echec' = 'echec';
    let errorMsg = '';

    if (i >= willSend) {
      errorMsg = `Quota journalier dépassé (${ANTI_SPAM.DAILY_LIMIT}/24h) — non envoyé`;
    } else if (!to || to.length < 11) {
      errorMsg = `Numéro invalide : "${r.whatsapp}"`;
    } else if (sessionDeadDetected) {
      errorMsg = 'Session WhatsApp expirée — annulé (reconnecte d\'abord)';
    } else if (circuitBroken) {
      errorMsg = `Circuit ouvert (${ANTI_SPAM.MAX_CONSECUTIVE_ERRORS} échecs consécutifs) — batch arrêté pour protéger le numéro`;
    } else {
      // Throttle entre 2 envois pour ne pas avoir un rythme robotique.
      // Seulement à partir du 2e envoi.
      if (results.some(x => x.status === 'envoye') || consecutiveErrors > 0) {
        await sleep(randomThrottle());
      }

      // Variation du message (emoji + zero-width space) pour éviter la
      // détection de doublons côté WhatsApp.
      const varied = recipients.length > 1 ? varyMessage(r.message || '') : (r.message || '');

      const send = await sendOne(ev, instance.instance_name, to, varied);
      if (send.ok) {
        status = 'envoye';
        consecutiveErrors = 0;
      } else {
        errorMsg = send.error || 'Echec envoi (raison inconnue)';
        consecutiveErrors++;
        if (send.sessionDead) {
          sessionDeadDetected = true;
          await supabase
            .from('whatsapp_instances')
            .update({ connected: false, updated_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('service_type', DEFAULT_SERVICE);
        }
        if (consecutiveErrors >= ANTI_SPAM.MAX_CONSECUTIVE_ERRORS) {
          circuitBroken = true;
        }
      }
    }

    await supabase.from('messages').insert({
      user_id: user.id,
      tracking_number: r.tracking || '',
      customer_name: r.client || '',
      customer_whatsapp: r.whatsapp || '',
      message: r.message || '',
      status,
      error_message: status === 'echec' ? errorMsg.slice(0, 500) : null,
      sent_at: new Date().toISOString(),
    });

    results.push({ tracking: r.tracking, client: r.client, status, error: errorMsg });
  }

  const sent = results.filter(r => r.status === 'envoye').length;
  const failed = results.filter(r => r.status === 'echec').length;
  return NextResponse.json({
    sent,
    failed,
    results,
    sentToday: (sentToday ?? 0) + sent,
    dailyLimit: ANTI_SPAM.DAILY_LIMIT,
    ...(skippedForQuota > 0 && { skippedForQuota }),
    ...(circuitBroken && {
      circuitBroken: true,
      hint: `Batch arrêté après ${ANTI_SPAM.MAX_CONSECUTIVE_ERRORS} échecs consécutifs pour protéger le numéro. Vérifie ta connexion et tes destinataires.`,
    }),
    ...(sessionDeadDetected && {
      sessionDead: true,
      hint: 'Session WhatsApp expirée côté Evolution. Va dans Connexion → Déconnecter → rescanne le QR, puis renvoie.',
    }),
  });
}
