'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import { MessageSquare, Wifi, WifiOff, QrCode, Send, History, CheckCircle, RefreshCw, ChevronLeft, ChevronRight, AlertCircle, Users, Loader2, Smartphone, Filter, Copy, Globe, RotateCcw, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface WASettings { instance_id: string; api_token: string; connected: boolean; phone: string; }
interface Order { id: string; tracking_number: string; customer_name: string; customer_whatsapp: string; situation: string; wilaya: string; delivery_status: string; cod: number; }
interface MsgLog { id: string; tracking_number: string; customer_name: string; customer_whatsapp: string; message: string; status: 'envoye' | 'echec' | 'en_attente'; sent_at: string; error_message?: string | null; }

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

// Template partagé (édité dans l'onglet « Templates », stocké via /api/templates).
// Les MÊMES templates servent à l'envoi manuel ET aux notifications automatiques.
interface DbTemplate {
  key: string;
  name: string;
  content_darija: string;
  content_arabic: string;
  content_french: string;
}

// Remplace les variables {{client}} {{tracking}} {{wilaya}} {{cod}} par les
// valeurs réelles d'une commande.
function renderTemplate(content: string, o: Order): string {
  return (content || '')
    .replace(/\{\{client\}\}/g, o.customer_name || 'cher client')
    .replace(/\{\{tracking\}\}/g, o.tracking_number || '')
    .replace(/\{\{wilaya\}\}/g, o.wilaya || '')
    .replace(/\{\{cod\}\}/g, String(o.cod ?? ''));
}

// Quand on filtre par situation, on pré-sélectionne le template correspondant.
const SITUATION_TO_KEY: Record<string, string> = {
  'commande annul': 'commande_annulee',
  'commune erron': 'commune_erronee',
  'en cours de livraison': 'en_livraison',
  'livr': 'livre',
  'retour': 'retourne',
  'en transit': 'en_transit',
  'en preparation': 'en_transit',
};

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

    // Ensure instance exists
    const instJson = await fetch('/api/ai-chatbot/whatsapp/instance').then(r => r.json()).catch(() => ({}));
    if (!instJson.instance) {
      const cr = await fetch('/api/ai-chatbot/whatsapp/instance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
      }).then(r => r.json()).catch(() => ({ error: 'Erreur réseau' }));
      if (cr.error) { toast.error(cr.error); setBusy(false); return; }
    }

    // Get QR from Evolution API
    const qrJson = await fetch('/api/ai-chatbot/whatsapp/qr').then(r => r.json()).catch(() => ({ error: 'Erreur réseau' }));
    if (qrJson.connected) { setConnected(true); setPhone(qrJson.phone || ''); setBusy(false); return; }
    if (!qrJson.qr) { toast.error(qrJson.error || 'Impossible d\'obtenir le QR'); setBusy(false); return; }

    const qrData = qrJson.qr.startsWith('data:') ? qrJson.qr : `data:image/png;base64,${qrJson.qr}`;
    setQr(qrData); setBusy(false);
    startPoll();
  };

  const handleDisconnect = async () => {
    stopPoll();
    await fetch('/api/ai-chatbot/whatsapp/instance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    }).catch(() => {});
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

  if (connected === null) return <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400 dark:text-stone-500" /></div>;

  return (
    <div className="max-w-xl space-y-6">
      {/* Statut */}
      <div className={`rounded-2xl p-5 border-2 ${connected ? 'border-green-200 bg-green-50' : 'border-stone-200 dark:border-stone-700 bg-gray-50'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${connected ? 'bg-green-500' : qr ? 'bg-amber-400' : 'bg-gray-300'}`}>
              <MessageSquare size={20} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-stone-100">WhatsApp</p>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${connected ? 'bg-green-100 text-green-700' : qr ? 'bg-amber-100 text-amber-700' : busy ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                {connected ? <><Wifi size={12} /> Connecté</> : qr ? <><Loader2 size={12} className="animate-spin" /> En attente du scan...</> : busy ? <><Loader2 size={12} className="animate-spin" /> Connexion...</> : <><WifiOff size={12} /> Déconnecté</>}
              </span>
              {connected && phone && <p className="text-xs text-green-600 mt-0.5">+{phone}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCheckStatus} className="p-1.5 border border-stone-200 dark:border-stone-700 rounded-lg hover:bg-white dark:bg-stone-900">
              <RefreshCw size={14} className="text-gray-400 dark:text-stone-500" />
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
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-2">
            <QrCode size={16} className="text-gray-500 dark:text-stone-400" />
            <h3 className="font-semibold text-gray-900 dark:text-stone-100">Connecter WhatsApp</h3>
          </div>

          {qr ? (
            <div className="flex flex-col items-center gap-3">
              <img src={qr} alt="QR Code WhatsApp" className="w-56 h-56 rounded-xl border border-stone-200 dark:border-stone-700" />
              <p className="text-xs text-gray-500 dark:text-stone-400 text-center">Ouvre WhatsApp → <strong>Appareils liés</strong> → scanne ce QR</p>
              <p className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg">QR expire en 20 secondes — rafraichis si expiré</p>
              <button onClick={handleRefreshQr} disabled={busy} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg hover:bg-stone-50 dark:hover:bg-stone-800 disabled:opacity-50">
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
  const [templates, setTemplates] = useState<DbTemplate[]>([]);
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
  useEffect(() => { fetch('/api/templates').then(r => r.json()).then(j => setTemplates(j.data || [])).catch(() => {}); }, []);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useEffect(() => {
    setSubSituationFilter('');
    if (!situationFilter) return;
    const key = SITUATION_TO_KEY[situationFilter];
    if (key) setTemplateId(key);
  }, [situationFilter]);

  // Unique wilayas from loaded orders for sub-filter
  const SUB_SITUATIONS = ['Reporté à une date ultérieure', 'Ne répond pas 3', 'Ne répond pas 2', 'Ne répond pas 1'];

  // Apply wilaya sub-filter client-side
  const displayedOrders = subSituationFilter ? orders.filter(o => o.situation === subSituationFilter) : orders;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const template = templates.find(t => t.key === templateId) || null;
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
      message: templateId === 'custom' ? customText : renderTemplate(template?.content_darija ?? '', o),
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
    const message = templateId === 'custom' ? (customText || 'هذا رسالة تجريبية') : renderTemplate(template?.content_darija ?? '', mockO);
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
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-stone-200">Situation :</span>
          <div className="flex flex-wrap gap-2">
            {SITUATION_FILTERS.map(f => (
              <button key={f.value} onClick={() => { setSituationFilter(f.value); setPage(1); setSelected(new Set()); }}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${situationFilter === f.value ? 'bg-green-600 text-white border-green-600' : 'border-stone-200 dark:border-stone-700 text-gray-600 dark:text-stone-300 hover:border-green-400 hover:text-green-600'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {/* Sous-filtre wilaya */}
        {situationFilter === 'en cours de livraison' && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
            <div className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-stone-400">
              <Filter size={11} /> Wilaya :
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setSubSituationFilter('')}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${subSituationFilter === '' ? 'bg-blue-600 text-white border-blue-600' : 'border-stone-200 dark:border-stone-700 text-gray-500 dark:text-stone-400 hover:border-blue-400 hover:text-blue-600'}`}>
                Toutes
              </button>
              {SUB_SITUATIONS.map(w => (
                <button key={w} onClick={() => setSubSituationFilter(w)}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${subSituationFilter === w ? 'bg-blue-600 text-white border-blue-600' : 'border-stone-200 dark:border-stone-700 text-gray-500 dark:text-stone-400 hover:border-blue-400 hover:text-blue-600'}`}>
                  {w}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Templates */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2"><MessageSquare size={16} className="text-green-500" /><h3 className="font-semibold text-gray-900 dark:text-stone-100">Template (Darija)</h3></div>
          <span className="text-[11px] text-gray-400 dark:text-stone-500">✏️ Modifiable dans l'onglet « Templates »</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {templates.map(t => (
            <button key={t.key} onClick={() => setTemplateId(t.key)}
              className={`text-xs px-3 py-2 rounded-xl border text-left font-medium transition-colors ${templateId === t.key ? 'border-green-500 bg-green-50 text-green-700' : 'border-stone-200 dark:border-stone-700 text-gray-600 dark:text-stone-300 hover:border-gray-300'}`}>
              {t.name}
            </button>
          ))}
          <button onClick={() => setTemplateId('custom')}
            className={`text-xs px-3 py-2 rounded-xl border text-left font-medium transition-colors ${templateId === 'custom' ? 'border-green-500 bg-green-50 text-green-700' : 'border-stone-200 dark:border-stone-700 text-gray-600 dark:text-stone-300 hover:border-gray-300'}`}>
            Personnalisé
          </button>
        </div>
        {templateId === 'custom' ? (
          <textarea value={customText} onChange={e => setCustomText(e.target.value)} placeholder="كتب رسالتك..." rows={4} dir="rtl" className="w-full border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
        ) : (
          <div>
            <p className="text-xs text-gray-400 dark:text-stone-500 mb-1">{orders.length > 0 ? 'Apercu (premier client)' : 'Apercu (exemple)'}</p>
            <div className="bg-green-50 rounded-xl p-4 text-sm text-gray-800 dark:text-stone-100 whitespace-pre-line border border-green-100 text-right leading-relaxed" dir="rtl">
              {renderTemplate(template?.content_darija ?? '', previewOrder)}
            </div>
          </div>
        )}
      </div>

      {/* Test de message */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-blue-100 shadow-sm p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-blue-500" />
          <h3 className="font-semibold text-gray-900 dark:text-stone-100">Tester la reception</h3>
          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">Test</span>
        </div>
        <p className="text-xs text-gray-500 dark:text-stone-400">Entre un numero pour verifier que le message arrive bien avant d'envoyer en masse.</p>
        <div className="flex gap-2">
          <input
            value={testPhone}
            onChange={e => setTestPhone(e.target.value)}
            placeholder="ex: 0770 12 34 56"
            className="flex-1 border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={sendTest} disabled={!testPhone || sendingTest || !connected}
            className="flex items-center gap-1.5 text-sm px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium shrink-0">
            {sendingTest ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Envoyer test
          </button>
        </div>
      </div>

      {/* Table des destinataires */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-100 dark:border-stone-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Users size={16} className="text-gray-500 dark:text-stone-400" />
            <h3 className="font-semibold text-gray-900 dark:text-stone-100">Destinataires</h3>
            <span className="text-xs text-gray-400 dark:text-stone-500">({subSituationFilter ? displayedOrders.length : total} commandes{subSituationFilter ? ` — ${subSituationFilter}` : ''})</span>
            {selected.size > 0 && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">{selected.size} selectionne(s)</span>}
          </div>
          <button onClick={sendMessages} disabled={sending || selected.size === 0 || !connected}
            className="flex items-center gap-1.5 text-sm px-5 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50 font-medium">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Envoyer ({selected.size})
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 dark:text-stone-400 uppercase">
              <tr>
                <th className="px-4 py-3"><input type="checkbox" checked={ordersWithPhone.length > 0 && ordersWithPhone.every(o => selected.has(o.id))} onChange={toggleAll} className="rounded" /></th>
                <th className="px-4 py-3 text-left">Client</th>
                <th className="px-4 py-3 text-left">Tracking</th>
                <th className="px-4 py-3 text-left">Situation</th>
                <th className="px-4 py-3 text-left">Wilaya</th>
                <th className="px-4 py-3 text-left">Telephone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
              {loadingOrders ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-stone-500">Chargement...</td></tr>
              ) : displayedOrders.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-stone-500">Aucune commande</td></tr>
              ) : displayedOrders.map(order => {
                const hasPhone = !!(order.customer_whatsapp && order.customer_whatsapp.length > 5);
                return (
                  <tr key={order.id} className={`transition-colors ${hasPhone ? 'hover:bg-stone-50 dark:hover:bg-stone-800 cursor-pointer' : 'opacity-40'}`}
                    onClick={() => { if (!hasPhone) return; setSelected(s => { const n = new Set(s); n.has(order.id) ? n.delete(order.id) : n.add(order.id); return n; }); }}>
                    <td className="px-4 py-3"><input type="checkbox" checked={selected.has(order.id)} disabled={!hasPhone} readOnly className="rounded" /></td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-stone-100">{order.customer_name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-stone-300">{order.tracking_number}</td>
                    <td className="px-4 py-3 text-xs"><span className="bg-gray-100 text-gray-600 dark:text-stone-300 px-2 py-0.5 rounded-full">{order.situation || statusToLabel(order.delivery_status)}</span></td>
                    <td className="px-4 py-3 text-gray-500 dark:text-stone-400">{order.wilaya || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-stone-400">{order.customer_whatsapp || <span className="text-red-400 text-xs">Aucun</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && !subSituationFilter && (
          <div className="px-4 py-3 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-stone-400">Page {page} / {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 border rounded-lg disabled:opacity-40 hover:bg-stone-50 dark:hover:bg-stone-800"><ChevronLeft size={14} /></button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 border rounded-lg disabled:opacity-40 hover:bg-stone-50 dark:hover:bg-stone-800"><ChevronRight size={14} /></button>
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

  // Statut live de la connexion WhatsApp — affiché en bannière pour expliquer
  // au user *pourquoi* ses envois échouent avant qu'il ne clique « renvoyer ».
  const [waStatus, setWaStatus] = useState<{ connected: boolean; status: string } | null>(null);
  const [statusChecking, setStatusChecking] = useState(false);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/messages?pageSize=200');
    const json = await res.json();
    setMessages(json.data || []);
    setLoading(false);
  }, []);

  const checkWaStatus = useCallback(async () => {
    setStatusChecking(true);
    try {
      const res = await fetch('/api/whatsapp/status');
      const json = await res.json();
      setWaStatus({ connected: !!json.connected, status: json.status || 'unknown' });
    } catch {
      setWaStatus({ connected: false, status: 'unreachable' });
    } finally {
      setStatusChecking(false);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
    checkWaStatus();
  }, [fetchMessages, checkWaStatus]);

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
    else toast.error(`Echec du renvoi${json.results?.[0]?.error ? ' : ' + json.results[0].error : ''}`);
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
    if (json.code === 'NOT_CONNECTED') {
      // Erreur claire avec hint : on garde l'info visible, pas juste un toast éphémère
      toast.error(`${json.error}${json.hint ? '\n' + json.hint : ''}`, { duration: 8000 });
      checkWaStatus(); // refresh la bannière
    } else if (json.code === 'DAILY_LIMIT_REACHED') {
      // Protection anti-suspension : on ne dépasse pas le plafond journalier
      toast.error(`${json.error}\n${json.hint || ''}\nDéjà envoyé : ${json.sentToday}/${json.dailyLimit} en 24h`, { duration: 12000 });
    } else if (json.sessionDead) {
      // Evolution dit « open » mais Baileys est mort → on signale clairement
      toast.error(json.hint || 'Session WhatsApp expirée — reconnecte le QR', { duration: 10000 });
      checkWaStatus();
      fetchMessages(); // affiche quand même les nouveaux échecs (pour debug)
    } else if (json.circuitBroken) {
      // Coupe-circuit anti-spam déclenché
      toast.warning(`${json.sent} envoyé(s), ${json.failed} échec(s) — ${json.hint}`, { duration: 10000 });
      fetchMessages();
    } else if (json.error) {
      toast.error(json.error);
    } else {
      const quotaMsg = json.dailyLimit ? ` · Quota : ${json.sentToday}/${json.dailyLimit}` : '';
      const skipped = json.skippedForQuota ? ` · ${json.skippedForQuota} sautés (quota)` : '';
      toast.success(`${json.sent}/${failed.length} message(s) renvoyé(s)${json.failed > 0 ? ` — ${json.failed} échec(s)` : ''}${skipped}${quotaMsg}`);
      fetchMessages();
    }
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
      {/* Bannière protections anti-suspension — visible en permanence pour rappeler
          les règles automatiques qui protègent le numéro WhatsApp d'être banni. */}
      <details className="bg-blue-50 border border-blue-200 rounded-2xl text-xs text-blue-900 group">
        <summary className="px-4 py-2.5 cursor-pointer flex items-center gap-2 font-medium select-none">
          <AlertCircle size={14} className="text-blue-600 shrink-0" />
          <span>Protections anti-suspension WhatsApp actives</span>
          <span className="ml-auto text-blue-500 text-[10px] group-open:hidden">▼ détails</span>
          <span className="ml-auto text-blue-500 text-[10px] hidden group-open:inline">▲ masquer</span>
        </summary>
        <div className="px-4 pb-3 pt-1 space-y-1.5 text-blue-800">
          <p>Pour éviter que ton numéro soit suspendu pour spam, AutoTim applique automatiquement :</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><strong>Plafond 100 messages / 24h</strong> glissant — au-delà, le batch est refusé</li>
            <li><strong>Délai aléatoire 3-6 sec</strong> entre chaque envoi — pas de rythme robotique</li>
            <li><strong>Variation du texte</strong> (emoji + caractère invisible) — chaque message a une signature unique pour WhatsApp</li>
            <li><strong>Coupe-circuit</strong> : si 5 envois consécutifs échouent, le batch s'arrête automatiquement</li>
          </ul>
          <p className="pt-1 text-[11px] text-blue-700">Conseils complémentaires : démarre un nouveau numéro avec 20-30 messages/jour pendant 1 semaine, puis augmente progressivement. Évite d'envoyer entre 22h et 8h.</p>
        </div>
      </details>

      {/* Bannière statut connexion WhatsApp — diagnostic principal du « pourquoi
          mes messages échouent ». Si la session WA est déconnectée, ne pas
          essayer de renvoyer en masse — ça générera juste 200 échecs de plus. */}
      {waStatus && !waStatus.connected && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="text-amber-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">WhatsApp déconnecté — c'est pour ça que tes messages échouent</p>
              <p className="text-xs text-amber-700 mt-0.5">État backend : <code className="font-mono">{waStatus.status}</code>. Reconnecte WhatsApp avant de renvoyer.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={checkWaStatus} disabled={statusChecking} className="p-2 hover:bg-amber-100 rounded-lg disabled:opacity-50" title="Vérifier à nouveau">
              <RefreshCw size={14} className={`text-amber-700 ${statusChecking ? 'animate-spin' : ''}`} />
            </button>
            <a
              href="?tab=connexion"
              className="text-sm px-4 py-2 bg-amber-600 text-white rounded-xl hover:bg-amber-700 font-medium"
            >
              Reconnecter
            </a>
          </div>
        </div>
      )}
      {waStatus?.connected && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-green-700">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            WhatsApp connecté ✓
          </div>
          <button onClick={checkWaStatus} disabled={statusChecking} className="text-green-600 hover:text-green-800" title="Rafraîchir">
            <RefreshCw size={11} className={statusChecking ? 'animate-spin' : ''} />
          </button>
        </div>
      )}

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

      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <History size={16} className="text-gray-500 dark:text-stone-400" />
            <h3 className="font-semibold text-gray-900 dark:text-stone-100">Historique des messages</h3>
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
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border font-medium transition-colors ${filterEchec ? 'bg-red-600 text-white border-red-600' : 'border-stone-200 dark:border-stone-700 text-gray-600 dark:text-stone-300 hover:border-red-400 hover:text-red-600'}`}
            >
              <AlertCircle size={12} />
              Echec seulement
            </button>
            <button onClick={fetchMessages} className="p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg">
              <RefreshCw size={14} className="text-gray-400 dark:text-stone-500" />
            </button>
          </div>
        </div>

        <div className="divide-y divide-stone-50 dark:divide-stone-800">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin text-gray-400 dark:text-stone-500" /></div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-stone-500">
              <MessageSquare size={32} className="mb-2 opacity-30" />
              <p className="text-sm">{filterEchec ? 'Aucun message en echec' : 'Aucun message envoye'}</p>
            </div>
          ) : displayed.map(msg => {
            const cfg = statusConfig[msg.status] || statusConfig.en_attente;
            const isResending = resending.has(msg.id);
            return (
              <div key={msg.id} className={`p-4 hover:bg-stone-50 dark:hover:bg-stone-800 ${msg.status === 'echec' ? 'border-l-2 border-red-300' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-medium text-gray-900 dark:text-stone-100 text-sm">{msg.customer_name}</span>
                      <span className="text-xs text-gray-400 dark:text-stone-500">{msg.customer_whatsapp}</span>
                      {msg.tracking_number && <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 dark:text-stone-400">{msg.tracking_number}</span>}
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg}`}>{cfg.label}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-stone-400 line-clamp-2 whitespace-pre-line text-right" dir="rtl">{msg.message}</p>
                    {/* Raison de l'échec — visible directement sur la ligne, plus
                        besoin de cliquer Renvoyer pour comprendre pourquoi */}
                    {msg.status === 'echec' && msg.error_message && (
                      <p className="text-[11px] text-red-600 mt-1 font-medium flex items-start gap-1">
                        <AlertCircle size={10} className="mt-0.5 shrink-0" />
                        <span className="break-all">{msg.error_message}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className="text-[10px] text-gray-400 dark:text-stone-500">{new Date(msg.sent_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
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

// ─── Onglet « Templates » — éditeur des messages WhatsApp en 3 langues ───────
// C'est désormais le SEUL endroit pour éditer les templates (l'ancienne page
// Paramètres a été fusionnée ici). Stockés via /api/templates ; utilisés à la
// fois par l'envoi manuel (onglet Envoyer) et les notifications automatiques.

interface EditableTemplate extends DbTemplate {
  id?: string | null;
  is_active?: boolean;
}

const TPL_LANGS = [
  { id: 'content_darija', label: 'Darija 🇩🇿', dir: 'rtl' },
  { id: 'content_arabic', label: 'العربية', dir: 'rtl' },
  { id: 'content_french', label: 'Français 🇫🇷', dir: 'ltr' },
] as const;

const TPL_VARS = ['{{client}}', '{{tracking}}', '{{wilaya}}', '{{cod}}'];

type LangKey = 'content_darija' | 'content_arabic' | 'content_french';

function TemplateEditCard({ tpl, def, onSave }: { tpl: EditableTemplate; def?: EditableTemplate; onSave: (t: EditableTemplate) => Promise<void>; }) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<LangKey>('content_darija');
  const [form, setForm] = useState<EditableTemplate>(tpl);
  const [saving, setSaving] = useState(false);

  const langCfg = TPL_LANGS.find(l => l.id === lang)!;
  const content = form[lang] as string;

  const save = async () => { setSaving(true); await onSave(form); setSaving(false); };

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center"><MessageSquare size={15} className="text-green-600" /></div>
          <span className="font-semibold text-gray-900 dark:text-stone-100">{tpl.name}</span>
          <span className="text-xs text-gray-400 dark:text-stone-500 font-mono">{tpl.key}</span>
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400 dark:text-stone-500" /> : <ChevronDown size={16} className="text-gray-400 dark:text-stone-500" />}
      </button>
      {open && (
        <div className="border-t border-stone-100 dark:border-stone-800 p-5 space-y-4">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {TPL_LANGS.map(l => (
              <button key={l.id} onClick={() => setLang(l.id as LangKey)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${lang === l.id ? 'bg-white dark:bg-stone-900 text-gray-900 dark:text-stone-100 shadow-sm' : 'text-gray-500 dark:text-stone-400'}`}>{l.label}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TPL_VARS.map(v => (
              <button key={v} onClick={() => setForm(f => ({ ...f, [lang]: (f[lang] as string) + v }))} className="text-[10px] font-mono bg-green-50 text-green-700 px-1.5 py-0.5 rounded border border-green-200 hover:bg-green-100">{v}</button>
            ))}
          </div>
          <textarea value={content} onChange={e => setForm(f => ({ ...f, [lang]: e.target.value }))} rows={5} dir={langCfg.dir} className="w-full border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
          <div className="flex gap-2">
            {def && (
              <button onClick={() => setForm(f => ({ ...f, [lang]: def[lang] as string }))} className="flex items-center gap-1.5 text-xs px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg hover:bg-stone-50 dark:hover:bg-stone-800 text-gray-500 dark:text-stone-400"><RotateCcw size={12} /> Réinitialiser</button>
            )}
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-sm px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium ml-auto">{saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Sauvegarder</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState<EditableTemplate[]>([]);
  const [defaults, setDefaults] = useState<EditableTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/templates');
    const json = await res.json();
    setTemplates(json.data || []);
    setDefaults(json.defaults || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (t: EditableTemplate) => {
    const res = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...t, is_active: true }) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return; }
    toast.success('Template sauvegardé !');
    setTemplates(prev => prev.map(p => p.key === t.key ? { ...p, ...t } : p));
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
        <Globe size={16} className="text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700">
          <span className="font-medium">Vos messages, en 3 langues</span>
          <span className="ml-1">— modifiez chaque template (Darija, Arabe, Français). Ils servent à la fois à l'envoi manuel et aux notifications automatiques. Variables :</span>
          <span className="ml-1">{TPL_VARS.map(v => <code key={v} className="mx-0.5 bg-blue-100 px-1.5 py-0.5 rounded text-blue-800 text-xs font-mono">{v}</code>)}</span>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400 dark:text-stone-500" /></div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <TemplateEditCard key={t.key} tpl={t} def={defaults.find(d => d.key === t.key)} onSave={save} />
          ))}
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: 'connexion', label: 'Connexion', icon: QrCode },
  { id: 'envoyer', label: 'Envoyer', icon: Send },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'historique', label: 'Historique', icon: History },
];

export default function MessagesPage() {
  const [tab, setTab] = useState('envoyer');
  return (
    <AppLayout>
      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center"><MessageSquare size={20} className="text-green-600" /></div>
          <div><h1 className="text-xl font-bold text-gray-900 dark:text-stone-100">Messages WhatsApp</h1><p className="text-sm text-gray-500 dark:text-stone-400">Envoyer des notifications en darija a tes clients</p></div>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {TABS.map(t => { const Icon = t.icon; return (
            <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? 'bg-white dark:bg-stone-900 text-gray-900 dark:text-stone-100 shadow-sm' : 'text-gray-500 dark:text-stone-400 hover:text-gray-700 dark:text-stone-200'}`}>
              <Icon size={15} />{t.label}
            </button>
          ); })}
        </div>
        {tab === 'connexion' && <ConnexionTab />}
        {tab === 'envoyer' && <EnvoyerTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'historique' && <HistoriqueTab />}
      </div>
    </AppLayout>
  );
}
