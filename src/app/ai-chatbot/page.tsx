'use client';
import React, { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import {
  Bot, CheckCircle2, HeadphonesIcon, MapPin, ToggleLeft, ToggleRight,
  Globe, Loader2, Save, RefreshCw, QrCode, Wifi, WifiOff,
  ChevronDown, ChevronUp, ExternalLink, Copy, Trash2, Sheet, AlertCircle,
  MessageSquare, Phone, User, Package,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────
interface TemplateConfig {
  template_type: 'auto_confirmation' | 'sav' | 'tracking';
  is_active: boolean;
  shop_name: string;
  custom_prompt: string;
  language: string;
  google_sheets_url: string;
}

interface WAStatus { connected: boolean; phone: string; instance: { instance_name: string } | null; }
interface FBConnection { page_id: string; page_name: string; page_access_token: string; verify_token: string; connected: boolean; }
interface Session {
  id: string; channel: string; contact_id: string; contact_name: string;
  template_type: string; extracted_data: Record<string, string>;
  is_complete: boolean; sheets_sent: boolean; updated_at: string;
}

// ─── Template metadata ────────────────────────────────────────────────────────
const TEMPLATE_META = {
  auto_confirmation: {
    icon: CheckCircle2,
    label: 'Auto-Confirmation',
    desc: 'Collecte automatiquement les infos de commande (Nom, Téléphone, Wilaya, Produit) et confirme la commande.',
    color: 'green',
    badge: 'Commandes',
  },
  sav: {
    icon: HeadphonesIcon,
    label: 'SAV & Réclamations',
    desc: 'Enregistre les réclamations clients avec tous les détails et notifie le support.',
    color: 'amber',
    badge: 'Support',
  },
  tracking: {
    icon: MapPin,
    label: 'Suivi de Commande',
    desc: 'Répond aux questions de suivi et extrait le numéro de tracking demandé.',
    color: 'blue',
    badge: 'Livraison',
  },
} as const;

const COLOR_MAP = {
  green: { bg: 'bg-green-50', icon: 'bg-green-100 text-green-600', badge: 'bg-green-100 text-green-700', border: 'border-green-200', ring: 'ring-green-500' },
  amber: { bg: 'bg-amber-50', icon: 'bg-amber-100 text-amber-600', badge: 'bg-amber-100 text-amber-700', border: 'border-amber-200', ring: 'ring-amber-500' },
  blue: { bg: 'bg-blue-50', icon: 'bg-blue-100 text-blue-600', badge: 'bg-blue-100 text-blue-700', border: 'border-blue-200', ring: 'ring-blue-500' },
};

// ─── TemplatesTab ─────────────────────────────────────────────────────────────
function TemplatesTab() {
  const [configs, setConfigs] = useState<TemplateConfig[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/ai-chatbot/config');
    const json = await res.json();
    setConfigs(json.templates || []);
    setDefaults(json.defaults || {});
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const updateConfig = (type: string, field: string, value: string | boolean) => {
    setConfigs(prev => prev.map(c => c.template_type === type ? { ...c, [field]: value } : c));
  };

  const saveConfig = async (config: TemplateConfig) => {
    setSaving(config.template_type);
    const res = await fetch('/api/ai-chatbot/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else toast.success(`Template "${TEMPLATE_META[config.template_type].label}" sauvegardé !`);
    setSaving(null);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex gap-3">
        <AlertCircle size={16} className="text-blue-600 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800 space-y-1">
          <p className="font-semibold">Comment ça marche ?</p>
          <p>L'IA répond en <strong>Darija Algérienne</strong> (arabe + arabizi latin). Elle extrait automatiquement les données structurées et les envoie vers votre Google Sheets dès la conversation complète.</p>
        </div>
      </div>

      {configs.map(config => {
        const meta = TEMPLATE_META[config.template_type];
        const colors = COLOR_MAP[meta.color];
        const Icon = meta.icon;
        const isExpanded = expanded === config.template_type;
        const isSaving = saving === config.template_type;

        return (
          <div key={config.template_type} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${config.is_active ? `border-${meta.color}-200` : 'border-gray-100'}`}>
            {/* Card header */}
            <div className="p-5 flex items-start gap-4">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${colors.icon}`}>
                <Icon size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="font-semibold text-gray-900">{meta.label}</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${colors.badge}`}>{meta.badge}</span>
                  {config.is_active && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1">
                      <span className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />ACTIF
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{meta.desc}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => updateConfig(config.template_type, 'is_active', !config.is_active)}
                  className="shrink-0"
                >
                  {config.is_active
                    ? <ToggleRight size={36} className="text-green-600" />
                    : <ToggleLeft size={36} className="text-gray-300" />
                  }
                </button>
                <button
                  onClick={() => setExpanded(isExpanded ? null : config.template_type)}
                  className="p-2 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </button>
              </div>
            </div>

            {/* Config expand */}
            {isExpanded && (
              <div className="border-t border-gray-100 p-5 space-y-4 bg-gray-50/50">
                {/* Shop name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600">Nom de la boutique</label>
                  <input
                    value={config.shop_name}
                    onChange={e => updateConfig(config.template_type, 'shop_name', e.target.value)}
                    placeholder="Ex: Boutique Yassin"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400"
                  />
                  <p className="text-[11px] text-gray-400">Remplace [NOM_BOUTIQUE] dans le prompt</p>
                </div>

                {/* Language */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600">Langue principale</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { v: 'darija', l: 'Darija 🇩🇿', s: 'Dialecte algérien' },
                      { v: 'arabic', l: 'عربية فصحى', s: 'Arabe classique' },
                      { v: 'french', l: 'Français 🇫🇷', s: 'Français standard' },
                    ].map(lang => (
                      <button
                        key={lang.v}
                        onClick={() => updateConfig(config.template_type, 'language', lang.v)}
                        className={`p-2.5 rounded-xl border text-left text-xs transition-colors ${config.language === lang.v ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <p className="font-medium text-gray-900">{lang.l}</p>
                        <p className="text-gray-400 text-[10px]">{lang.s}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom prompt */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-gray-600">Prompt personnalisé</label>
                    <button
                      onClick={() => updateConfig(config.template_type, 'custom_prompt', '')}
                      className="text-[11px] text-gray-400 hover:text-gray-600"
                    >
                      Réinitialiser
                    </button>
                  </div>
                  <textarea
                    value={config.custom_prompt}
                    onChange={e => updateConfig(config.template_type, 'custom_prompt', e.target.value)}
                    placeholder={defaults[config.template_type] || 'Laissez vide pour utiliser le prompt Darija par défaut...'}
                    rows={7}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 resize-none font-mono text-gray-700"
                  />
                  <p className="text-[11px] text-gray-400">
                    Utilisez <code className="bg-gray-100 px-1 rounded">[NOM_BOUTIQUE]</code> pour insérer le nom de boutique.
                    L'IA extrait les données avec la balise <code className="bg-gray-100 px-1 rounded">&lt;data&gt;{'{...}'}&lt;/data&gt;</code>
                  </p>
                </div>

                {/* Google Sheets URL */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                    <Sheet size={12} className="text-green-600" />
                    Webhook Google Sheets (Make.com / n8n / Zapier)
                  </label>
                  <input
                    value={config.google_sheets_url}
                    onChange={e => updateConfig(config.template_type, 'google_sheets_url', e.target.value)}
                    placeholder="https://hook.eu1.make.com/xxx ou https://n8n.yourdomain.com/webhook/..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 font-mono"
                  />
                  <p className="text-[11px] text-gray-400">Recevra un POST JSON avec : type, timestamp, nom, telephone, wilaya, produit</p>
                </div>

                <button
                  onClick={() => saveConfig(config)}
                  disabled={isSaving}
                  className="w-full bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Sauvegarder
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── WhatsAppTab ──────────────────────────────────────────────────────────────
function WhatsAppTab() {
  const [status, setStatus] = useState<WAStatus>({ connected: false, phone: '', instance: null });
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrLoading, setQrLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [evolutionConfigured, setEvolutionConfigured] = useState(false);
  const [pollCount, setPollCount] = useState(0);

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/ai-chatbot/whatsapp/status');
    const json = await res.json();
    setStatus({ connected: json.connected ?? false, phone: json.phone ?? '', instance: json.instance ?? null });
    setEvolutionConfigured(true);
    return json.connected;
  }, []);

  const fetchInstance = useCallback(async () => {
    const res = await fetch('/api/ai-chatbot/whatsapp/instance');
    const json = await res.json();
    setEvolutionConfigured(json.evolutionConfigured ?? false);
    setLoading(false);
    return json;
  }, []);

  useEffect(() => {
    fetchInstance().then(() => fetchStatus());
  }, [fetchInstance, fetchStatus]);

  // Poll for connection while QR is displayed
  useEffect(() => {
    if (!qr || status.connected) return;
    const timer = setInterval(async () => {
      const connected = await fetchStatus();
      setPollCount(p => p + 1);
      if (connected) { setQr(null); clearInterval(timer); }
    }, 4000);
    return () => clearInterval(timer);
  }, [qr, status.connected, fetchStatus]);

  const createInstance = async () => {
    setCreating(true);
    const res = await fetch('/api/ai-chatbot/whatsapp/instance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create' }),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else { toast.success('Instance créée !'); await fetchStatus(); }
    setCreating(false);
  };

  const fetchQr = async () => {
    setQrLoading(true);
    setQr(null);
    const res = await fetch('/api/ai-chatbot/whatsapp/qr');
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else if (json.qr) setQr(json.qr);
    else if (json.connected) { toast.success('Déjà connecté !'); fetchStatus(); }
    setQrLoading(false);
  };

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${appUrl}/api/ai-chatbot/webhook/whatsapp`;

  if (loading) return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Connection status */}
      <div className={`rounded-2xl border p-5 flex items-center gap-4 ${status.connected ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${status.connected ? 'bg-green-100' : 'bg-gray-100'}`}>
          {status.connected ? <Wifi size={22} className="text-green-600" /> : <WifiOff size={22} className="text-gray-400" />}
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-900">{status.connected ? 'WhatsApp connecté' : 'WhatsApp non connecté'}</p>
          <p className="text-sm text-gray-500">{status.connected ? `Numéro : +${status.phone}` : 'Scannez le QR code avec votre WhatsApp Business'}</p>
        </div>
        <button onClick={fetchStatus} className="p-2 hover:bg-white rounded-lg transition-colors">
          <RefreshCw size={14} className={`text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Evolution API config warning */}
      {!evolutionConfigured && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
          <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 space-y-2">
            <p className="font-semibold">Evolution API non configurée</p>
            <p>Ajoutez ces variables dans Netlify :</p>
            <div className="space-y-1 font-mono text-xs bg-amber-100 rounded-lg p-3">
              <p>EVOLUTION_API_URL=https://evolution.votredomaine.com</p>
              <p>EVOLUTION_API_KEY=votre-clé-api</p>
              <p>ANTHROPIC_API_KEY=sk-ant-...</p>
            </div>
            <a href="https://github.com/EvolutionAPI/evolution-api" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-amber-700 hover:underline font-medium">
              Documentation Evolution API <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}

      {/* Instance actions */}
      {!status.instance ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center space-y-3">
          <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center mx-auto">
            <QrCode size={24} className="text-green-600" />
          </div>
          <p className="font-semibold text-gray-900">Initialiser l'instance WhatsApp</p>
          <p className="text-sm text-gray-500">Crée votre instance dédiée dans Evolution API. Chaque client a sa propre instance isolée.</p>
          <button
            onClick={createInstance}
            disabled={creating}
            className="mx-auto flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
            Créer l'instance
          </button>
        </div>
      ) : (
        <>
          {/* QR Code section */}
          {!status.connected && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
              <div className="flex items-center gap-2">
                <QrCode size={16} className="text-gray-500" />
                <h3 className="font-semibold text-gray-900">Scanner le QR Code</h3>
              </div>
              {qr ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="bg-white p-3 border-2 border-gray-200 rounded-xl inline-block">
                    <img src={qr} alt="QR Code WhatsApp" className="w-48 h-48" />
                  </div>
                  <p className="text-xs text-gray-500 text-center">
                    Ouvrez WhatsApp → Appareils liés → Lier un appareil
                    <br />
                    <span className="text-gray-400">{qr ? `Actualisation dans ${Math.max(0, 30 - (pollCount * 4))}s...` : ''}</span>
                  </p>
                </div>
              ) : (
                <button
                  onClick={fetchQr}
                  disabled={qrLoading}
                  className="w-full flex items-center justify-center gap-2 py-10 border-2 border-dashed border-gray-200 rounded-xl hover:border-green-400 hover:bg-green-50 transition-colors text-gray-500 hover:text-green-700"
                >
                  {qrLoading ? <Loader2 size={20} className="animate-spin" /> : <QrCode size={20} />}
                  <span className="font-medium">{qrLoading ? 'Génération...' : 'Afficher le QR Code'}</span>
                </button>
              )}
            </div>
          )}

          {/* Webhook URL */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ExternalLink size={14} className="text-gray-500" />
              <h3 className="font-semibold text-gray-900 text-sm">URL Webhook (Evolution API)</h3>
            </div>
            <p className="text-xs text-gray-500">Configurée automatiquement lors de la création de l'instance.</p>
            <div className="flex gap-2">
              <code className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 break-all">
                {webhookUrl}
              </code>
              <button
                onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success('Copié !'); }}
                className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                <Copy size={13} className="text-gray-500" />
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Instance : <code className="bg-gray-100 px-1 rounded">{status.instance.instance_name}</code>
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── FacebookTab ──────────────────────────────────────────────────────────────
function FacebookTab() {
  const [connection, setConnection] = useState<FBConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ page_id: '', page_name: '', page_access_token: '' });

  useEffect(() => {
    fetch('/api/ai-chatbot/facebook').then(r => r.json()).then(j => {
      if (j.connection) {
        setConnection(j.connection);
        setForm({ page_id: j.connection.page_id, page_name: j.connection.page_name, page_access_token: j.connection.page_access_token });
      }
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/ai-chatbot/facebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else { toast.success('Page Facebook connectée !'); setConnection(json.data); }
    setSaving(false);
  };

  const disconnect = async () => {
    await fetch('/api/ai-chatbot/facebook', { method: 'DELETE' });
    setConnection(null);
    setForm({ page_id: '', page_name: '', page_access_token: '' });
    toast.success('Déconnecté');
  };

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${appUrl}/api/ai-chatbot/webhook/facebook`;
  const verifyToken = connection?.verify_token || `zrex_fb_${(typeof window !== 'undefined' ? 'preview' : '')}`;

  if (loading) return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Status */}
      <div className={`rounded-2xl border p-5 flex items-center gap-4 ${connection?.connected ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${connection?.connected ? 'bg-blue-100' : 'bg-gray-100'}`}>
          <svg viewBox="0 0 24 24" className={`w-5 h-5 ${connection?.connected ? 'fill-blue-600' : 'fill-gray-400'}`}>
            <path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.259L19.752 8l-6.561 6.963z" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-900">{connection?.connected ? `${connection.page_name || 'Page connectée'}` : 'Aucune page Facebook connectée'}</p>
          <p className="text-sm text-gray-500">{connection?.connected ? `Page ID : ${connection.page_id}` : 'Connectez votre page Messenger pour centraliser les messages'}</p>
        </div>
        {connection?.connected && (
          <button onClick={disconnect} className="p-2 text-red-400 hover:bg-red-50 rounded-lg">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Config form */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-blue-600"><path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.259L19.752 8l-6.561 6.963z" /></svg>
          Configuration Facebook Messenger
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600">Page ID *</label>
            <input value={form.page_id} onChange={e => setForm(f => ({ ...f, page_id: e.target.value }))} placeholder="123456789012345" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600">Nom de la page</label>
            <input value={form.page_name} onChange={e => setForm(f => ({ ...f, page_name: e.target.value }))} placeholder="Ma Boutique" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600">Page Access Token *</label>
          <input value={form.page_access_token} onChange={e => setForm(f => ({ ...f, page_access_token: e.target.value }))} placeholder="EAAxxxxxx..." type="password" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 font-mono" />
        </div>

        <button onClick={save} disabled={saving || !form.page_id || !form.page_access_token} className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {connection?.connected ? 'Mettre à jour' : 'Connecter la page'}
        </button>
      </div>

      {/* Webhook info */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <h3 className="font-semibold text-gray-900 text-sm">Paramètres du Webhook Meta</h3>
        <div className="space-y-3">
          {[
            { label: 'URL du Webhook', value: webhookUrl },
            { label: 'Token de vérification', value: verifyToken },
          ].map(item => (
            <div key={item.label} className="space-y-1">
              <p className="text-xs text-gray-500">{item.label}</p>
              <div className="flex gap-2">
                <code className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 break-all">{item.value}</code>
                <button onClick={() => { navigator.clipboard.writeText(item.value); toast.success('Copié !'); }} className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50">
                  <Copy size={12} className="text-gray-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-blue-50 rounded-xl p-3 space-y-1.5">
          <p className="text-xs font-semibold text-blue-800">Abonnements requis :</p>
          <code className="text-xs text-blue-700">messages, messaging_postbacks, messaging_optins</code>
        </div>
      </div>
    </div>
  );
}

// ─── DonneesTab ───────────────────────────────────────────────────────────────
function DonneesTab() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [completeOnly, setCompleteOnly] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (filter) params.set('template', filter);
    if (completeOnly) params.set('complete', 'true');
    const res = await fetch(`/api/ai-chatbot/sessions?${params}`);
    const json = await res.json();
    setSessions(json.data || []);
    setLoading(false);
  }, [filter, completeOnly]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const deleteSession = async (id: string) => {
    await fetch('/api/ai-chatbot/sessions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setSessions(prev => prev.filter(s => s.id !== id));
    toast.success('Session supprimée');
  };

  const CHANNEL_ICONS: Record<string, React.ReactNode> = {
    whatsapp: <Phone size={11} className="text-green-600" />,
    facebook: <svg viewBox="0 0 24 24" className="w-3 h-3 fill-blue-600"><path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.259L19.752 8l-6.561 6.963z" /></svg>,
    web: <Globe size={11} className="text-purple-600" />,
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={filter} onChange={e => setFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 bg-white">
          <option value="">Tous les templates</option>
          <option value="auto_confirmation">Auto-Confirmation</option>
          <option value="sav">SAV & Réclamations</option>
          <option value="tracking">Suivi de Commande</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={completeOnly} onChange={e => setCompleteOnly(e.target.checked)} className="rounded" />
          Données complètes uniquement
        </label>
        <button onClick={fetchSessions} className="ml-auto p-2 hover:bg-gray-100 rounded-lg">
          <RefreshCw size={14} className={`text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total sessions', value: sessions.length, color: 'bg-gray-50 text-gray-700' },
          { label: 'Données complètes', value: sessions.filter(s => s.is_complete).length, color: 'bg-green-50 text-green-700' },
          { label: 'Envoyés Sheets', value: sessions.filter(s => s.sheets_sent).length, color: 'bg-blue-50 text-blue-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 text-center ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs mt-0.5 opacity-80">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <MessageSquare size={32} className="mb-2 opacity-30" />
            <p className="text-sm">Aucune session IA pour l'instant</p>
            <p className="text-xs mt-1">Les données apparaîtront dès qu'un client écrira à votre bot</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Canal', 'Contact', 'Template', 'Données extraites', 'Statut', 'Date', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sessions.map(session => {
                  const d = session.extracted_data;
                  return (
                    <tr key={session.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5">
                          {CHANNEL_ICONS[session.channel] ?? null}
                          <span className="text-xs capitalize text-gray-600">{session.channel}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 text-xs">{session.contact_name || '—'}</p>
                        <p className="text-[10px] text-gray-400 font-mono">{session.contact_id.replace('@s.whatsapp.net', '').slice(-12)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {TEMPLATE_META[session.template_type as keyof typeof TEMPLATE_META]?.label ?? session.template_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {Object.keys(d).length > 0 ? (
                          <div className="space-y-0.5">
                            {d.nom && <p className="text-xs text-gray-700 flex items-center gap-1"><User size={10} className="text-gray-400" />{d.nom}</p>}
                            {d.telephone && <p className="text-xs text-gray-700 flex items-center gap-1"><Phone size={10} className="text-gray-400" />{d.telephone}</p>}
                            {d.wilaya && <p className="text-xs text-gray-700 flex items-center gap-1"><MapPin size={10} className="text-gray-400" />{d.wilaya}</p>}
                            {d.produit && <p className="text-xs text-gray-500 truncate max-w-[140px]">{d.produit}</p>}
                          </div>
                        ) : <span className="text-xs text-gray-300">En cours...</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full w-fit ${session.is_complete ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {session.is_complete ? '✓ Complet' : '… En cours'}
                          </span>
                          {session.sheets_sent && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full w-fit bg-blue-100 text-blue-700">Sheets ✓</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[10px] text-gray-400">
                        {new Date(session.updated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => deleteSession(session.id)} className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg">
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type Tab = 'templates' | 'whatsapp' | 'facebook' | 'donnees';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'templates', label: 'Templates IA', icon: <Bot size={14} /> },
  { id: 'whatsapp', label: 'WhatsApp', icon: <Phone size={14} /> },
  { id: 'facebook', label: 'Facebook', icon: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.259L19.752 8l-6.561 6.963z" /></svg> },
  { id: 'donnees', label: 'Données extraites', icon: <Sheet size={14} /> },
];

export default function AIChatbotPage() {
  const [activeTab, setActiveTab] = useState<Tab>('templates');

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
              <Bot size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">AI Chatbot</h1>
              <p className="text-sm text-gray-500">Agent IA autonome · Darija Algérienne · Multi-canal</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'templates' && <TemplatesTab />}
        {activeTab === 'whatsapp' && <WhatsAppTab />}
        {activeTab === 'facebook' && <FacebookTab />}
        {activeTab === 'donnees' && <DonneesTab />}
      </div>
    </AppLayout>
  );
}
