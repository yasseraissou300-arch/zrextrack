'use client';

import React, { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import {
  MessageSquare, Wifi, WifiOff, QrCode, Send, History,
  CheckCircle, XCircle, Clock, RefreshCw, ChevronLeft, ChevronRight,
  Settings, AlertCircle, Users, Loader2
} from 'lucide-react';
import { toast } from 'sonner';

interface WASettings {
  instance_id: string;
  api_token: string;
  connected: boolean;
  phone: string;
}

interface Order {
  id: string;
  tracking: string;
  client: string;
  whatsapp: string;
  situation: string;
  wilaya: string;
  status: string;
  cod: number;
  delivery_fees: number;
}

interface MsgLog {
  id: string;
  tracking: string;
  client: string;
  whatsapp: string;
  message: string;
  status: 'envoye' | 'echec' | 'en_attente';
  sent_at: string;
}

const TEMPLATES = [
  {
    id: 'situation',
    label: 'Situation du colis',
    text: (o: Order) =>
      `Bonjour ${o.client} 👋\n\nVotre colis *${o.tracking}* est actuellement :\n📦 *${o.situation || o.status}*\n\nMerci pour votre confiance ! 🙏`,
  },
  {
    id: 'livraison',
    label: 'En cours de livraison',
    text: (o: Order) =>
      `Bonjour ${o.client} 👋\n\nVotre colis *${o.tracking}* est en cours de livraison aujourd'hui à *${o.wilaya}*.\n\nMontant à payer : *${o.cod} DA*\n\nMerci ! 🚚`,
  },
  {
    id: 'echec',
    label: 'Tentative échouée',
    text: (o: Order) =>
      `Bonjour ${o.client} 👋\n\nNous n'avons pas pu livrer votre colis *${o.tracking}* aujourd'hui.\n\nMerci de nous contacter pour reprogrammer la livraison. 📞`,
  },
  {
    id: 'custom',
    label: 'Message personnalisé',
    text: () => '',
  },
];

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
      connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
    }`}>
      {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
      {connected ? 'Connecté' : 'Déconnecté'}
    </span>
  );
}

function ConnexionTab() {
  const [settings, setSettings] = useState<WASettings>({ instance_id: '', api_token: '', connected: false, phone: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [qrData, setQrData] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [statusChecking, setStatusChecking] = useState(false);
  const [form, setForm] = useState({ instance_id: '', api_token: '' });

  useEffect(() => { fetchSettings(); }, []);

  const fetchSettings = async () => {
    setLoading(true);
    const res = await fetch('/api/whatsapp/settings');
    const json = await res.json();
    setSettings(json);
    setForm({ instance_id: json.instance_id || '', api_token: json.api_token || '' });
    setLoading(false);
  };

  const saveSettings = async () => {
    if (!form.instance_id || !form.api_token) { toast.error('Remplis les deux champs'); return; }
    setSaving(true);
    const res = await fetch('/api/whatsapp/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_id: form.instance_id, api_token: form.api_token }),
    });
    const json = await res.json();
    if (json.error) { toast.error(json.error); }
    else { toast.success('Credentials sauvegardés !'); setSettings(s => ({ ...s, instance_id: form.instance_id, api_token: form.api_token })); }
    setSaving(false);
  };

  const getQR = async () => {
    setQrLoading(true); setQrData(null);
    const res = await fetch('/api/whatsapp/qr');
    const json = await res.json();
    if (json.type === 'qrCode') { setQrData(json.message); }
    else if (json.type === 'alreadyLogged') { toast.success('Déjà connecté !'); checkStatus(); }
    else { toast.error(json.message || 'Erreur QR'); }
    setQrLoading(false);
  };

  const checkStatus = async () => {
    setStatusChecking(true);
    const res = await fetch('/api/whatsapp/status');
    const json = await res.json();
    setSettings(s => ({ ...s, connected: json.connected }));
    if (json.connected) { toast.success('WhatsApp connecté ! ✅'); setQrData(null); }
    else { toast.error('Pas encore connecté — scanne le QR'); }
    setStatusChecking(false);
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 size={24} className="animate-spin" /></div>;

  return (
    <div className="max-w-xl space-y-6">
      <div className={`rounded-2xl p-5 border-2 ${settings.connected ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${settings.connected ? 'bg-green-500' : 'bg-gray-300'}`}>
              <MessageSquare size={20} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">WhatsApp</p>
              <StatusBadge connected={settings.connected} />
            </div>
          </div>
          <button onClick={checkStatus} disabled={statusChecking} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-white disabled:opacity-50">
            {statusChecking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Vérifier
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Settings size={16} className="text-gray-500" />
          <h3 className="font-semibold text-gray-900">Credentials Green API</h3>
        </div>
        <p className="text-sm text-gray-500">
          Crée un compte gratuit sur{' '}
          <a href="https://console.green-api.com" target="_blank" rel="noreferrer" className="text-green-600 underline font-medium">console.green-api.com</a>,
          crée une instance, puis copie l'<strong>Instance ID</strong> et le <strong>API Token</strong>.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Instance ID</label>
            <input value={form.instance_id} onChange={e => setForm(f => ({ ...f, instance_id: e.target.value }))}
              placeholder="ex: 1234567890"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">API Token</label>
            <input value={form.api_token} onChange={e => setForm(f => ({ ...f, api_token: e.target.value }))}
              placeholder="ex: abc123xyz..." type="password"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <button onClick={saveSettings} disabled={saving} className="w-full bg-gray-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-gray-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Sauvegarder
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <QrCode size={16} className="text-gray-500" />
          <h3 className="font-semibold text-gray-900">Scanner le QR Code</h3>
        </div>
        <p className="text-sm text-gray-500">
          Ouvre <strong>WhatsApp</strong> sur ton téléphone → <strong>Appareils liés</strong> → <strong>Lier un appareil</strong> → scanne le QR.
        </p>
        {qrData ? (
          <div className="flex flex-col items-center gap-3">
            <img src={`data:image/png;base64,${qrData}`} alt="QR Code WhatsApp" className="w-56 h-56 rounded-xl border border-gray-200" />
            <p className="text-xs text-gray-400">Le QR expire en 45 secondes</p>
            <div className="flex gap-2">
              <button onClick={getQR} disabled={qrLoading} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50">
                <RefreshCw size={14} /> Rafraîchir
              </button>
              <button onClick={checkStatus} disabled={statusChecking} className="flex items-center gap-1.5 text-sm px-4 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700">
                {statusChecking ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                J'ai scanné ✓
              </button>
            </div>
          </div>
        ) : (
          <button onClick={getQR} disabled={qrLoading} className="w-full border-2 border-dashed border-gray-200 rounded-xl py-8 flex flex-col items-center gap-2 hover:border-green-400 hover:bg-green-50 transition-colors disabled:opacity-50">
            {qrLoading ? <Loader2 size={24} className="animate-spin text-green-500" /> : <QrCode size={32} className="text-gray-400" />}
            <span className="text-sm text-gray-500">{qrLoading ? 'Génération...' : 'Cliquer pour générer le QR Code'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function EnvoyerTab() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState('situation');
  const [customText, setCustomText] = useState('');
  const [sending, setSending] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const PAGE_SIZE = 10;

  useEffect(() => { checkConnection(); }, []);
  useEffect(() => { fetchOrders(); }, [page, statusFilter]);

  const checkConnection = async () => {
    const res = await fetch('/api/whatsapp/status');
    const json = await res.json();
    setConnected(json.connected);
  };

  const fetchOrders = useCallback(async () => {
    setLoadingOrders(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status: statusFilter });
    const res = await fetch(`/api/orders?${params}`);
    const json = await res.json();
    setOrders(json.data || []);
    setTotal(json.count || 0);
    setLoadingOrders(false);
  }, [page, statusFilter]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const template = TEMPLATES.find(t => t.id === templateId)!;
  const ordersWithPhone = orders.filter(o => o.whatsapp && o.whatsapp.length > 5);

  const toggleAll = () => {
    if (ordersWithPhone.every(o => selected.has(o.id))) { setSelected(new Set()); }
    else { setSelected(new Set(ordersWithPhone.map(o => o.id))); }
  };

  const sendMessages = async () => {
    if (selected.size === 0) { toast.error('Sélectionne au moins un client'); return; }
    const selectedOrders = orders.filter(o => selected.has(o.id));
    const recipients = selectedOrders.map(o => ({
      tracking: o.tracking, client: o.client, whatsapp: o.whatsapp,
      message: templateId === 'custom' ? customText : template.text(o),
    }));
    setSending(true);
    const res = await fetch('/api/whatsapp/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients }),
    });
    const json = await res.json();
    if (json.error) { toast.error(json.error); }
    else { toast.success(`✅ ${json.sent} envoyé(s)${json.failed > 0 ? ` — ❌ ${json.failed} échec(s)` : ''}`); setSelected(new Set()); }
    setSending(false);
  };

  if (connected === false) {
    return (
      <div className="max-w-xl">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 flex items-start gap-3">
          <AlertCircle size={20} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-800">WhatsApp non connecté</p>
            <p className="text-sm text-amber-600 mt-1">Va dans l'onglet <strong>Connexion</strong> pour scanner le QR Code avec ton téléphone.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-green-500" />
          <h3 className="font-semibold text-gray-900">Template de message</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TEMPLATES.map(t => (
            <button key={t.id} onClick={() => setTemplateId(t.id)}
              className={`text-xs px-3 py-2 rounded-xl border text-left font-medium transition-colors ${
                templateId === t.id ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        {templateId === 'custom' ? (
          <textarea value={customText} onChange={e => setCustomText(e.target.value)}
            placeholder="Écris ton message personnalisé..." rows={4}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        ) : (
          <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-600 whitespace-pre-line border border-gray-100">
            {orders.length > 0 ? template.text(orders[0]) : 'Sélectionne des commandes pour voir l'aperçu'}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-gray-500" />
            <h3 className="font-semibold text-gray-900">Destinataires</h3>
            {selected.size > 0 && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">{selected.size} sélectionné(s)</span>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none">
              <option value="all">Tous</option>
              <option value="en_preparation">En préparation</option>
              <option value="en_transit">En transit</option>
              <option value="en_livraison">En livraison</option>
              <option value="echec">Échecs</option>
              <option value="retourne">Retournés</option>
            </select>
            <button onClick={sendMessages} disabled={sending || selected.size === 0}
              className="flex items-center gap-1.5 text-sm px-4 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Envoyer ({selected.size})
            </button>
          </div>
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
                <th className="px-4 py-3 text-left">Téléphone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loadingOrders ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Chargement...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucune commande</td></tr>
              ) : orders.map(order => {
                const hasPhone = order.whatsapp && order.whatsapp.length > 5;
                return (
                  <tr key={order.id} className={`transition-colors ${hasPhone ? 'hover:bg-gray-50 cursor-pointer' : 'opacity-40'}`}
                    onClick={() => hasPhone && setSelected(s => { const n = new Set(s); n.has(order.id) ? n.delete(order.id) : n.add(order.id); return n; })}>
                    <td className="px-4 py-3"><input type="checkbox" checked={selected.has(order.id)} disabled={!hasPhone} readOnly className="rounded" /></td>
                    <td className="px-4 py-3 font-medium text-gray-900">{order.client || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{order.tracking}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{order.situation || order.status || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{order.wilaya || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{order.whatsapp || <span className="text-red-400 text-xs">Pas de numéro</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1} className="p-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50"><ChevronLeft size={14} /></button>
              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages} className="p-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50"><ChevronRight size={14} /></button>
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

  useEffect(() => { fetchMessages(); }, []);

  const fetchMessages = async () => {
    setLoading(true);
    const res = await fetch('/api/messages');
    const json = await res.json();
    setMessages(json.data || []);
    setLoading(false);
  };

  const statusConfig = {
    envoye: { label: 'Envoyé', bg: 'bg-green-100 text-green-700' },
    echec: { label: 'Échec', bg: 'bg-red-100 text-red-600' },
    en_attente: { label: 'En attente', bg: 'bg-amber-100 text-amber-700' },
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History size={16} className="text-gray-500" />
          <h3 className="font-semibold text-gray-900">Historique des messages</h3>
        </div>
        <button onClick={fetchMessages} className="p-1.5 hover:bg-gray-100 rounded-lg"><RefreshCw size={14} className="text-gray-400" /></button>
      </div>
      <div className="divide-y divide-gray-50">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 size={20} className="animate-spin" /></div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <MessageSquare size={32} className="mb-2 opacity-30" />
            <p className="text-sm">Aucun message envoyé</p>
          </div>
        ) : messages.map(msg => {
          const cfg = statusConfig[msg.status] || statusConfig.en_attente;
          return (
            <div key={msg.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-gray-900 text-sm">{msg.client}</span>
                    <span className="text-xs text-gray-400">{msg.whatsapp}</span>
                    {msg.tracking && <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">{msg.tracking}</span>}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg}`}>{cfg.label}</span>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2 whitespace-pre-line">{msg.message}</p>
                </div>
                <span className="text-[10px] text-gray-400 shrink-0">
                  {new Date(msg.sent_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TABS = [
  { id: 'connexion', label: 'Connexion', icon: QrCode },
  { id: 'envoyer', label: 'Envoyer', icon: Send },
  { id: 'historique', label: 'Historique', icon: History },
];

export default function MessagesPage() {
  const [tab, setTab] = useState('connexion');
  return (
    <AppLayout>
      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
            <MessageSquare size={20} className="text-green-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Messages WhatsApp</h1>
            <p className="text-sm text-gray-500">Connecte ton numéro et envoie des notifications à tes clients</p>
          </div>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>
        {tab === 'connexion' && <ConnexionTab />}
        {tab === 'envoyer' && <EnvoyerTab />}
        {tab === 'historique' && <HistoriqueTab />}
      </div>
    </AppLayout>
  );
}
