// Valide une réclamation SAV : enregistre la résolution choisie par l'opérateur
// et envoie un message WhatsApp de confirmation au client.
//
// Action côté DB :
//   - met à jour ai_chat_sessions.resolution / resolved_at / resolved_by
//
// Action côté WhatsApp :
//   - envoie un message templated via l'instance SAV (Evolution API)
//   - le client reçoit la confirmation directement sur le numéro qui a ouvert
//     la réclamation
//
// Si l'envoi WhatsApp échoue (instance non connectée, panne réseau), la
// résolution DB est quand même enregistrée. On remonte l'info au frontend
// pour qu'il puisse afficher un warning.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';

type Resolution = 'exchange' | 'refund' | 'resolved';

const MESSAGES: Record<Resolution, (name: string) => string> = {
  exchange: (name) => `Ahlan ${name || 'sahbi'} 🙏

Tlebt-ek dyal l'échange ttvalidat. Ghadi nb3thoulek colis jdid f aqrab waqt inchallah.

Rabi y3awnek 🙌
— ${'fre' /* fra */}`,
  refund: (name) => `Ahlan ${name || 'sahbi'} 🙏

Tlebt-ek dyal l'remboursement ttvalidat. Floussek ghadi yrj3ou f 48h, ghadi twasal lik notification.

Smahna 3la l'inconvénient w chokran 3la s9bran.`,
  resolved: (name) => `Ahlan ${name || 'sahbi'} 🙏

Réclamation dyalek tt7allat. Chokran 3la t9tek fina, w 3la ay 7aja okhra rana hna.

Rabi ywaffeq 🌟`,
};

// Nettoie le template : enlève les références internes laissées par erreur
function buildMessage(resolution: Resolution, name: string): string {
  return MESSAGES[resolution](name).replace(/\n— fre[^\n]*$/g, '').trim();
}

async function sendWhatsAppViaSAV(userId: string, phoneRaw: string, message: string): Promise<{ ok: boolean; reason?: string }> {
  // BYOK : serveur Evolution de l'utilisateur (ou fallback plateforme)
  const { url: EVOLUTION_URL, key: EVOLUTION_KEY } = await resolveEvolutionCreds(userId);
  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    return { ok: false, reason: 'Evolution API non configurée' };
  }
  const service = createServiceClient();
  const { data: instance } = await service
    .from('whatsapp_instances')
    .select('instance_name, connected')
    .eq('user_id', userId)
    .eq('service_type', 'sav')
    .single();

  if (!instance) return { ok: false, reason: 'Aucune instance SAV configurée' };
  if (!instance.connected) return { ok: false, reason: 'Instance SAV non connectée à WhatsApp' };

  const cleanNumber = phoneRaw.replace('@s.whatsapp.net', '').replace('@g.us', '').replace(/[\s\-()+.]/g, '');
  try {
    const res = await fetch(`${EVOLUTION_URL}/message/sendText/${instance.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
      body: JSON.stringify({ number: cleanNumber, text: message }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, reason: `Evolution HTTP ${res.status}: ${errText.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'Erreur réseau Evolution' };
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sessionId, resolution } = (await req.json()) as { sessionId?: string; resolution?: Resolution };
  if (!sessionId) return NextResponse.json({ error: 'sessionId manquant' }, { status: 400 });
  if (!resolution || !['exchange', 'refund', 'resolved'].includes(resolution)) {
    return NextResponse.json({ error: 'resolution invalide (attendu: exchange | refund | resolved)' }, { status: 400 });
  }

  const service = createServiceClient();

  // Récupère la session pour avoir le contact_id (téléphone) + contact_name
  const { data: session, error: fetchErr } = await service
    .from('ai_chat_sessions')
    .select('id, contact_id, contact_name, template_type, user_id, resolution')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (fetchErr || !session) return NextResponse.json({ error: 'Réclamation introuvable' }, { status: 404 });
  if (session.template_type !== 'sav') {
    return NextResponse.json({ error: 'Cette action est réservée aux sessions SAV' }, { status: 400 });
  }
  if (session.resolution) {
    return NextResponse.json({ error: `Réclamation déjà résolue (${session.resolution})` }, { status: 409 });
  }

  // 1) Marque la résolution en DB
  const { error: updateErr } = await service
    .from('ai_chat_sessions')
    .update({
      resolution,
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq('id', sessionId)
    .eq('user_id', user.id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // 2) Envoie la notification WhatsApp (best effort — n'annule pas la résolution si KO)
  const message = buildMessage(resolution, session.contact_name || '');
  const wa = await sendWhatsAppViaSAV(user.id, session.contact_id || '', message);

  return NextResponse.json({
    ok: true,
    resolution,
    whatsapp: wa.ok ? 'sent' : 'failed',
    whatsapp_error: wa.ok ? null : wa.reason,
  });
}
