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

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  if (!BACKEND || !SECRET) {
    return NextResponse.json({ error: 'Backend WhatsApp non configuré' }, { status: 500 });
  }

  const supabase = createServiceClient();
  const body = await request.json();
  const { recipients } = body;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ error: 'Aucun destinataire' }, { status: 400 });
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
      const json = await res.json();
      if (json.success) status = 'envoye';
      else errorMsg = json.error || 'Echec envoi';
    } catch (e: any) {
      errorMsg = e.message;
    }

    await supabase.from('messages').insert({
      user_id: user.id,
      tracking_number: r.tracking || '',
      customer_name: r.client || '',
      customer_whatsapp: r.whatsapp || '',
      message: r.message || '',
      status,
      sent_at: new Date().toISOString(),
    });

    results.push({ tracking: r.tracking, client: r.client, status, error: errorMsg });
  }

  const sent = results.filter(r => r.status === 'envoye').length;
  const failed = results.filter(r => r.status === 'echec').length;
  return NextResponse.json({ sent, failed, results });
}
