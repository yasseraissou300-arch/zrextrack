// Drain de la file pending_notifications — chemin « client » du sync
// (/api/sync-zrexpress, appelé toutes les 5 min par CHAQUE onglet ouvert).
//
// Extrait de src/app/api/sync-zrexpress/route.ts pour être testable.
// Comportement inchangé (≤ DRAIN_PER_SYNC par appel, espacés, sous le plafond
// journalier warm-up compris) à UNE différence près :
//
// PRISE ATOMIQUE AVANT ENVOI. L'ancien code lisait les notifs « pending »,
// envoyait, PUIS passait la ligne à « sent ». Deux syncs simultanés (deux
// onglets, PC + téléphone, bouton « Sync maintenant » pendant l'auto-sync)
// lisaient les mêmes lignes et envoyaient chacun le message : le client
// recevait deux fois la même notification — exactement le motif que l'anti-spam
// WhatsApp sanctionne.
//
// Désormais chaque ligne est réclamée par compare-and-swap
// (pending → sending, conditionné par status = 'pending') : un seul appel peut
// l'obtenir. Une fonction tuée entre la prise et la clôture laisse la ligne en
// « sending » : elle n'est JAMAIS renvoyée automatiquement (même règle que
// max_attempts = 1 dans la file autotim : mieux vaut un message perdu et
// visible qu'un doublon).

import type { createServiceClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';
import { remainingDailyQuota, sleep, varyMessage } from '@/lib/whatsapp/anti-spam';
import { buildMessage, normalizePhone } from '@/lib/whatsapp/message-builder';
import { afterFailure, afterSuccess, circuitState } from '@/lib/queue/circuit-breaker';
import { getTenantSettings, upsertTenantSettings } from '@/lib/queue/repository';
import { logEvent } from '@/lib/security/safe-log';

type Client = ReturnType<typeof createServiceClient>;

export const DRAIN_PER_SYNC = 2; // max notifs envoyées par sync (anti-burst)
export const DRAIN_SPACING_MS = 8000; // espacement entre 2 envois d'un même drain

/** Statut transitoire : la ligne est prise par un drain, envoi en cours. */
export const NOTIF_CLAIMED_STATUS = 'sending';

interface Pending {
  id: string;
  tracking_number: string;
  delivery_status: string;
  customer_name: string | null;
  customer_whatsapp: string | null;
  wilaya: string | null;
  product_name: string | null;
  cod: number | null;
}

/**
 * Réclame une notification. Renvoie true si CET appel l'a obtenue.
 * L'UPDATE conditionné par `status = 'pending'` est atomique côté Postgres :
 * sur deux appels concurrents, un seul touche la ligne.
 */
export async function claimNotification(
  supabase: Client,
  userId: string,
  id: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('pending_notifications')
    .update({ status: NOTIF_CLAIMED_STATUS })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select('id');
  if (error) return false; // dans le doute, on n'envoie pas
  return Array.isArray(data) && data.length === 1;
}

/**
 * Draine au plus DRAIN_PER_SYNC notifs (jamais au-delà du plafond journalier)
 * via le numéro Evolution connecté. Renvoie le nombre réellement envoyé.
 */
export async function drainNotifications(
  supabase: Client,
  userId: string,
  userTpl: Map<string, string>
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count: sentToday }, { data: prof }] = await Promise.all([
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'envoye')
      .gte('sent_at', since),
    supabase.from('profiles').select('whatsapp_warmup_started_at').eq('id', userId).single(),
  ]);
  const warmupStartedAt = prof?.whatsapp_warmup_started_at ?? null;

  // Circuit breaker partagé avec la file (autotim.tenant_settings). Sans lui,
  // une session morte faisait écrire 2 lignes « echec » par sync et par onglet,
  // indéfiniment — le motif de l'incident d'avril-juillet (532 471 lignes).
  // Réglages illisibles (table/erreur) → on continue comme avant.
  const settings = await getTenantSettings(supabase, userId).catch(() => null);
  if (circuitState(settings).open) return 0;
  let failures = settings?.consecutive_send_failures ?? 0;

  const budget = Math.min(remainingDailyQuota(sentToday ?? 0, warmupStartedAt), DRAIN_PER_SYNC);
  if (budget <= 0) return 0;

  // Numéro Evolution connecté de l'utilisateur (instance auto_confirmation)
  const ev = await resolveEvolutionCreds(userId);
  if (!ev.url || !ev.key) return 0;
  const { data: inst } = await supabase
    .from('whatsapp_instances')
    .select('instance_name')
    .eq('user_id', userId)
    .eq('service_type', 'auto_confirmation')
    .single();
  if (!inst?.instance_name) return 0;

  const { data: pendings } = await supabase
    .from('pending_notifications')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(budget);
  if (!pendings || pendings.length === 0) return 0;

  let sent = 0;
  let attempted = 0;
  for (const p of pendings as Pending[]) {
    // Prise AVANT tout envoi : un autre sync l'a peut-être déjà prise.
    if (!(await claimNotification(supabase, userId, p.id))) continue;

    if (attempted > 0) await sleep(DRAIN_SPACING_MS);
    attempted++;

    const message = buildMessage(
      p.delivery_status,
      {
        customer_name: p.customer_name || '',
        tracking_number: p.tracking_number,
        wilaya: p.wilaya || '',
        product_name: p.product_name || '',
        cod: p.cod ?? 0,
      },
      userTpl
    );

    const phone = normalizePhone(p.customer_whatsapp || '');
    let ok = false;
    let err = '';
    if (phone.length >= 11) {
      try {
        const r = await fetch(`${ev.url}/message/sendText/${inst.instance_name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ev.key },
          body: JSON.stringify({ number: phone, text: varyMessage(message) }),
        });
        ok = r.ok;
        if (!ok) err = `Evolution HTTP ${r.status}`;
      } catch (e: any) {
        err = e?.message || 'réseau';
      }
    } else {
      err = 'Numéro invalide';
    }

    await supabase
      .from('pending_notifications')
      .update({ status: ok ? 'sent' : 'failed', sent_at: new Date().toISOString() })
      .eq('id', p.id)
      .eq('user_id', userId);

    await supabase.from('messages').insert({
      user_id: userId,
      tracking_number: p.tracking_number,
      customer_name: p.customer_name || '',
      customer_whatsapp: p.customer_whatsapp || '',
      message,
      status: ok ? 'envoye' : 'echec',
      error_message: ok ? null : err.slice(0, 300),
      sent_at: new Date().toISOString(),
    });

    if (ok) {
      sent++;
      if (failures > 0) {
        failures = 0;
        const r = afterSuccess();
        await upsertTenantSettings(supabase, userId, {
          consecutive_send_failures: r.failures,
          circuit_open_until: r.openUntil,
        }).catch(() => {});
      }
    } else if (phone.length >= 11) {
      // Échec Evolution (pas un numéro invalide) : compte pour le circuit, et
      // on n'enchaîne pas un 2e envoi voué au même sort.
      const next = afterFailure(failures);
      failures = next.failures;
      await upsertTenantSettings(supabase, userId, {
        consecutive_send_failures: next.failures,
        circuit_open_until: next.openUntil ? next.openUntil.toISOString() : null,
      }).catch(() => {});
      if (next.openUntil) {
        logEvent('warn', 'whatsapp.drain', { tenant_id: userId, status: 'circuit_opened' });
      }
      break;
    }
  }
  return sent;
}
