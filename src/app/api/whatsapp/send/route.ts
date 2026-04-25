import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

function formatPhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '213' + digits.slice(1);
  return digits + '@c.us';
}

async function sendText(instanceId: string, token: string, chatId: string, message: string) {
  const res = await fetch(
    `https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, message }) }
  );
  return res.json();
}

async function sendFile(instanceId: string, token: string, chatId: string, urlFile: string, fileName: string, caption: string) {
  const res = await fetch(
    `https://api.green-api.com/waInstance${instanceId}/sendFileByUrl/${token}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, urlFile, fileName, caption }) }
  );
  return res.json();
}

function guessFileName(url: string): string {
  try { return new URL(url).pathname.split('/').pop() || 'file'; } catch { return 'file'; }
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
  const { recipients, media_url, media_caption } = body;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ error: 'Aucun destinataire' }, { status: 400 });
  }

  const results = [];
  for (const r of recipients) {
    const chatId = formatPhone(r.whatsapp);
    let status: 'envoye' | 'echec' = 'echec';
    let errorMsg = '';

    try {
      let json: any;
      if (media_url) {
        const fileName = guessFileName(media_url);
        const caption = media_caption || r.message || '';
        json = await sendFile(settings.instance_id, settings.api_token, chatId, media_url, fileName, caption);
        // If media sent, also send text message if provided
        if (json.idMessage && r.message) {
          await sendText(settings.instance_id, settings.api_token, chatId, r.message);
        }
      } else {
        json = await sendText(settings.instance_id, settings.api_token, chatId, r.message);
      }
      status = json.idMessage ? 'envoye' : 'echec';
      if (!json.idMessage) errorMsg = JSON.stringify(json);
    } catch (e: any) {
      errorMsg = e.message;
    }

    await supabase.from('messages').insert({
      user_id: user.id,
      tracking_number: r.tracking || '',
      customer_name: r.client || '',
      customer_whatsapp: r.whatsapp || '',
      message: media_url ? `[Media] ${media_url}${r.message ? ' — ' + r.message : ''}` : (r.message || ''),
      status,
      sent_at: new Date().toISOString(),
    });

    results.push({ tracking: r.tracking, client: r.client, status, error: errorMsg });
  }

  const sent = results.filter(r => r.status === 'envoye').length;
  const failed = results.filter(r => r.status === 'echec').length;
  return NextResponse.json({ sent, failed, results });
}
