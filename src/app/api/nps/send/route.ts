import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

async function sendWA(phone, message) {
  const instanceId = process.env.GREENAPI_INSTANCE_ID;
  const token = process.env.GREENAPI_TOKEN;
  if (!instanceId || !token) return false;
  try {
    const host = instanceId.slice(0, 4);
    const clean = phone.replace(/\D/g, '');
    if (!clean || clean.length < 9) return false;
    const intl = clean.startsWith('213') ? clean : `213${clean.replace(/^0/, '')}`;
    const res = await fetch(`https://${host}.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: `${intl}@c.us`, message }) });
    return res.ok;
  } catch { return false; }
}

export async function POST(_req) {
  try {
    const auth = await createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const supabase = createServiceClient();
    const since = new Date(Date.now() - 86400000).toISOString();
    const { data: delivered } = await supabase.from('orders').select('tracking,client,whatsapp')
      .eq('status', 'livre').gte('last_update', since).not('whatsapp','is',null).neq('whatsapp','');
    if (!delivered?.length) return NextResponse.json({ sent: 0, message: 'Aucune livraison récente' });
    const { data: done } = await supabase.from('messages').select('tracking').in('tracking', delivered.map(o => o.tracking)).ilike('message', '%NPS%');
    const doneSet = new Set((done || []).map(m => m.tracking));
    const toSend = delivered.filter(o => !doneSet.has(o.tracking));
    if (!toSend.length) return NextResponse.json({ sent: 0, message: 'NPS déjà envoyés' });
    let sent = 0;
    for (const o of toSend) {
      const message = `🎉 Bonjour${o.client ? ` *${o.client}*` : ''} !\n\nVotre commande *${o.tracking}* a bien été livrée. Merci !\n\n⭐ NPS — Sur 10, quelle note pour votre livraison ?\nRépondez avec un chiffre de *1* à *10* 🙏`;
      const ok = await sendWA(o.whatsapp, message);
      await supabase.from('messages').insert({ client: o.client, whatsapp: o.whatsapp, tracking: o.tracking, message, status: ok ? 'envoye' : 'echec', sent_at: new Date().toISOString(), user_id: user.id }).then(() => {});
      if (ok) sent++;
    }
    return NextResponse.json({ sent, total: toSend.length, message: `${sent} NPS envoyé(s)` });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
