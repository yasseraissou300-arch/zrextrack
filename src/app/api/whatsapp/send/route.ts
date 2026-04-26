import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

function formatPhone(phone: string): string {
  const clean = phone.replace(/[\s\-\(\)\+\.]/g, '');
  if (clean.startsWith('213')) return clean;
  if (clean.startsWith('0')) return '213' + clean.slice(1);
  if (clean.length === 9) return '213' + clean;
  return clean;
}

async function sendMetaMessage(phoneNumberId: string, accessToken: string, to: string, message: string) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    }),
  });
  return res.json();
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
    return NextResponse.json({ error: 'WhatsApp Business non configuré — entre ton Phone Number ID et Access Token' }, { status: 400 });
  }

  const body = await request.json();
  const { recipients } = body;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ error: 'Aucun destinataire' }, { status: 400 });
  }

  const results = [];
  for (const r of recipients) {
    const to = formatPhone(r.whatsapp);
    let status: 'envoye' | 'echec' = 'echec';
    let errorMsg = '';

    try {
      const json = await sendMetaMessage(settings.instance_id, settings.api_token, to, r.message);
      if (json.messages?.[0]?.id) {
        status = 'envoye';
      } else {
        errorMsg = json.error?.message || JSON.stringify(json);
      }
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
