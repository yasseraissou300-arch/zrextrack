'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import { MessageSquare, Wifi, WifiOff, QrCode, Send, History, CheckCircle, RefreshCw, ChevronLeft, ChevronRight, Settings, AlertCircle, Users, Loader2, Smartphone, Filter, Zap, Bot, ToggleLeft, ToggleRight, Globe, Copy } from 'lucide-react';
import { toast } from 'sonner';

interface WASettings { instance_id: string; api_token: string; connected: boolean; phone: string; }
interface Order { id: string; tracking_number: string; customer_name: string; customer_whatsapp: string; situation: string; wilaya: string; delivery_status: string; cod: number; }
interface MsgLog { id: string; tracking_number: string; customer_name: string; customer_whatsapp: string; message: string; status: 'envoye' | 'echec' | 'en_attente'; sent_at: string; }

const MOCK_ORDER: Order = {
  id: 'preview', tracking_number: 'ZR-000000', customer_name: 'محمد',
  customer_whatsapp: '', situation: '', wilaya: 'الجزائر', delivery_status: '', cod: 2500,
};

const SITUATION_FILTERS = [
  { value: '', label: 'Toutes les situations' },
  { value: 'commande annul', label: 'Commande annulee' },
  { value: 'commune erron', label: 'Commune erronee' },
  { value: 'en cours de livraison', label: 'En cours de livraison' },
  { value: 'livr', label: 'Livre' },
  { value: 'retour', label: 'Retourne' },
  { value: 'en transit', label: 'En transit' },
  { value: 'en preparation', label: 'En preparation' },
];

const TEMPLATES = [
  { id: 'ne_repond_pas', label: 'Ma jawabch', situation: 'ne repond pas',
    text: (o: Order) => `السلام عليكم ${o.customer_name} 👋
عندك طرد برقم *${o.tracking_number}* ولقيناك ما جاوبتناش.
ارجاء تواصل معنا باش نوصلو ليك طردك.
شكرا 🙏` },
  { id: 'annule', label: 'Commande lghya', situation: 'commande annul',
    text: (o: Order) => `السلام عليكم ${o.customer_name} 👋
طردك رقم *${o.tracking_number}* تلغى.
إذا عندك أي سؤال ولا تبغي تعاود تطلب، تواصل معنا.
شكرا 🙏` },
  { id: 'commune_erronee', label: 'Adresse khata', situation: 'commune erron',
    text: (o: Order) => `السلام عليكم ${o.customer_name} 👋
طردك رقم *${o.tracking_number}* فيه مشكل في عنوان التسليم.
ارجاء راسلنا وعطينا عنوانك الصحيح باش نوصلو ليك طردك.
شكرا 🙏` },
  { id: 'en_livraison', label: 'F tariq', situation: 'en cours de livraison',
    text: (o: Order) => `السلام عليكم ${o.customer_name} 👋
طردك رقم *${o.tracking_number}* مع الليفروار دروك في *${o.wilaya}*.
المبلغ لي يتسلم : *${o.cod} دج*
كون في الدار ويصلك. شكرا 🚚` },
  { id: 'livre', label: 'Twassal', situation: 'livr',
    text: (o: Order) => `السلام عليكم ${o.customer_name} 👋
طردك رقم *${o.tracking_number}* وصل.
شكرا على ثقتك فينا وانشاء الله راك راضي على الطلبية. نتمنالك يوم مليح 🙏` },
  { id: 'retourne', label: 'Rjae', situation: 'retour',
    text: (o: Order) => `السلام عليكم ${o.customer_name} 👋
طردك رقم *${o.tracking_number}* رجع لينا.
إذا تبغي تعاود تطلب ولا عندك سؤال، تواصل معنا.
شكرا 🙏` },
  { id: 'transit', label: 'F route', situation: 'en transit',
    text: (o: Order) => `السلام عليكم ${o.customer_name} 👋
طردك رقم *${o.tracking_number}* في الطريق لـ *${o.wilaya}*.
غادي يوصلك قريب انشاء الله. شكرا 🙏` },
  { id: 'custom', label: 'Personnalise', situation: '', text: () => '' },
];

function statusToLabel(status: string): string {
  const map: Record<string, string> = {
    'en_preparation': 'En preparation', 'en_livraison': 'En cours de livraison',
    'livre': 'Livre', 'retourne': 'Retourne', 'en_transit': 'En transit', 'echec': 'Echec',
  };
  return map[status] || status || '—';
}

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
      {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
      {connected ? 'Connecte' : 'Deconnecte'}
    </span>
  );
}

function ConnexionTab() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [phone, setPhone] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  useEffect(() => {
    fetch('/api/ai-chatbot/whatsapp/status')
      .then(r => r.json())
      .then(j => { setConnected(j.connected || false); setPhone(j.phone || ''); })
      .catch(() => setConnected(false));
    return stopPoll;
  }, []);

  const startPoll = () => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const j = await fetch('/api/ai-chatbot/whatsapp/status').then(r => r.json());
        if (j.connected) {
          setConnected(true); setPhone(j.phone || ''); setQr(null); setBusy(false);
          stopPoll();
          toast.success(`WhatsApp connecté${j.phone ? ` — +${j.phone}` : ''} !`);
        }
      } catch {}
    }, 3000);
  };

  const connect = async () => {
    setBusy(true); setQr(null);
    // Get QR directly from Green API
    const qrJson = await fetch('/api/ai-chatbot/whatsapp/qr').then(r => r.json()).catch(() => ({ error: 'Erreur réseau' }));
    if (qrJson.connected) { setConnected(true); setPhone(qrJson.phone || ''); setBusy(false); return; }
    if (!qrJson.qr) { toast.error(qrJson.error || 'Impossible d\'obtenir le QR code'); setBusy(false); return; }
    const qrData = qrJson.qr.startsWith('data:') ? qrJson.qr : `data:image/png;base64,${qrJson.qr}`;
    setQr(qrData); setBusy(false);
    startPoll();
  };

  const handleDisconnect = async () => {
    stopPoll();
    setConnected(false); setPhone(''); setQr(null);
    toast.success('Déconnecté');
  };

  const handleRefreshQr = async () => {
    stopPoll(); setBusy(true); setQr(null);
    const qrJson = await fetch('/api/ai-chatbot/whatsapp/qr').then(r => r.json()).catch(() => ({ error: 'Erreur réseau' }));
    if (!qrJson.qr) { toast.error(qrJson.error || 'QR non disponible'); setBusy(false); return; }
    const qrData = qrJson.qr.startsWith('data:') ? qrJson.qr : `data:image/png;base64,${qrJson.qr}`;
    setQr(qrData); setBusy(false);
    startPoll();
  };

  const handleCheckStatus = async () => {
    const j = await fetch('/api/ai-chatbot/whatsapp/status').then(r => r.json()).catch(() => ({}));
    setConnected(j.connected || false); setPhone(j.phone || '');
  };

  if (connected === null) return <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400" /></div>;

  return (
    <div className="max-w-xl space-y-6">
      {/* Statut */}
      <div className={`rounded-2xl p-5 border-2 ${connected ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${connected ? 'bg-green-500' : qr ? 'bg-amber-400' : 'bg-gray-300'}`}>
              <MessageSquare size={20} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">WhatsApp</p>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${connected ? 'bg-green-100 text-green-700' : qr ? 'bg-amber-100 text-amber-700' : busy ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                {connected ? <><Wifi size={12} /> Connecté</> : qr ? <><Loader2 size={12} className="animate-spin" /> En attente du scan...</> : busy ? <><Loader2 size={12} className="animate-spin" /> Connexion...</> : <><WifiOff size={12} /> Déconnecté</>}
              </span>
              {connected && phone && <p className="text-xs text-green-600 mt-0.5">+{phone}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCheckStatus} className="p-1.5 border border-gray-200 rounded-lg hover:bg-white">
              <RefreshCw size={14} className="text-gray-400" />
            </button>
            {connected && (
              <button onClick={handleDisconnect} className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50">
                Déconnecter
              </button>
            )}
          </div>
        </div>
      </div>

      {/* QR Code */}
      {!connected && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-2">
            <QrCode size={16} className="text-gray-500" />
            <h3 className="font-semibold text-gray-900">Connecter WhatsApp</h3>
          </div>

          {qr ? (
            <div className="flex flex-col items-center gap-3">
              <img src={qr} alt="QR Code WhatsApp" className="w-56 h-56 rounded-xl border border-gray-200" />
              <p className="text-xs text-gray-500 text-center">Ouvre WhatsApp → <strong>Appareils liés</strong> → scanne ce QR</p>
              <p className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg">QR expire en 20 secondes — rafraichis si expiré</p>
              <button onClick={handleRefreshQr} disabled={busy} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                <RefreshCw size={13} /> Nouveau QR
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-blue-50 rounded-xl p-4 space-y-1.5">
                {['Ton numero WhatsApp sera le numero d\'envoi des notifications', 'Aucun abonnement requis — utilise ton compte WhatsApp personnel ou Business', 'Session gérée par Evolution API'].map((t, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle size={13} className="text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-blue-800">{t}</p>
                  </div>
                ))}
              </div>
              <button onClick={connect} disabled={busy} className="w-full bg-green-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {busy ? <><Loader2 size={15} className="animate-spin" /> Génération QR...</> : <><QrCode size={15} /> Connecter WhatsApp</>}
              </button>
            </div>
          )}
        </div>
      )}

      {connected && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-3">
          <CheckCircle size={20} className="text-green-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">WhatsApp connecté</p>
            <p className="text-xs text-green-700">Les notifications de livraison seront envoyées depuis le +{phone}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function EnvoyerTab() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState('ne_repond_pas');
  const [customText, setCustomText] = useState('');
  const [sending, setSending] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [situationFilter, setSituationFilter] = useState('');
  const [subSituationFilter, setSubSituationFilter] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const PAGE_SIZE = 15;

  const fetchOrders = useCallback(async () => {
    setLoadingOrders(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (situationFilter) params.set('situation', situationFilter);
    const res = await fetch(`/api/orders?${params}`);
    const json = await res.json();
    setOrders(json.data || []);
    setTotal(json.count || 0);
    setLoadingOrders(false);
  }, [page, situationFilter]);

  useEffect(() => { fetch('/api/ai-chatbot/whatsapp/status').then(r => r.json()).then(j => setConnected(j.connected || false)); }, []);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useEffect(() => {
    setSubSituationFilter('');
    if (!situationFilter) return;
    const match = TEMPLATES.find(t => t.situation && situationFilter.includes(t.situation.split(' ')[0].toLowerCase()));
    if (match) setTemplateId(match.id);
  }, [situationFilter]);

  // Unique wilayas from loaded orders for sub-filter
  const SUB_SITUATIONS = ['Reporté à une date ultérieure', 'Ne répond pas 3', 'Ne répond pas 2', 'Ne répond pas 1'];

  // Apply wilaya sub-filter client-side
  const displayedOrders = subSituationFilter ? orders.filter(o => o.situation === subSituationFilter) : orders;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const template = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
  const previewOrder = orders[0] || MOCK_ORDER;
  const ordersWithPhone = displayedOrders.filter(o => o.customer_whatsapp && o.customer_whatsapp.length > 5);

  const toggleAll = () => {
    if (ordersWithPhone.every(o => selected.has(o.id))) setSelected(new Set());
    else setSelected(new Set(ordersWithPhone.map(o => o.id)));
  };

  const sendMessages = async () => {
    if (selected.size === 0) { toast.error('Selectionne au moins un client'); return; }
    const recipients = displayedOrders.filter(o => selected.has(o.id)).map(o => ({
      tracking: o.tracking_number, client: o.customer_name, whatsapp: o.customer_whatsapp,
      message: templateId === 'custom' ? customText : template.text(o),
    }));
    setSending(true);
    const res = await fetch('/api/whatsapp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients }) });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else { toast.success(`${json.sent} message(s) envoye(s)`); setSelected(new Set()); }
    setSending(false);
  };

  const sendTest = async () => {
    if (!testPhone) { toast.error('Entre un numero de telephone'); return; }
    const mockO = { ...MOCK_ORDER, whatsapp: testPhone };
    const message = templateId === 'custom' ? (customText || 'هذا رسالة تجريبية') : template.text(mockO);
    setSendingTest(true);
    const res = await fetch('/api/whatsapp/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: [{ tracking: 'TEST', client: 'Test', whatsapp: testPhone, message }] }),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else toast.success('Message de test envoye !');
    setSendingTest(false);
  };

  return (
    <div className="space-y-5">
      {connected === false && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <AlertCircle size={18} className="text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700">WhatsApp non connecte — va dans <strong>Connexion</strong> pour scanner le QR avant d'envoyer.</p>
        </div>
      )}

      {/* Filtre situation */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Situation :</span>
          <div className="flex flex-wrap gap-2">
            {SITUATION_FILTERS.map(f => (
              <button key={f.value} onClick={() => { setSituationFilter(f.value); setPage(1); setSelected(new Set()); }}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${situationFilter === f.value ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600 hover:border-green-400 hover:text-green-600'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {/* Sous-filtre wilaya */}
        {situationFilter === 'en cours de livraison' && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
            <div className="flex items-center gap-1 text-xs font-medium text-gray-500">
              <Filter size={11} /> Wilaya :
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setSubSituationFilter('')}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${subSituationFilter === '' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:border-blue-400 hover:text-blue-600'}`}>
                Toutes
              </button>
              {SUB_SITUATIONS.map(w => (
                <button key={w} onClick={() => setSubSituationFilter(w)}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${subSituationFilter === w ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:border-blue-400 hover:text-blue-600'}`}>
                  {w}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Templates */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2"><MessageSquare size={16} className="text-green-500" /><h3 className="font-semibold text-gray-900">Template (Darija)</h3></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TEMPLATES.map(t => (
            <button key={t.id} onClick={() => setTemplateId(t.id)}
              className={`text-xs px-3 py-2 rounded-xl border text-left font-medium transition-colors ${templateId === t.id ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {templateId === 'custom' ? (
          <textarea value={customText} onChange={e => setCustomText(e.target.value)} placeholder="كتب رسالتك..." rows={4} dir="rtl" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        ) : (
          <div>
            <p className="text-xs text-gray-400 mb-1">{orders.length > 0 ? 'Apercu (premier client)' : 'Apercu (exemple)'}</p>
            <div className="bg-green-50 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-line border border-green-100 text-right leading-relaxed" dir="rtl">
              {template.text(previewOrder)}
            </div>
          </div>
        )}
      </div>

      {/* Test de message */}
      <div className="bg-white rounded-2xl border border-blue-100 shadow-sm p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-blue-500" />
          <h3 className="font-semibold text-gray-900">Tester la reception</h3>
          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">Test</span>
        </div>
        <p className="text-xs text-gray-500">Entre un numero pour verifier que le message arrive bien avant d'envoyer en masse.</p>
        <div className="flex gap-2">
          <input
            value={testPhone}
            onChange={e => setTestPhone(e.target.value)}
            placeholder="ex: 0770 12 34 56"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={sendTest} disabled={!testPhone || sendingTest || !connected}
            className="flex items-center gap-1.5 text-sm px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium shrink-0">
            {sendingTest ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Envoyer test
          </button>
        </div>
      </div>

      {/* Bot IA */}
      <div className="border border-purple-200 rounded-2xl bg-purple-50 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
            <Zap size={18} className="text-purple-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-purple-900 text-sm">Bot IA — Réponses automatiques</span>
              <span className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                Actif
              </span>
            </div>
            <p className="text-xs text-purple-600 mt-0.5">
              Webhook à configurer dans Green API :
              <code className="ml-1 bg-purple-100 px-1.5 py-0.5 rounded text-purple-800 select-all">
                https://zrextrack.vercel.app/api/whatsapp/webhook
              </code>
            </p>
          </div>
        </div>
      </div>

      {/* Table des destinataires */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Users size={16} className="text-gray-500" />
            <h3 className="font-semibold text-gray-900">Destinataires</h3>
            <span className="text-xs text-gray-400">({subSituationFilter ? displayedOrders.length : total} commandes{subSituationFilter ? ` — ${subSituationFilter}` : ''})</span>
            {selected.size > 0 && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">{selected.size} selectionne(s)</span>}
          </div>
          <button onClick={sendMessages} disabled={sending || selected.size === 0 || !connected}
            className="flex items-center gap-1.5 text-sm px-5 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50 font-medium">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Envoyer ({selected.size})
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-3"><input type="checkbox" checked={ordersWithPhone.length > 0 && ordersWithPhone.every(o => selected.has(o.id))} onChange={toggleAll} className="rounded" /></th>
                <th className="px-4 py-3 text-left">Client</th>
                <th className="px-4 py-3 text-left">Tracking</th>
                <th className="px-4 py-3 text-left">Situation</th>
                <th className="px-4 py-3 text-left">Wilaya</th>
                <th className="px-4 py-3 text-left">Telephone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loadingOrders ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Chargement...</td></tr>
              ) : displayedOrders.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucune commande</td></tr>
              ) : displayedOrders.map(order => {
                const hasPhone = !!(order.customer_whatsapp && order.customer_whatsapp.length > 5);
                return (
                  <tr key={order.id} className={`transition-colors ${hasPhone ? 'hover:bg-gray-50 cursor-pointer' : 'opacity-40'}`}
                    onClick={() => { if (!hasPhone) return; setSelected(s => { const n = new Set(s); n.has(order.id) ? n.delete(order.id) : n.add(order.id); return n; }); }}>
                    <td className="px-4 py-3"><input type="checkbox" checked={selected.has(order.id)} disabled={!hasPhone} readOnly className="rounded" /></td>
                    <td className="px-4 py-3 font-medium text-gray-900">{order.customer_name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{order.tracking_number}</td>
                    <td className="px-4 py-3 text-xs"><span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{order.situation || statusToLabel(order.delivery_status)}</span></td>
                    <td className="px-4 py-3 text-gray-500">{order.wilaya || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{order.customer_whatsapp || <span className="text-red-400 text-xs">Aucun</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && !subSituationFilter && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50"><ChevronLeft size={14} /></button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50"><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HistoriqueTab() {
  const [messages, setMessages] = useState<MsgLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEchec, setFilterEchec] = useState(false);
  const [resending, setResending] = useState<Set<string>>(new Set());
  const [resendingAll, setResendingAll] = useState(false);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/messages?pageSize=200');
    const json = await res.json();
    setMessages(json.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  const resend = async (msg: MsgLog) => {
    setResending(s => new Set(s).add(msg.id));
    const res = await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: [{ tracking: msg.tracking_number, client: msg.customer_name, whatsapp: msg.customer_whatsapp, message: msg.message }] }),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else if (json.sent > 0) { toast.success('Message renvoyé !'); fetchMessages(); }
    else toast.error('Echec du renvoi');
    setResending(s => { const n = new Set(s); n.delete(msg.id); return n; });
  };

  const resendAll = async () => {
    const failed = displayed.filter(m => m.status === 'echec');
    if (failed.length === 0) return;
    setResendingAll(true);
    const recipients = failed.map(m => ({ tracking: m.tracking_number, client: m.customer_name, whatsapp: m.customer_whatsapp, message: m.message }));
    const res = await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients }),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else { toast.success(`${json.sent} message(s) renvoyé(s)`); fetchMessages(); }
    setResendingAll(false);
  };

  const statusConfig: Record<string, { label: string; bg: string }> = {
    envoye: { label: 'Envoye', bg: 'bg-green-100 text-green-700' },
    echec: { label: 'Echec', bg: 'bg-red-100 text-red-600' },
    en_attente: { label: 'En attente', bg: 'bg-amber-100 text-amber-700' },
  };

  const echecCount = messages.filter(m => m.status === 'echec').length;
  const displayed = filterEchec ? messages.filter(m => m.status === 'echec') : messages;

  return (
    <div className="space-y-4">
      {/* Bannière échecs */}
      {echecCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="text-red-500 shrink-0" />
            <p className="text-sm text-red-700 font-medium">{echecCount} message{echecCount > 1 ? 's' : ''} en échec — non livré{echecCount > 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={resendAll}
            disabled={resendingAll}
            className="flex items-center gap-1.5 text-sm px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 font-medium shrink-0"
          >
            {resendingAll ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Tout renvoyer
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <History size={16} className="text-gray-500" />
            <h3 className="font-semibold text-gray-900">Historique des messages</h3>
            {echecCount > 0 && <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">{echecCount} echec</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {echecCount > 0 && (
              <button
                onClick={resendAll}
                disabled={resendingAll}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 font-medium"
              >
                {resendingAll ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Tout renvoyer ({echecCount})
              </button>
            )}
            <button
              onClick={() => setFilterEchec(f => !f)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border font-medium transition-colors ${filterEchec ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-600 hover:border-red-400 hover:text-red-600'}`}
            >
              <AlertCircle size={12} />
              Echec seulement
            </button>
            <button onClick={fetchMessages} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <RefreshCw size={14} className="text-gray-400" />
            </button>
          </div>
        </div>

        <div className="divide-y divide-gray-50">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <MessageSquare size={32} className="mb-2 opacity-30" />
              <p className="text-sm">{filterEchec ? 'Aucun message en echec' : 'Aucun message envoye'}</p>
            </div>
          ) : displayed.map(msg => {
            const cfg = statusConfig[msg.status] || statusConfig.en_attente;
            const isResending = resending.has(msg.id);
            return (
              <div key={msg.id} className={`p-4 hover:bg-gray-50 ${msg.status === 'echec' ? 'border-l-2 border-red-300' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm">{msg.customer_name}</span>
                      <span className="text-xs text-gray-400">{msg.customer_whatsapp}</span>
                      {msg.tracking_number && <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">{msg.tracking_number}</span>}
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg}`}>{cfg.label}</span>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2 whitespace-pre-line text-right" dir="rtl">{msg.message}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className="text-[10px] text-gray-400">{new Date(msg.sent_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    {msg.status === 'echec' && (
                      <button
                        onClick={() => resend(msg)}
                        disabled={isResending}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-600 hover:text-white transition-colors disabled:opacity-50 font-medium"
                      >
                        {isResending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                        Renvoyer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface BotSettings {
  ai_enabled: boolean;
  language: 'darija' | 'arabic' | 'french';
  system_prompt: string;
  messages_received: number;
  ai_replies_sent: number;
  tracking_replies_sent: number;
}

const WEBHOOK_URL = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/whatsapp/webhook`;

const DEFAULT_PROMPTS: Record<string, string> = {
  darija: `Nta assistant livraison dial ZREXpress f l'Algérie. Jaweb 3la les clients bDarija Algérienne — mzyan, wjiz, w rassurant.
- Waqt livraison: 24 l 72 sa3a
- F cas problème: 9ol l client ibayno raqm tracking dyalo
- F cas retour: i9dir ikhalti ma3a l livreur wla i9bir l support
IMPORTANT: Jaweb DIMA bDarija Algérienne. Wjiz — maximum 2-3 jmla.`,
  arabic: `أنت مساعد توصيل لشركة ZREXpress في الجزائر. أجب باللغة العربية — واضح وموجز ومريح.
- وقت التوصيل: 24 إلى 72 ساعة
- في حالة المشكلة: اطلب رقم التتبع
- في حالة الإرجاع: تواصل مع السائق أو الدعم`,
  french: `Tu es l'assistant livraison de ZREXpress en Algérie. Réponds en français — clair, bref et rassurant.
- Délai de livraison: 24 à 72h
- En cas de problème: demande le numéro de tracking
- En cas de retour: contacter le livreur ou le support`,
};

interface ChatMsg { role: 'user' | 'bot'; text: string; type?: string; }

function BotIATab() {
  const [settings, setSettings] = useState<BotSettings>({
    ai_enabled: true, language: 'darija', system_prompt: '',
    messages_received: 0, ai_replies_sent: 0, tracking_replies_sent: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testChat, setTestChat] = useState<ChatMsg[]>([]);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/whatsapp/webhook`);
    fetch('/api/bot-settings').then(r => r.json()).then(j => {
      setSettings(s => ({ ...s, ...j }));
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/bot-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ai_enabled: settings.ai_enabled, language: settings.language, system_prompt: settings.system_prompt }),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else { toast.success('Paramètres bot sauvegardés !'); setSettings(s => ({ ...s, ...json })); }
    setSaving(false);
  };

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('URL copiée !');
  };

  const sendTest = async () => {
    if (!testInput.trim()) return;
    const userMsg = testInput.trim();
    setTestInput('');
    setTestChat(c => [...c, { role: 'user', text: userMsg }]);
    setTesting(true);
    const res = await fetch('/api/bot-settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMsg }),
    });
    const json = await res.json();
    if (json.error && !json.reply) {
      setTestChat(c => [...c, { role: 'bot', text: `❌ ${json.error}`, type: 'error' }]);
    } else {
      setTestChat(c => [...c, { role: 'bot', text: json.reply, type: json.type }]);
    }
    setTesting(false);
  };

  const promptPlaceholder = DEFAULT_PROMPTS[settings.language] || DEFAULT_PROMPTS.darija;

  if (loading) return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400" /></div>;

  return (
    <div className="max-w-2xl space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Messages reçus', value: settings.messages_received, color: 'bg-blue-50 text-blue-700' },
          { label: 'Réponses IA', value: settings.ai_replies_sent, color: 'bg-purple-50 text-purple-700' },
          { label: 'Tracking trouvé', value: settings.tracking_replies_sent, color: 'bg-green-50 text-green-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 text-center ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs mt-0.5 opacity-80">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Activation */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${settings.ai_enabled ? 'bg-purple-100' : 'bg-gray-100'}`}>
            <Bot size={20} className={settings.ai_enabled ? 'text-purple-600' : 'text-gray-400'} />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Bot IA (Gemini)</p>
            <p className="text-xs text-gray-500">Répond automatiquement aux messages sans numéro de tracking</p>
          </div>
        </div>
        <button
          onClick={() => setSettings(s => ({ ...s, ai_enabled: !s.ai_enabled }))}
          className="shrink-0"
        >
          {settings.ai_enabled
            ? <ToggleRight size={36} className="text-purple-600" />
            : <ToggleLeft size={36} className="text-gray-300" />
          }
        </button>
      </div>

      {/* Webhook URL */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-amber-500" />
          <h3 className="font-semibold text-gray-900">URL Webhook</h3>
          <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">À configurer dans Green API</span>
        </div>
        <p className="text-xs text-gray-500">Colle cette URL dans ton tableau de bord Green API → <strong>Notifications</strong>.</p>
        <div className="flex gap-2">
          <code className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs text-gray-700 break-all">
            {webhookUrl}
          </code>
          <button
            onClick={copyWebhook}
            className="flex items-center gap-1.5 text-sm px-3 py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 shrink-0"
          >
            <Copy size={14} className="text-gray-500" />
          </button>
        </div>
      </div>

      {/* Facebook Messenger */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 fill-white"><path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.259L19.752 8l-6.561 6.963z"/></svg>
          </div>
          <h3 className="font-semibold text-gray-900">Facebook Messenger</h3>
          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">Omnicanal</span>
        </div>
        <p className="text-xs text-gray-500">Connectez votre Page Facebook pour recevoir et répondre automatiquement aux messages Messenger.</p>
        <div className="space-y-2.5">
          <div className="bg-gray-50 rounded-xl p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-600">URL Webhook Facebook :</p>
            <code className="block text-xs text-gray-700 break-all">{typeof window !== 'undefined' ? window.location.origin : ''}/api/facebook/webhook</code>
          </div>
          <div className="bg-amber-50 rounded-xl p-3 space-y-1.5">
            <p className="text-xs font-semibold text-amber-800">Variables d'environnement requises :</p>
            <div className="space-y-1">
              {[
                { key: 'FACEBOOK_VERIFY_TOKEN', desc: 'Token de vérification webhook (défaut: zrextrack_fb_verify)' },
                { key: 'FACEBOOK_PAGE_ACCESS_TOKEN', desc: 'Token d\'accès page Meta' },
              ].map(v => (
                <div key={v.key} className="flex items-start gap-2">
                  <code className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-mono shrink-0">{v.key}</code>
                  <span className="text-[11px] text-amber-700">{v.desc}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-blue-50 rounded-xl p-3 space-y-1.5">
            <p className="text-xs font-semibold text-blue-800">Configuration étape par étape :</p>
            {[
              'Créer une app sur developers.facebook.com',
              'Ajouter le produit "Messenger" à l\'app',
              'Configurer le webhook avec l\'URL ci-dessus',
              'Définir FACEBOOK_VERIFY_TOKEN et FACEBOOK_PAGE_ACCESS_TOKEN',
              'Abonner la page au webhook (messages, messaging_postbacks)',
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="w-4 h-4 bg-blue-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-[11px] text-blue-800">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Google Sheets Export */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-green-600"><path d="M19.5 3h-15A1.5 1.5 0 003 4.5v15A1.5 1.5 0 004.5 21h15a1.5 1.5 0 001.5-1.5v-15A1.5 1.5 0 0019.5 3zm-10 13.5H7.5V15H9.5v1.5zm0-3H7.5V12H9.5v1.5zm0-3H7.5V9H9.5v1.5zm4 6h-2V15h2v1.5zm0-3h-2V12h2v1.5zm0-3h-2V9h2v1.5zm3.5 6H15V15h2v1.5zm0-3H15V12h2v1.5zm0-3H15V9h2v1.5z"/></svg>
          <h3 className="font-semibold text-gray-900">Export Google Sheets</h3>
          <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">Commandes & Réclamations</span>
        </div>
        <p className="text-xs text-gray-500">Chaque commande validée et chaque réclamation reçue via le chatbot sont automatiquement envoyées vers votre Google Sheets via un webhook.</p>
        <div className="bg-gray-50 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-600">Variable d'environnement :</p>
          <code className="block text-xs text-gray-700">GOOGLE_SHEETS_WEBHOOK_URL=https://hooks.zapier.com/...</code>
        </div>
        <div className="bg-green-50 rounded-xl p-3 space-y-1.5">
          <p className="text-xs font-semibold text-green-800">Comment configurer avec Make.com ou n8n :</p>
          {[
            'Créer un scénario/workflow avec un déclencheur "Webhook"',
            'Copier l\'URL du webhook générée',
            'Ajouter GOOGLE_SHEETS_WEBHOOK_URL dans vos variables d\'environnement Netlify',
            'Connecter le webhook à Google Sheets → Ajouter une ligne',
            'Les données envoyées incluent : type, timestamp, nom, téléphone, produits, adresse / réclamation',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-4 h-4 bg-green-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-[11px] text-green-800">{step}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-blue-500" />
          <h3 className="font-semibold text-gray-900">Langue du bot</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: 'darija', label: 'Darija 🇩🇿', sub: 'Dialecte algérien' },
            { value: 'arabic', label: 'العربية', sub: 'Arabe classique' },
            { value: 'french', label: 'Français 🇫🇷', sub: 'Français standard' },
          ].map(l => (
            <button
              key={l.value}
              onClick={() => setSettings(s => ({ ...s, language: l.value as any, system_prompt: s.system_prompt }))}
              className={`p-3 rounded-xl border text-left transition-colors ${settings.language === l.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
            >
              <p className="text-sm font-medium text-gray-900">{l.label}</p>
              <p className="text-xs text-gray-400">{l.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* System prompt */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-purple-500" />
            <h3 className="font-semibold text-gray-900">Prompt système</h3>
          </div>
          <button
            onClick={() => setSettings(s => ({ ...s, system_prompt: '' }))}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Réinitialiser
          </button>
        </div>
        <p className="text-xs text-gray-500">Laisse vide pour utiliser le prompt par défaut de la langue sélectionnée.</p>
        <textarea
          value={settings.system_prompt}
          onChange={e => setSettings(s => ({ ...s, system_prompt: e.target.value }))}
          placeholder={promptPlaceholder}
          rows={6}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none text-gray-700"
        />
      </div>

      {/* Logique bot explication */}
      <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4 space-y-2">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Logique du bot</p>
        <div className="space-y-1.5">
          {[
            { step: '1', text: 'Message reçu avec numéro de tracking → répond avec statut commande', color: 'bg-green-500' },
            { step: '2', text: 'Message sans tracking + IA activée → Gemini répond en darija/arabe/français', color: 'bg-purple-500' },
            { step: '3', text: 'IA désactivée ou erreur → message par défaut "envoie ton numéro de tracking"', color: 'bg-gray-400' },
          ].map(item => (
            <div key={item.step} className="flex items-start gap-2.5">
              <span className={`w-5 h-5 rounded-full ${item.color} text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5`}>{item.step}</span>
              <p className="text-xs text-gray-600">{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Test chatbot */}
      <div className="bg-white rounded-2xl border border-purple-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-purple-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-purple-100 rounded-lg flex items-center justify-center">
              <Bot size={14} className="text-purple-600" />
            </div>
            <h3 className="font-semibold text-gray-900">Tester le chatbot</h3>
            <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Simulation réelle</span>
          </div>
          {testChat.length > 0 && (
            <button onClick={() => setTestChat([])} className="text-xs text-gray-400 hover:text-gray-600">
              Effacer
            </button>
          )}
        </div>

        {/* Suggestions rapides */}
        <div className="px-4 pt-3 pb-2 flex flex-wrap gap-1.5">
          {[
            { label: 'Tracking valide', msg: 'ZR-123456' },
            { label: 'Tracking inexistant', msg: 'ZR-999999' },
            { label: 'Question darija', msg: 'وين طردي؟' },
            { label: 'Question française', msg: 'Où est ma commande ?' },
            { label: 'Retard livraison', msg: 'ما وصلنيش طردي من 3 أيام' },
          ].map(s => (
            <button
              key={s.label}
              onClick={() => setTestInput(s.msg)}
              className="text-[11px] px-2.5 py-1 bg-purple-50 text-purple-700 rounded-full border border-purple-200 hover:bg-purple-100 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Chat window */}
        <div className="mx-4 mb-3 h-64 overflow-y-auto bg-gray-50 rounded-xl p-3 space-y-3 flex flex-col">
          {testChat.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
              <Bot size={28} className="mb-2 opacity-30" />
              <p className="text-xs">Écris un message ou utilise les suggestions</p>
            </div>
          ) : (
            testChat.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-green-500 text-white rounded-br-sm'
                    : msg.type === 'error'
                    ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-sm'
                    : 'bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-sm'
                }`} dir={msg.role === 'bot' ? 'auto' : 'auto'}>
                  {msg.role === 'bot' && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Bot size={11} className={msg.type === 'error' ? 'text-red-500' : msg.type === 'tracking' ? 'text-green-500' : 'text-purple-500'} />
                      <span className="text-[10px] font-medium text-gray-400">
                        {msg.type === 'tracking' ? 'Tracking trouvé' : msg.type === 'tracking_not_found' ? 'Tracking introuvable' : msg.type === 'ai' ? 'Réponse IA' : msg.type === 'fallback' ? 'Fallback' : 'Erreur'}
                      </span>
                    </div>
                  )}
                  {msg.text}
                </div>
              </div>
            ))
          )}
          {testing && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex items-center gap-2">
                <Loader2 size={13} className="animate-spin text-purple-500" />
                <span className="text-xs text-gray-400">Le bot réfléchit...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-4 pb-4 flex gap-2">
          <input
            value={testInput}
            onChange={e => setTestInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendTest()}
            placeholder="Ex: ZR-123456 ou وين طردي؟"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            dir="auto"
          />
          <button
            onClick={sendTest}
            disabled={!testInput.trim() || testing}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-40 font-medium text-sm shrink-0"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full bg-purple-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
        Sauvegarder les paramètres
      </button>
    </div>
  );
}

const TABS = [
  { id: 'connexion', label: 'Connexion', icon: QrCode },
  { id: 'envoyer', label: 'Envoyer', icon: Send },
  { id: 'bot', label: 'Bot IA', icon: Bot },
  { id: 'historique', label: 'Historique', icon: History },
];

export default function MessagesPage() {
  const [tab, setTab] = useState('envoyer');
  return (
    <AppLayout>
      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center"><MessageSquare size={20} className="text-green-600" /></div>
          <div><h1 className="text-xl font-bold text-gray-900">Messages WhatsApp</h1><p className="text-sm text-gray-500">Envoyer des notifications en darija a tes clients</p></div>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {TABS.map(t => { const Icon = t.icon; return (
            <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Icon size={15} />{t.label}
              {t.id === 'bot' && <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />}
            </button>
          ); })}
        </div>
        {tab === 'connexion' && <ConnexionTab />}
        {tab === 'envoyer' && <EnvoyerTab />}
        {tab === 'bot' && <BotIATab />}
        {tab === 'historique' && <HistoriqueTab />}
      </div>
    </AppLayout>
  );
}
