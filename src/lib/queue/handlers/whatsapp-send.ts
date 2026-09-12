// Handler `whatsapp.send` — UN message, UNE tentative.
//
// C'est le handler le plus sensible de la plateforme : le numéro WhatsApp a
// déjà été banni définitivement une fois. Trois invariants le gouvernent.
//
// 1. LE PLAFOND EST VÉRIFIÉ À L'INSTANT DE L'ENVOI, jamais à l'enfilement.
//    Sinon 100 jobs enfilés le matin partiraient tous d'un coup dès que la
//    fenêtre de 24 h se libère — exactement le burst qui a causé le ban.
//
// 2. max_attempts = 1. Un envoi dont on ignore s'il est parti n'est JAMAIS
//    rejoué : le doublon est ce que l'algorithme anti-spam sanctionne.
//
// 3. UN ÉCHEC N'ÉCRIT RIEN DANS public.messages.
//    L'ancien code (sync-zrexpress:260) insérait une ligne à chaque tentative,
//    succès ou échec. Résultat mesuré : 532 471 lignes « echec » pour 45
//    messages réellement envoyés, 210 Mo, 42 % du quota Supabase.
//    Ici les échecs vivent dans autotim.jobs.last_error et la DLQ.
//
// Aucune restriction WhatsApp n'est contournée : le plafond, le warm-up et la
// variation de message restent ceux de lib/whatsapp/anti-spam, inchangés.

import { createServiceClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';
import { remainingDailyQuota, varyMessage } from '@/lib/whatsapp/anti-spam';
import { normalizePhone } from '@/lib/whatsapp/message-builder';
import { logEvent, maskPhone } from '@/lib/security/safe-log';
import { circuitState, afterFailure, afterSuccess } from '../circuit-breaker';
import { getTenantSettings, upsertTenantSettings } from '../repository';
import type { Job, HandlerResult, WhatsAppSendPayload } from '../types';

/** Report quand le quota est épuisé : on retente à la prochaine fenêtre utile. */
const QUOTA_RETRY_MS = 30 * 60_000;

export async function handleWhatsAppSend(job: Job): Promise<HandlerResult> {
  const supabase = createServiceClient();
  const payload = job.payload as unknown as WhatsAppSendPayload;
  const tenantId = job.tenant_id;

  if (!payload?.phone || !payload?.message) {
    return { outcome: 'failed', error: 'payload incomplet (phone ou message manquant)' };
  }

  // ── 1. Circuit breaker ────────────────────────────────────────────────────
  const settings = await getTenantSettings(supabase, tenantId);
  const circuit = circuitState(settings);
  if (circuit.open) {
    return {
      outcome: 'reschedule',
      runAfter: circuit.until ?? new Date(Date.now() + QUOTA_RETRY_MS),
      reason: `circuit ouvert (${circuit.failures} échecs consécutifs)`,
    };
  }

  // ── 2. Plafond journalier — AU MOMENT DE L'ENVOI ──────────────────────────
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count: sentToday }, { data: prof }] = await Promise.all([
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', tenantId)
      .eq('status', 'envoye')
      .gte('sent_at', since),
    supabase.from('profiles').select('whatsapp_warmup_started_at').eq('id', tenantId).maybeSingle(),
  ]);

  const warmupStartedAt = prof?.whatsapp_warmup_started_at ?? null;
  const remaining = remainingDailyQuota(sentToday ?? 0, warmupStartedAt);

  if (remaining <= 0) {
    // Ce n'est PAS un échec : c'est une attente légitime.
    // `reschedule` ne consomme aucune tentative → le job ne part pas en DLQ.
    return {
      outcome: 'reschedule',
      runAfter: new Date(Date.now() + QUOTA_RETRY_MS),
      reason: 'plafond journalier atteint',
    };
  }

  // ── 3. Numéro ─────────────────────────────────────────────────────────────
  const phone = normalizePhone(payload.phone);
  if (phone.length < 11) {
    return { outcome: 'failed', error: `numéro invalide : ${maskPhone(payload.phone)}` };
  }

  // ── 4. Instance Evolution ─────────────────────────────────────────────────
  const ev = await resolveEvolutionCreds(tenantId);
  if (!ev.url || !ev.key) {
    return { outcome: 'failed', error: 'Evolution API non configurée' };
  }

  const { data: inst } = await supabase
    .from('whatsapp_instances')
    .select('instance_name')
    .eq('user_id', tenantId)
    .eq('service_type', 'auto_confirmation')
    .maybeSingle();

  if (!inst?.instance_name) {
    return { outcome: 'failed', error: 'aucune instance WhatsApp connectée' };
  }

  // ── 5. Envoi ──────────────────────────────────────────────────────────────
  const varied = varyMessage(payload.message);
  let ok = false;
  let error = '';

  try {
    const endpoint = payload.media_url ? 'sendMedia' : 'sendText';
    const body = payload.media_url
      ? {
          number: phone,
          mediatype: guessMediaType(payload.media_url),
          media: payload.media_url,
          fileName: guessFileName(payload.media_url),
          caption: varied,
        }
      : { number: phone, text: varied };

    const res = await fetch(`${ev.url}/message/${endpoint}/${inst.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ev.key },
      body: JSON.stringify(body),
    });

    ok = res.ok;
    if (!ok) {
      const text = await res.text().catch(() => '');
      error = `Evolution HTTP ${res.status}: ${text.slice(0, 160)}`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'erreur réseau Evolution';
  }

  // ── 6. Comptabilisation ───────────────────────────────────────────────────
  if (ok) {
    // SUCCÈS : une ligne dans `messages` — elle alimente le compteur de quota.
    await supabase.from('messages').insert({
      user_id: tenantId,
      tracking_number: payload.tracking_number || '',
      customer_name: payload.customer_name || '',
      customer_whatsapp: payload.phone,
      message: payload.message,
      status: 'envoye',
      sent_at: new Date().toISOString(),
    });

    if (payload.notification_id) {
      await supabase
        .from('pending_notifications')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', payload.notification_id)
        .eq('user_id', tenantId); // scoping tenant explicite
    }

    if (payload.campaign_id) {
      await supabase.from('campaign_recipients').insert({
        campaign_id: payload.campaign_id,
        client: payload.customer_name || '',
        phone: payload.phone,
        tracking: payload.tracking_number || '',
        message: payload.message,
        status: 'envoye',
        sent_at: new Date().toISOString(),
      });
    }

    const reset = afterSuccess();
    await upsertTenantSettings(supabase, tenantId, {
      consecutive_send_failures: reset.failures,
      circuit_open_until: reset.openUntil,
    });

    logEvent('info', 'queue.whatsapp', {
      tenant_id: tenantId,
      contact: maskPhone(payload.phone),
      status: 'sent',
    });
    return { outcome: 'done' };
  }

  // ── ÉCHEC : AUCUNE écriture dans public.messages ──────────────────────────
  const next = afterFailure(settings?.consecutive_send_failures ?? 0);
  await upsertTenantSettings(supabase, tenantId, {
    consecutive_send_failures: next.failures,
    circuit_open_until: next.openUntil ? next.openUntil.toISOString() : null,
  });

  if (payload.notification_id) {
    await supabase
      .from('pending_notifications')
      .update({ status: 'failed', sent_at: new Date().toISOString() })
      .eq('id', payload.notification_id)
      .eq('user_id', tenantId);
  }

  logEvent('warn', 'queue.whatsapp', {
    tenant_id: tenantId,
    contact: maskPhone(payload.phone),
    status: 'failed',
    reason: error.slice(0, 160),
    error_code: next.openUntil ? 'circuit_opened' : undefined,
  });

  // max_attempts = 1 → part directement en DLQ, jamais rejoué.
  return { outcome: 'failed', error };
}

function guessMediaType(url: string): 'image' | 'video' | 'document' {
  const u = url.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/.test(u)) return 'image';
  if (/\.(mp4|3gp|mov)(\?|$)/.test(u)) return 'video';
  return 'document';
}

function guessFileName(url: string): string {
  try {
    return new URL(url).pathname.split('/').pop() || 'file';
  } catch {
    return 'file';
  }
}
