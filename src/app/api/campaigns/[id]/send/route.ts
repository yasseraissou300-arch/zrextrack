import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';
import { ANTI_SPAM, randomThrottle, sleep, varyMessage, remainingDailyQuota } from '@/lib/whatsapp/anti-spam';

// Envoi de campagne — utilise le MÊME numéro WhatsApp connecté (Evolution,
// instance « auto_confirmation ») et les MÊMES protections anti-suspension que
// l'envoi manuel : plafond journalier partagé, délai 20-60s entre chaque envoi,
// circuit breaker, variation du message. Fini l'ancien Green-API sans aucune
// protection (qui faisait bannir le numéro).
//
// Le plafond journalier est PARTAGÉ avec l'envoi manuel + les notifs auto
// (compté dans la table `messages`), donc l'ensemble ne dépasse jamais
// ANTI_SPAM.DAILY_LIMIT messages / 24h pour le numéro.

// Sur Vercel, le délai anti-spam fait que l'envoi est lent : on borne la durée
// de la fonction. Le plafond journalier garantit qu'un re-lancement ne dépasse
// jamais la limite, donc on peut relancer pour continuer.
export const maxDuration = 300;

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

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function guessFileName(url: string): string {
  try { return new URL(url).pathname.split('/').pop() || 'file'; } catch { return 'file'; }
}

function mediaTypeFromUrl(url: string): 'image' | 'video' | 'document' {
  const u = url.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/.test(u)) return 'image';
  if (/\.(mp4|3gp|mov)(\?|$)/.test(u)) return 'video';
  return 'document';
}

interface Instance { instance_name: string; connected: boolean }

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

  if (!row) return { instance: null, reason: 'Aucune instance WhatsApp — connecte-toi d\'abord dans Messages → Connexion' };

  try {
    const r = await fetch(`${ev.url}/instance/connectionState/${row.instance_name}`, { headers: { apikey: ev.key } });
    if (r.ok) {
      const j = await r.json();
      const isOpen = (j.instance?.state || j.state) === 'open';
      if (!isOpen) return { instance: null, reason: `WhatsApp non connecté (état : ${j.instance?.state || j.state || 'inconnu'})` };
    }
  } catch (e: any) {
    return { instance: null, reason: `Evolution injoignable : ${e?.message || 'erreur réseau'}` };
  }
  return { instance: row };
}

function isSessionDead(errText: string): boolean {
  return /Connection Closed/i.test(errText) || /Connection Failure/i.test(errText) || /precondition/i.test(errText);
}

async function sendText(ev: EvCreds, instanceName: string, phone: string, text: string) {
  try {
    const res = await fetch(`${ev.url}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ev.key },
      body: JSON.stringify({ number: phone, text }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: `Evolution HTTP ${res.status}: ${errText.slice(0, 160)}`, sessionDead: isSessionDead(errText) };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau Evolution', sessionDead: false };
  }
}

async function sendMedia(ev: EvCreds, instanceName: string, phone: string, mediaUrl: string, fileName: string, caption: string) {
  try {
    const res = await fetch(`${ev.url}/message/sendMedia/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ev.key },
      body: JSON.stringify({ number: phone, mediatype: mediaTypeFromUrl(mediaUrl), media: mediaUrl, fileName, caption }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: `Evolution HTTP ${res.status}: ${errText.slice(0, 160)}`, sessionDead: isSessionDead(errText) };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau Evolution', sessionDead: false };
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();

  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (cErr || !campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });
  if (campaign.status === 'en_cours') return NextResponse.json({ error: 'Campagne déjà en cours' }, { status: 400 });

  // ── Numéro = celui connecté dans Messages → Connexion (Evolution) ─────────
  const ev = await resolveEvolutionCreds(user.id);
  const { instance, reason } = await getReadyInstance(user.id, ev);
  if (!instance) {
    return NextResponse.json({
      error: reason || 'WhatsApp non prêt',
      code: 'NOT_CONNECTED',
      hint: 'Connecte ton WhatsApp dans Messages → Connexion avant de lancer la campagne.',
    }, { status: 503 });
  }

  // ── Construire l'audience (liste custom OU filtre par statut) ─────────────
  let validOrders: Array<{ tracking_number: string; customer_name: string; customer_whatsapp: string; wilaya: string; cod: number | null }>;
  const customList = (campaign.audience_phones as string[] | null) || null;

  if (customList && customList.length > 0) {
    const { data: knownOrders } = await supabase
      .from('orders')
      .select('tracking_number, customer_name, customer_whatsapp, wilaya, cod, updated_at')
      .eq('user_id', user.id)
      .in('customer_whatsapp', customList)
      .order('updated_at', { ascending: false });
    type KnownOrder = { tracking_number: string; customer_name: string; customer_whatsapp: string; wilaya: string; cod: number | null; updated_at: string };
    const byPhone = new Map<string, KnownOrder>();
    for (const o of ((knownOrders || []) as KnownOrder[])) if (!byPhone.has(o.customer_whatsapp)) byPhone.set(o.customer_whatsapp, o);
    validOrders = customList.map(phone => {
      const k = byPhone.get(phone);
      return { tracking_number: k?.tracking_number || '', customer_name: k?.customer_name || '', customer_whatsapp: phone, wilaya: k?.wilaya || '', cod: k?.cod ?? null };
    });
  } else {
    let q = supabase
      .from('orders')
      .select('tracking_number, customer_name, customer_whatsapp, wilaya, cod')
      .eq('user_id', user.id)
      .not('customer_whatsapp', 'is', null)
      .neq('customer_whatsapp', '');
    if (campaign.audience_status) q = q.eq('delivery_status', campaign.audience_status);
    const { data: orders } = await q;
    validOrders = (orders || []).filter(o => o.customer_whatsapp && o.customer_whatsapp.length > 5);
  }

  // ── ANTI-SPAM : plafond journalier PARTAGÉ (table messages, 24h glissant) ──
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
      error: `Plafond journalier atteint (${ANTI_SPAM.DAILY_LIMIT} messages/24h) — protège ton numéro d'une suspension.`,
      code: 'DAILY_LIMIT_REACHED',
      hint: 'Attends que la fenêtre de 24h se libère, puis relance la campagne pour envoyer le reste.',
      sentToday: sentToday ?? 0,
      dailyLimit: ANTI_SPAM.DAILY_LIMIT,
    }, { status: 429 });
  }
  const willSend = Math.min(validOrders.length, remaining);

  await supabase.from('campaigns')
    .update({ status: 'en_cours', total_count: validOrders.length, updated_at: new Date().toISOString() })
    .eq('id', id);

  const mediaUrl: string = campaign.media_url || '';
  const fileName = mediaUrl ? guessFileName(mediaUrl) : '';

  let sent = 0, failed = 0;
  let consecutiveErrors = 0, circuitBroken = false, sessionDead = false;

  for (let i = 0; i < validOrders.length; i++) {
    const order = validOrders[i];
    const message = interpolate(campaign.message_template, {
      client: order.customer_name || '',
      tracking: order.tracking_number || '',
      wilaya: order.wilaya || '',
      produit: '',
      cod: String(order.cod ?? ''),
    });
    const to = normalizePhone(order.customer_whatsapp);
    let status: 'envoye' | 'echec' = 'echec';
    let errorMsg = '';

    if (i >= willSend) {
      errorMsg = `Quota journalier dépassé (${ANTI_SPAM.DAILY_LIMIT}/24h) — non envoyé`;
    } else if (!to || to.length < 11) {
      errorMsg = `Numéro invalide : "${order.customer_whatsapp}"`;
    } else if (sessionDead) {
      errorMsg = 'Session WhatsApp expirée — annulé';
    } else if (circuitBroken) {
      errorMsg = `Circuit ouvert (${ANTI_SPAM.MAX_CONSECUTIVE_ERRORS} échecs consécutifs) — campagne stoppée pour protéger le numéro`;
    } else {
      // Délai 20-60s entre 2 envois (sauf le tout premier).
      if (sent > 0 || consecutiveErrors > 0) await sleep(randomThrottle());
      const varied = varyMessage(message);
      const res = mediaUrl
        ? await sendMedia(ev, instance.instance_name, to, mediaUrl, fileName, varied)
        : await sendText(ev, instance.instance_name, to, varied);
      if (res.ok) {
        status = 'envoye';
        consecutiveErrors = 0;
      } else {
        errorMsg = res.error || 'Echec envoi';
        consecutiveErrors++;
        if (res.sessionDead) {
          sessionDead = true;
          await supabase.from('whatsapp_instances')
            .update({ connected: false, updated_at: new Date().toISOString() })
            .eq('user_id', user.id).eq('service_type', DEFAULT_SERVICE);
        }
        if (consecutiveErrors >= ANTI_SPAM.MAX_CONSECUTIVE_ERRORS) circuitBroken = true;
      }
    }

    if (status === 'envoye') sent++; else failed++;

    await supabase.from('campaign_recipients').insert({
      campaign_id: id,
      client: order.customer_name || '',
      phone: order.customer_whatsapp,
      tracking: order.tracking_number || '',
      message,
      status,
      sent_at: new Date().toISOString(),
    });

    // Compte dans le plafond PARTAGÉ (uniquement les envois réussis).
    if (status === 'envoye') {
      await supabase.from('messages').insert({
        user_id: user.id,
        tracking_number: order.tracking_number || '',
        customer_name: order.customer_name || '',
        customer_whatsapp: order.customer_whatsapp || '',
        message,
        status: 'envoye',
        sent_at: new Date().toISOString(),
      });
    }
  }

  await supabase.from('campaigns')
    .update({ status: 'termine', sent_count: sent, failed_count: failed, updated_at: new Date().toISOString() })
    .eq('id', id);

  return NextResponse.json({
    sent,
    failed,
    total: validOrders.length,
    sentToday: (sentToday ?? 0) + sent,
    dailyLimit: ANTI_SPAM.DAILY_LIMIT,
    ...(circuitBroken && { circuitBroken: true, hint: 'Campagne stoppée après plusieurs échecs consécutifs (protection numéro).' }),
    ...(sessionDead && { sessionDead: true, hint: 'Session WhatsApp expirée — reconnecte dans Messages → Connexion.' }),
  });
}
