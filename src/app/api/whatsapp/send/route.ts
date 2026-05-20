import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const BACKEND = process.env.WHATSAPP_BACKEND_URL;
const SECRET = process.env.WHATSAPP_BACKEND_SECRET;

function normalizePhone(phone: string): string {
  const clean = phone.replace(/[\s\-\(\)\+\.]/g, '');
  if (clean.startsWith('213')) return clean;
  if (clean.startsWith('0')) return '213' + clean.slice(1);
  if (clean.length === 9) return '213' + clean;
  return clean;
}

// Vérifie que le backend WhatsApp est connecté ET prêt avant d'envoyer.
// Sans ce pre-flight, des envois en masse partent dans le vide quand la
// session est déconnectée — c'est exactement le scénario des « 200 messages
// en échec » signalé par l'utilisateur.
async function checkBackendReady(userId: string): Promise<{ ready: boolean; reason?: string }> {
  try {
    const res = await fetch(`${BACKEND}/api/status/${userId}`, {
      headers: { 'x-backend-secret': SECRET! },
    });
    if (!res.ok) return { ready: false, reason: `Backend HTTP ${res.status}` };
    const json = await res.json();
    if (json.status === 'ready') return { ready: true };
    return { ready: false, reason: `WhatsApp non connecté (état : ${json.status || 'inconnu'})` };
  } catch (e: any) {
    return { ready: false, reason: `Backend injoignable : ${e?.message || 'erreur réseau'}` };
  }
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  if (!BACKEND || !SECRET) {
    return NextResponse.json({ error: 'Backend WhatsApp non configuré (env vars manquantes)' }, { status: 500 });
  }

  const supabase = createServiceClient();
  const body = await request.json();
  const { recipients } = body;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ error: 'Aucun destinataire' }, { status: 400 });
  }

  // Pre-flight : éviter d'enchaîner N envois si la session est déconnectée.
  // Pour un seul destinataire on tente quand même (pas de gros gaspillage), mais
  // pour un envoi en masse (>1) on échoue tôt avec un message clair.
  if (recipients.length > 1) {
    const check = await checkBackendReady(user.id);
    if (!check.ready) {
      return NextResponse.json({
        error: check.reason || 'WhatsApp non prêt',
        code: 'NOT_CONNECTED',
        hint: 'Va dans l\'onglet Connexion et reconnecte WhatsApp avant de renvoyer.',
        sent: 0,
        failed: 0,
        results: [],
      }, { status: 503 });
    }
  }

  const results = [];
  for (const r of recipients) {
    const to = normalizePhone(r.whatsapp);
    let status: 'envoye' | 'echec' = 'echec';
    let errorMsg = '';

    try {
      const res = await fetch(`${BACKEND}/api/send/${user.id}`, {
        method: 'POST',
        headers: { 'x-backend-secret': SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, message: r.message }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.success) {
        status = 'envoye';
      } else {
        errorMsg = json.error || `HTTP ${res.status} — pas de détail`;
      }
    } catch (e: any) {
      errorMsg = e?.message || 'Erreur réseau inconnue';
    }

    // On stocke aussi la raison d'échec quand elle existe, pour diagnostiquer
    // plus tard sans relancer. La colonne error_message doit exister sur la
    // table messages (voir supabase_messages_error.sql).
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
  return NextResponse.json({ sent, failed, results });
}
