import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// Envoie un message WhatsApp via Evolution API en utilisant l'instance
// « auto_confirmation » de l'utilisateur (la même que celle de l'onglet
// Connexion sur la page /messages).
//
// Cette route remplace l'ancien backend WhatsApp privé (WHATSAPP_BACKEND_URL)
// qui n'est plus déployé. Le résultat : ce que tu vois dans « Connexion »
// est exactement ce qui est utilisé pour envoyer — finis les 200 échecs
// silencieux dus à une desynchro entre le statut affiché et le backend
// réellement appelé.

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';
const DEFAULT_SERVICE = 'auto_confirmation';

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

async function getReadyInstance(userId: string): Promise<{ instance: Instance | null; reason?: string }> {
  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
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
    const r = await fetch(`${EVOLUTION_URL}/instance/connectionState/${row.instance_name}`, {
      headers: { apikey: EVOLUTION_KEY },
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

async function sendOne(instanceName: string, phone: string, text: string): Promise<{ ok: boolean; error?: string; sessionDead?: boolean }> {
  try {
    const res = await fetch(`${EVOLUTION_URL}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
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

  // Pre-flight pour les envois en masse : on évite N tentatives ratées si
  // la session Evolution est tombée
  const { instance, reason } = await getReadyInstance(user.id);
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

  const results = [];
  let sessionDeadDetected = false;

  for (const r of recipients) {
    const to = normalizePhone(r.whatsapp);
    let status: 'envoye' | 'echec' = 'echec';
    let errorMsg = '';

    if (!to || to.length < 11) {
      errorMsg = `Numéro invalide : "${r.whatsapp}"`;
    } else if (sessionDeadDetected) {
      // Inutile de continuer à appeler Evolution si on sait que la session
      // est morte — chaque appel ajoute juste de la latence.
      errorMsg = 'Session WhatsApp expirée — annulé (reconnecte d\'abord)';
    } else {
      const send = await sendOne(instance.instance_name, to, r.message || '');
      if (send.ok) {
        status = 'envoye';
      } else {
        errorMsg = send.error || 'Echec envoi (raison inconnue)';
        if (send.sessionDead) {
          sessionDeadDetected = true;
          // Synchronise l'état DB avec la réalité : Evolution dit « open »
          // mais Baileys est mort → on marque l'instance comme déconnectée
          // pour que la bannière du frontend bascule en orange.
          await supabase
            .from('whatsapp_instances')
            .update({ connected: false, updated_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('service_type', DEFAULT_SERVICE);
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
    ...(sessionDeadDetected && {
      sessionDead: true,
      hint: 'Session WhatsApp expirée côté Evolution. Va dans Connexion → Déconnecter → rescanne le QR, puis renvoie.',
    }),
  });
}
