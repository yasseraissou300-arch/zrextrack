// Lancement d'une campagne WhatsApp — Phase 1 : ENFILEUR, plus exécuteur.
//
// AVANT : cette route bouclait sur N destinataires avec sleep(20-60 s) dans une
// seule requête HTTP. Elle déclarait maxDuration = 300 alors que Vercel Hobby
// plafonne à 60 s → la campagne mourait après ~2 envois, le reste était perdu.
//
// MAINTENANT : elle valide, passe la campagne en « en_cours », enfile UN job
// `campaign.dispatch` et répond en moins d'une seconde. Le dispatch enfourne
// les destinataires par lots, chacun devenant un job `whatsapp.send` espacé
// par run_after.
//
// Les protections anti-suspension sont INCHANGÉES : même plafond journalier
// partagé (table `messages`), même throttle 20-60 s, même variation de message,
// même circuit breaker — seul le mécanisme d'attente change (run_after au lieu
// de sleep). Aucune restriction WhatsApp n'est contournée.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';
import { effectiveDailyLimit, remainingDailyQuota } from '@/lib/whatsapp/anti-spam';
import { enqueue } from '@/lib/queue/repository';
import { campaignDispatchKey } from '@/lib/queue/idempotency';
import { logEvent } from '@/lib/security/safe-log';

// maxDuration = 300 retiré : la route ne fait plus d'envoi, elle enfile.
// Le défaut de 10 s suffit largement.

const DEFAULT_SERVICE = 'auto_confirmation';

interface Instance {
  instance_name: string;
  connected: boolean;
}

/**
 * Vérifie qu'une instance WhatsApp est réellement connectée avant d'enfiler
 * quoi que ce soit. Sans ce contrôle, on enfilerait des centaines de jobs
 * voués à l'échec — précisément le scénario qui a produit 532 471 lignes
 * d'erreur en production.
 */
async function getReadyInstance(
  userId: string,
  ev: { url: string; key: string }
): Promise<{ instance: Instance | null; reason?: string }> {
  if (!ev.url || !ev.key) {
    return {
      instance: null,
      reason: 'Evolution API non configurée (EVOLUTION_API_URL/KEY manquants)',
    };
  }

  const service = createServiceClient();
  const { data: row } = await service
    .from('whatsapp_instances')
    .select('instance_name, connected')
    .eq('user_id', userId)
    .eq('service_type', DEFAULT_SERVICE)
    .maybeSingle();

  if (!row) {
    return {
      instance: null,
      reason: "Aucune instance WhatsApp — connecte-toi d'abord dans Messages → Connexion",
    };
  }

  try {
    const r = await fetch(`${ev.url}/instance/connectionState/${row.instance_name}`, {
      headers: { apikey: ev.key },
    });
    if (r.ok) {
      const j = await r.json();
      const isOpen = (j.instance?.state || j.state) === 'open';
      if (!isOpen) {
        return {
          instance: null,
          reason: `WhatsApp non connecté (état : ${j.instance?.state || j.state || 'inconnu'})`,
        };
      }
    }
  } catch (e) {
    return {
      instance: null,
      reason: `Evolution injoignable : ${e instanceof Error ? e.message : 'erreur réseau'}`,
    };
  }

  return { instance: row as Instance };
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();

  // ── Campagne — scopée au tenant ───────────────────────────────────────────
  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (cErr || !campaign) {
    return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });
  }
  if (campaign.status === 'en_cours') {
    return NextResponse.json({ error: 'Campagne déjà en cours' }, { status: 400 });
  }

  // ── WhatsApp doit être connecté AVANT d'enfiler ───────────────────────────
  const ev = await resolveEvolutionCreds(user.id);
  const { instance, reason } = await getReadyInstance(user.id, ev);
  if (!instance) {
    return NextResponse.json(
      {
        error: reason || 'WhatsApp non prêt',
        code: 'NOT_CONNECTED',
        hint: 'Connecte ton WhatsApp dans Messages → Connexion avant de lancer la campagne.',
      },
      { status: 503 }
    );
  }

  // ── Plafond journalier — information, pas blocage ─────────────────────────
  // Le plafond est REVÉRIFIÉ à chaque envoi par le handler whatsapp.send.
  // Ici on informe seulement l'utilisateur de ce qui partira aujourd'hui.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count: sentToday }, { data: prof }] = await Promise.all([
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'envoye')
      .gte('sent_at', since),
    supabase.from('profiles').select('whatsapp_warmup_started_at').eq('id', user.id).maybeSingle(),
  ]);

  const warmupStartedAt = prof?.whatsapp_warmup_started_at ?? null;
  const dailyLimit = effectiveDailyLimit(warmupStartedAt);
  const remainingToday = remainingDailyQuota(sentToday ?? 0, warmupStartedAt);

  // ── Enfilement ────────────────────────────────────────────────────────────
  await supabase
    .from('campaigns')
    .update({ status: 'en_cours', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  await enqueue(supabase, {
    tenantId: user.id,
    type: 'campaign.dispatch',
    payload: { campaign_id: id, offset: 0 },
    idempotencyKey: campaignDispatchKey(id, 0),
  });

  logEvent('info', 'campaign.send', {
    tenant_id: user.id,
    conversation_id: id,
    status: 'enqueued',
  });

  return NextResponse.json({
    ok: true,
    queued: true,
    message:
      'Campagne mise en file. Les envois partent en arrière-plan, espacés pour protéger le numéro — tu peux fermer la page.',
    sentToday: sentToday ?? 0,
    dailyLimit,
    remainingToday,
  });
}
