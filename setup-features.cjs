const fs = require('fs');
const path = require('path');

const mk = (p) => fs.mkdirSync(path.dirname(p), { recursive: true });
const w = (p, c) => { mk(p); fs.writeFileSync(p, c, 'utf8'); console.log('✅', p.replace(__dirname + '/', '')); };

// 1. API tracking publique
w('src/app/api/track/[tracking]/route.ts', `import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tracking: string }> }
) {
  try {
    const { tracking } = await params;
    if (!tracking) return NextResponse.json({ error: 'Tracking requis' }, { status: 400 });
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('orders')
      .select('tracking, client, wilaya, status, attempts, last_update, product')
      .ilike('tracking', tracking.trim())
      .limit(1)
      .single();
    if (error || !data) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 });
    return NextResponse.json({
      tracking: data.tracking, client: data.client, wilaya: data.wilaya,
      status: data.status, attempts: data.attempts, last_update: data.last_update, product: data.product,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erreur' }, { status: 500 });
  }
}
`);

// 2. Webhook Green API (bot entrant)
w('src/app/api/webhook/greenapi/route.ts', `import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.vercel.app';

const STATUS_LABELS = {
  en_preparation: '📦 En préparation', en_transit: '🚚 En transit', en_cours: '🚚 En transit',
  en_livraison: '🛵 En cours de livraison', livre: '✅ Livré avec succès',
  echec: '⚠️ Échec de livraison', retourne: '🔄 Retourné',
};

async function sendReply(phone, message) {
  const instanceId = process.env.GREENAPI_INSTANCE_ID;
  const token = process.env.GREENAPI_TOKEN;
  if (!instanceId || !token) return;
  const host = instanceId.slice(0, 4);
  const cleanPhone = phone.replace(/\\D/g, '');
  const intlPhone = cleanPhone.startsWith('213') ? cleanPhone : \`213\${cleanPhone.replace(/^0/, '')}\`;
  await fetch(\`https://\${host}.api.greenapi.com/waInstance\${instanceId}/sendMessage/\${token}\`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: \`\${intlPhone}@c.us\`, message }),
  }).catch(() => {});
}

function extractTracking(text) {
  const match = text.match(/\\b(ZR[XEX]?\\d+|\\d{6,12})\\b/i);
  return match ? match[1].toUpperCase() : null;
}

export async function POST(req) {
  try {
    const body = await req.json();
    if (body.typeWebhook !== 'incomingMessageReceived') return NextResponse.json({ ok: true });
    const senderData = body.senderData || {};
    const chatId = senderData.chatId || '';
    const senderName = senderData.senderName || '';
    const text = body.messageData?.textMessageData?.textMessage || body.messageData?.extendedTextMessageData?.text || '';
    if (!chatId || !text.trim()) return NextResponse.json({ ok: true });
    const phone = chatId.replace('@c.us', '').replace('@g.us', '');
    const tracking = extractTracking(text.trim());
    if (!tracking) {
      await sendReply(phone, \`Bonjour\${senderName ? \` *\${senderName}*\` : ''} 👋\\n\\nEnvoyez votre *numéro de tracking*.\\nEx : *ZRX123456*\\n\\n🔗 \${APP_URL}/track\`);
      return NextResponse.json({ ok: true });
    }
    const supabase = createServiceClient();
    const { data: order } = await supabase.from('orders')
      .select('tracking, client, wilaya, status, attempts, last_update, product')
      .ilike('tracking', tracking).limit(1).single();
    if (!order) {
      await sendReply(phone, \`❌ Commande *\${tracking}* introuvable. Vérifiez et réessayez.\`);
      return NextResponse.json({ ok: true });
    }
    const statusLabel = STATUS_LABELS[order.status] || order.status;
    let reply = \`📦 *Commande \${order.tracking}*\\n\\n\`;
    reply += \`👤 Client : \${order.client || '—'}\\n\`;
    if (order.wilaya) reply += \`📍 Wilaya : \${order.wilaya}\\n\`;
    if (order.product) reply += \`🛍️ Produit : \${order.product}\\n\`;
    reply += \`📊 Statut : *\${statusLabel}*\\n\`;
    if (order.attempts) reply += \`🔁 Tentatives : \${order.attempts}\\n\`;
    reply += \`\\n🔗 \${APP_URL}/track/\${order.tracking}\`;
    if (order.status === 'echec') reply += \`\\n\\n⚠️ Livreur non joignable. Contactez votre vendeur.\`;
    else if (order.status === 'livre') reply += \`\\n\\n🎉 Merci pour votre confiance !\`;
    await sendReply(phone, reply);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ ok: true }); }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'ZREXtrack WhatsApp Bot' });
}
`);

// 3. Alertes retard
w('src/app/api/check-delays/route.ts', `import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.vercel.app';
const THRESHOLDS = { en_preparation: 24, en_transit: 72, en_livraison: 48 };

async function sendWA(phone, message) {
  const instanceId = process.env.GREENAPI_INSTANCE_ID;
  const token = process.env.GREENAPI_TOKEN;
  if (!instanceId || !token) return false;
  try {
    const host = instanceId.slice(0, 4);
    const clean = phone.replace(/\\D/g, '');
    if (!clean || clean.length < 9) return false;
    const intl = clean.startsWith('213') ? clean : \`213\${clean.replace(/^0/, '')}\`;
    const res = await fetch(\`https://\${host}.api.greenapi.com/waInstance\${instanceId}/sendMessage/\${token}\`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: \`\${intl}@c.us\`, message }) });
    return res.ok;
  } catch { return false; }
}

export async function POST(_req) {
  try {
    const auth = await createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const supabase = createServiceClient();
    const now = new Date();
    const alerts = [];
    for (const [status, hours] of Object.entries(THRESHOLDS)) {
      const cutoff = new Date(now - hours * 3600000);
      const { data } = await supabase.from('orders').select('tracking,client,whatsapp,last_update')
        .eq('status', status).lt('last_update', cutoff.toISOString()).not('whatsapp','is',null).neq('whatsapp','');
      for (const o of data || []) {
        const h = Math.round((now - new Date(o.last_update)) / 3600000);
        const labels = { en_preparation: 'en préparation', en_transit: 'en transit', en_livraison: 'en cours de livraison' };
        const msg = \`⏰ Bonjour\${o.client ? \` *\${o.client}*\` : ''}, votre commande *\${o.tracking}* est \${labels[status]} depuis *\${h}h*.\\n\\nNotre équipe s'en occupe.\\n\\n🔗 \${APP_URL}/track/\${o.tracking}\`;
        const sent = await sendWA(o.whatsapp, msg);
        await supabase.from('messages').insert({ client: o.client, whatsapp: o.whatsapp, tracking: o.tracking, message: msg, status: sent ? 'envoye' : 'echec', sent_at: new Date().toISOString(), user_id: user.id }).then(() => {});
        alerts.push({ tracking: o.tracking, status, hours: h, notified: sent });
      }
    }
    return NextResponse.json({ alerts: alerts.length, notified: alerts.filter(a => a.notified).length });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
`);

// 4. NPS
w('src/app/api/nps/send/route.ts', `import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

async function sendWA(phone, message) {
  const instanceId = process.env.GREENAPI_INSTANCE_ID;
  const token = process.env.GREENAPI_TOKEN;
  if (!instanceId || !token) return false;
  try {
    const host = instanceId.slice(0, 4);
    const clean = phone.replace(/\\D/g, '');
    if (!clean || clean.length < 9) return false;
    const intl = clean.startsWith('213') ? clean : \`213\${clean.replace(/^0/, '')}\`;
    const res = await fetch(\`https://\${host}.api.greenapi.com/waInstance\${instanceId}/sendMessage/\${token}\`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: \`\${intl}@c.us\`, message }) });
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
      const message = \`🎉 Bonjour\${o.client ? \` *\${o.client}*\` : ''} !\\n\\nVotre commande *\${o.tracking}* a bien été livrée. Merci !\\n\\n⭐ NPS — Sur 10, quelle note pour votre livraison ?\\nRépondez avec un chiffre de *1* à *10* 🙏\`;
      const ok = await sendWA(o.whatsapp, message);
      await supabase.from('messages').insert({ client: o.client, whatsapp: o.whatsapp, tracking: o.tracking, message, status: ok ? 'envoye' : 'echec', sent_at: new Date().toISOString(), user_id: user.id }).then(() => {});
      if (ok) sent++;
    }
    return NextResponse.json({ sent, total: toSend.length, message: \`\${sent} NPS envoyé(s)\` });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
`);

// 5. Page tracking root
w('src/app/track/page.tsx', `'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, RefreshCw, Package } from 'lucide-react';
import Link from 'next/link';

export default function TrackRootPage() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const go = () => { const t = input.trim(); if (!t) return; setLoading(true); router.push(\`/track/\${encodeURIComponent(t)}\`); };
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-green-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center"><span className="text-white font-bold text-sm">Z</span></div>
            <span className="font-bold text-gray-900 text-[15px]">ZREXTrack</span>
          </Link>
          <span className="text-xs text-gray-400">Suivi de commande</span>
        </div>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-md space-y-6">
          <div className="flex justify-center"><div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center"><Package size={32} className="text-green-600" /></div></div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Suivre ma commande</h1>
            <p className="text-gray-500 text-sm">Entrez votre numéro de tracking pour voir le statut en temps réel</p>
          </div>
          <div className="flex gap-2">
            <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="Ex : ZRX123456"
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 shadow-sm" autoFocus />
            <button onClick={go} disabled={loading || !input.trim()} className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white font-medium px-5 py-3 rounded-xl transition-colors disabled:opacity-50 shadow-sm">
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}{loading ? '' : 'Rechercher'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
`);

// 6. Page tracking [tracking]
w('src/app/track/[tracking]/page.tsx', `'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Package, CheckCircle2, Truck, Clock, XCircle, RotateCcw, MapPin, RefreshCw, Search, Boxes } from 'lucide-react';
import Link from 'next/link';

const STATUS_STEPS = [
  { key: 'en_preparation', label: 'En préparation', icon: Boxes, color: 'text-purple-500', bg: 'bg-purple-50', border: 'border-purple-200' },
  { key: 'en_transit', label: 'En transit', icon: Package, color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200' },
  { key: 'en_livraison', label: 'En livraison', icon: Truck, color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-200' },
  { key: 'livre', label: 'Livré', icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-200' },
];
const STATUS_META = {
  en_preparation: { label: 'En préparation', color: 'border-purple-400', bg: 'bg-purple-50', text: 'text-purple-700', icon: Boxes },
  en_transit: { label: 'En transit', color: 'border-blue-400', bg: 'bg-blue-50', text: 'text-blue-700', icon: Package },
  en_cours: { label: 'En cours', color: 'border-blue-400', bg: 'bg-blue-50', text: 'text-blue-700', icon: Package },
  en_livraison: { label: 'En cours de livraison', color: 'border-amber-400', bg: 'bg-amber-50', text: 'text-amber-700', icon: Truck },
  livre: { label: 'Livré avec succès ✓', color: 'border-green-400', bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle2 },
  echec: { label: 'Échec de livraison', color: 'border-red-400', bg: 'bg-red-50', text: 'text-red-700', icon: XCircle },
  retourne: { label: 'Retourné', color: 'border-gray-400', bg: 'bg-gray-50', text: 'text-gray-600', icon: RotateCcw },
};
const getStep = (s) => ({ en_preparation:0, en_cours:1, en_transit:1, en_livraison:2, livre:3 })[s] ?? -1;

export default function TrackingPage() {
  const params = useParams();
  const tp = params?.tracking;
  const [input, setInput] = useState(tp || '');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const fetch_ = async (t) => {
    if (!t?.trim()) return;
    setLoading(true); setError(''); setSearched(true);
    try {
      const r = await fetch(\`/api/track/\${encodeURIComponent(t.trim())}\`);
      const j = await r.json();
      if (!r.ok || j.error) { setError(j.error || 'Commande introuvable'); setOrder(null); }
      else setOrder(j);
    } catch { setError('Erreur réseau.'); setOrder(null); }
    setLoading(false);
  };

  useEffect(() => { if (tp) fetch_(tp); }, [tp]);
  const meta = order ? (STATUS_META[order.status] || STATUS_META.en_preparation) : null;
  const stepIdx = order ? getStep(order.status) : -1;
  const isTerminal = order && ['echec','retourne'].includes(order.status);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-green-50">
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/track" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center"><span className="text-white font-bold text-sm">Z</span></div>
            <span className="font-bold text-gray-900">ZREXTrack</span>
          </Link>
          <span className="text-xs text-gray-400">Suivi de commande</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <div className="text-center"><h1 className="text-2xl font-bold text-gray-900 mb-1">Suivre ma commande</h1></div>
        <div className="flex gap-2">
          <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key==='Enter' && fetch_(input)} placeholder="Ex : ZRX123456"
            className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 shadow-sm" />
          <button onClick={() => fetch_(input)} disabled={loading || !input.trim()}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white font-medium px-5 py-3 rounded-xl disabled:opacity-50 shadow-sm">
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}{loading ? '' : 'Rechercher'}
          </button>
        </div>
        {searched && error && !loading && <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-center"><XCircle size={28} className="mx-auto mb-2 text-red-400" /><p className="font-semibold text-red-700">{error}</p></div>}
        {order && !loading && meta && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-md overflow-hidden">
            <div className={\`\${meta.bg} border-b \${meta.color} px-6 py-4 flex items-center gap-3\`}>
              <meta.icon size={22} className={meta.text} />
              <div><p className="text-xs text-gray-500 uppercase tracking-wide">Statut actuel</p><p className={\`font-bold text-lg \${meta.text}\`}>{meta.label}</p></div>
              <div className="ml-auto text-right"><p className="text-xs text-gray-400">Tracking</p><p className="font-mono font-bold text-gray-800 text-sm">{order.tracking}</p></div>
            </div>
            {!isTerminal && (
              <div className="px-6 pt-5 pb-2"><div className="flex items-center">
                {STATUS_STEPS.map((step, idx) => { const isA=idx===stepIdx,isDone=idx<stepIdx,Icon=step.icon; return (
                  <div key={step.key} className="flex items-center flex-1 last:flex-none">
                    <div className={\`flex flex-col items-center gap-1 \${idx<=stepIdx?'':'opacity-30'}\`}>
                      <div className={\`w-9 h-9 rounded-full flex items-center justify-center border-2 \${isA?\`\${step.bg} \${step.border}\`:isDone?'bg-green-100 border-green-400':'bg-gray-50 border-gray-200'}\`}>
                        {isDone?<CheckCircle2 size={16} className="text-green-500"/>:<Icon size={16} className={isA?step.color:'text-gray-400'}/>}
                      </div>
                      <span className={\`text-[10px] font-medium text-center \${isA?step.color:isDone?'text-green-600':'text-gray-400'}\`}>{step.label}</span>
                    </div>
                    {idx<STATUS_STEPS.length-1 && <div className={\`flex-1 h-0.5 mx-1 mb-5 rounded-full \${idx<stepIdx?'bg-green-400':'bg-gray-200'}\`}/>}
                  </div>); })}
              </div></div>
            )}
            <div className="grid grid-cols-2 gap-3 px-6 py-4">
              {order.client && <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] text-gray-400 uppercase mb-0.5">Client</p><p className="font-semibold text-gray-800 text-sm">{order.client}</p></div>}
              {order.wilaya && <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] text-gray-400 uppercase mb-0.5 flex items-center gap-1"><MapPin size={9}/>Wilaya</p><p className="font-semibold text-gray-800 text-sm">{order.wilaya}</p></div>}
              {order.product && <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] text-gray-400 uppercase mb-0.5">Produit</p><p className="font-semibold text-gray-800 text-sm">{order.product}</p></div>}
              {order.attempts!=null && <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] text-gray-400 uppercase mb-0.5">Tentatives</p><p className="font-semibold text-gray-800 text-sm">{order.attempts}</p></div>}
            </div>
            {order.last_update && <div className="px-6 pb-4 flex items-center gap-1.5">
              <Clock size={12} className="text-gray-400"/>
              <p className="text-xs text-gray-400">Mis à jour le <span className="font-medium text-gray-600">{new Date(order.last_update).toLocaleString('fr-FR',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span></p>
              <button onClick={()=>fetch_(order.tracking)} className="ml-auto flex items-center gap-1 text-xs text-green-600 font-medium"><RefreshCw size={11}/>Actualiser</button>
            </div>}
            {order.status==='echec' && <div className="mx-6 mb-4 bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700">⚠️ Notre livreur n'a pas pu vous joindre. Contactez le vendeur.</div>}
            {order.status==='retourne' && <div className="mx-6 mb-4 bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-600">📦 Colis retourné. Contactez le vendeur.</div>}
            {order.status==='livre' && <div className="mx-6 mb-4 bg-green-50 border border-green-100 rounded-xl p-3 text-xs text-green-700 text-center">🎉 Livré avec succès. Merci pour votre confiance !</div>}
          </div>
        )}
      </main>
    </div>
  );
}
`);

console.log('\n✅ Tous les fichiers créés ! Lance maintenant :');
console.log('   git add .');
console.log('   git commit -m "feat: tracking public, bot WhatsApp, NPS, alertes retard"');
console.log('   git push origin main');
