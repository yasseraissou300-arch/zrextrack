import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

function formatPhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '213' + digits.slice(1);
  return digits + '@c.us';
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data: settings } = await supabase
    .from('whatsapp_settings')
    .select('instance_id, api_token')
    .eq('user_id', user.id)
    .single();

  if (!settings?.instance_id || !settings?.api_token) {
    return NextResponse.json({ error: 'WhatsApp non configuré' }, { status: 400 });
  }

  const body = await request.json();
  const { recipients } = body;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ error: 'Aucun destinataire' }, { status: 400 });
  }

  const results = [];
  for (const r of recipients) {
    const chatId = formatPhone(r.whatsapp);
    let status: 'envoye' | 'echec' = 'echec';
    let errorMsg = '';

    try {
      const res = await fetch(
        `https://api.green-api.com/waInstance${settings.instance_id}/sendMessage/${settings.api_token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, message: r.message }),
        }
      );
      const json = await res.json();
      status = json.idMessage ? 'envoye' : 'echec';
      if (!json.idMessage) errorMsg = JSON.stringify(json);
    } catch (e: any) {
      errorMsg = e.message;
    }

    await supabase.from('messages').insert({
      user_id: user.id,
      tracking: r.tracking || '',
      client: r.client || '',
      whatsapp: r.whatsapp || '',
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
