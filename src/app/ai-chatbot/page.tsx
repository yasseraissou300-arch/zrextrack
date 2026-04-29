'use client';
import React, { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import {
  Bot, CheckCircle2, HeadphonesIcon, MapPin, ToggleLeft, ToggleRight,
  Globe, Loader2, Save, RefreshCw, QrCode, Wifi, WifiOff,
  ChevronDown, ChevronUp, ExternalLink, Copy, Trash2, Sheet, AlertCircle,
  MessageSquare, Phone, User, BarChart3, TrendingUp, Users,
  Sparkles, Bell, Image, Shield, Clock,
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
  admin_whatsapp: string;
  media_url: string;
  blocked_prefixes: string[];
  human_pause_hours: number;
}

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
  const [refining, setRefining] = useState<string | null>(null);
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

  const updateConfig = (type: string, field: string, value: string | boolean | number | string[]) => {
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

  const refinePrompt = async (config: TemplateConfig) => {
    const prompt = config.custom_prompt?.trim() || defaults[config.template_type] || '';
    if (!prompt) { toast.error('Écrivez d\'abord un prompt à améliorer'); return; }
    setRefining(config.template_type);
    const res = await fetch('/api/ai-chatbot/refine-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, template_type: config.template_type, shop_name: config.shop_name }),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else {
      updateConfig(config.template_type, 'custom_prompt', json.refined);
      toast.success('Prompt amélioré par l\'IA ✨');
    }
    setRefining(null);
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
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => refinePrompt(config)}
                        disabled={refining === config.template_type}
                        className="text-[11px] flex items-center gap-1 text-purple-600 hover:text-purple-800 font-medium disabled:opacity-50"
                      >
                        {refining === config.template_type ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                        Améliorer avec IA
                      </button>
                      <button
                        onClick={() => updateConfig(config.template_type, 'custom_prompt', '')}
                        className="text-[11px] text-gray-400 hover:text-gray-600"
                      >
                        Réinitialiser
                      </button>
                    </div>
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

                {/* Admin notification */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                    <Bell size={12} className="text-amber-500" />
                    Notifier l'admin (numéro WhatsApp)
                  </label>
                  <input
                    value={(config as TemplateConfig).admin_whatsapp ?? ''}
                    onChange={e => updateConfig(config.template_type, 'admin_whatsapp', e.target.value)}
                    placeholder="Ex: 213661234567"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 font-mono"
                  />
                  <p className="text-[11px] text-gray-400">Reçoit un résumé WhatsApp dès qu'une commande est complète. Format : 213XXXXXXXXX</p>
                </div>

                {/* Product media */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                    <Image size={12} className="text-blue-500" />
                    Image produit (URL)
                  </label>
                  <input
                    value={(config as TemplateConfig).media_url ?? ''}
                    onChange={e => updateConfig(config.template_type, 'media_url', e.target.value)}
                    placeholder="https://..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 font-mono"
                  />
                  <p className="text-[11px] text-gray-400">Envoyée automatiquement au premier message du client</p>
                </div>

                {/* Blocked prefixes */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                    <Shield size={12} className="text-red-500" />
                    Numéros exclus (préfixes)
                  </label>
                  <input
                    value={((config as TemplateConfig).blocked_prefixes ?? []).join(', ')}
                    onChange={e => {
                      const prefixes = e.target.value.split(',').map(p => p.trim()).filter(Boolean);
                      updateConfig(config.template_type, 'blocked_prefixes', prefixes);
                    }}
                    placeholder="Ex: 213550, 213551 (séparés par virgule)"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 font-mono"
                  />
                  <p className="text-[11px] text-gray-400">Le bot ignorera les messages de ces numéros (utile pour exclure concurrents ou tests)</p>
                </div>

                {/* Human pause hours */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                    <Clock size={12} className="text-purple-500" />
                    Pause IA après intervention humaine (heures)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={48}
                    value={(config as TemplateConfig).human_pause_hours ?? 4}
                    onChange={e => updateConfig(config.template_type, 'human_pause_hours', parseInt(e.target.value) || 4)}
                    className="w-32 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-400"
                  />
                  <p className="text-[11px] text-gray-400">Quand vous répondez manuellement, le bot se met en pause pour X heures</p>
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

// ─── Per-service WhatsApp connection block ────────────────────────────────────
type WAServiceType = 'auto_confirmation' | 'sav' | 'tracking';

interface WAServiceStatus {
  connected: boolean;
  phone: string;
  instance: { instance_name: string; service_type: string } | null;
}

const WA_SERVICE_META: Record<WAServiceType, {
  label: string;
  desc: string;
  icon: React.ComponentType<{ size: number; className?: string }>;
  iconCls: string;
  badgeCls: string;
  borderCls: string;
  headerConnectedCls: string;
  statusConnectedCls: string;
  qrHoverCls: string;
  linkBtnCls: string;
}> = {
  auto_confirmation: {
    label: 'Auto-Confirmation',
    desc: 'Confirme les commandes et collecte les infos client',
    icon: CheckCircle2,
    iconCls: 'bg-green-100 text-green-600',
    badgeCls: 'bg-green-100 text-green-700',
    borderCls: 'border-green-200',
    headerConnectedCls: 'bg-green-50 border-green-200',
    statusConnectedCls: 'bg-green-100 text-green-700',
    qrHoverCls: 'hover:border-green-400 hover:bg-green-50 hover:text-green-700',
    linkBtnCls: 'border-green-200 hover:bg-green-50 hover:text-green-700',
  },
  sav: {
    label: 'SAV & Réclamations',
    desc: 'Enregistre et escalade les réclamations clients',
    icon: HeadphonesIcon,
    iconCls: 'bg-amber-100 text-amber-600',
    badgeCls: 'bg-amber-100 text-amber-700',
    borderCls: 'border-amber-200',
    headerConnectedCls: 'bg-amber-50 border-amber-200',
    statusConnectedCls: 'bg-amber-100 text-amber-700',
    qrHoverCls: 'hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700',
    linkBtnCls: 'border-amber-200 hover:bg-amber-50 hover:text-amber-700',
  },
  tracking: {
    label: 'Suivi de Commande',
    desc: 'Répond aux questions de suivi et de livraison',
    icon: MapPin,
    iconCls: 'bg-blue-100 text-blue-600',
    badgeCls: 'bg-blue-100 text-blue-700',
    borderCls: 'border-blue-200',
    headerConnectedCls: 'bg-blue-50 border-blue-200',
    statusConnectedCls: 'bg-blue-100 text-blue-700',
    qrHoverCls: 'hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700',
    linkBtnCls: 'border-blue-200 hover:bg-blue-50 hover:text-blue-700',
  },
};

function ServiceConnectionBlock({ serviceType }: { serviceType: WAServiceType }) {
  const [status, setStatus] = useState<WAServiceStatus>({ connected: false, phone: '', instance: null });
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrLoading, setQrLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const meta = WA_SERVICE_META[serviceType];
  const Icon = meta.icon;

  const fetchStatus = useCallback(async () => {
    const res = await fetch(`/api/ai-chatbot/whatsapp/status?service=${serviceType}`);
    const json = await res.json();
    setStatus({ connected: json.connected ?? false, phone: json.phone ?? '', instance: json.instance ?? null });
    return json.connected as boolean;
  }, [serviceType]);

  useEffect(() => {
    fetchStatus().then(() => setLoading(false));
  }, [fetchStatus]);

  // Poll for connection while QR is displayed
  useEffect(() => {
    if (!qr || status.connected) return;
    const timer = setInterval(async () => {
      const connected = await fetchStatus();
      if (connected) { setQr(null); clearInterval(timer); }
    }, 4000);
    return () => clearInterval(timer);
  }, [qr, status.connected, fetchStatus]);

  const createInstance = async () => {
    setCreating(true);
    const res = await fetch('/api/ai-chatbot/whatsapp/instance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', service_type: serviceType }),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else await fetchStatus();
    setCreating(false);
  };

  const fetchQr = async () => {
    setQrLoading(true);
    setQr(null);
    const res = await fetch(`/api/ai-chatbot/whatsapp/qr?service=${serviceType}`);
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else if (json.qr) setQr(json.qr);
    else if (json.connected) { toast.success('Déjà connecté !'); fetchStatus(); }
    setQrLoading(false);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex justify-center">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${status.connected ? meta.borderCls : 'border-gray-100'}`}>
      {/* Header */}
      <div className={`p-4 flex items-center gap-3 ${status.connected ? meta.headerConnectedCls : 'bg-gray-50 border-b border-gray-100'}`}>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${meta.iconCls}`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 text-sm">{meta.label}</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.badgeCls}`}>
              {serviceType === 'auto_confirmation' ? 'Commandes' : serviceType === 'sav' ? 'Support' : 'Livraison'}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{meta.desc}</p>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 ${
          status.connected ? meta.statusConnectedCls : 'bg-gray-100 text-gray-500'
        }`}>
          {status.connected ? <Wifi size={11} /> : <WifiOff size={11} />}
          {status.connected ? 'Connecté' : 'Déconnecté'}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {!status.instance ? (
          <button
            onClick={createInstance}
            disabled={creating}
            className={`w-full flex items-center justify-center gap-2 py-6 border-2 border-dashed rounded-xl transition-colors text-sm font-medium text-gray-400 ${meta.qrHoverCls} disabled:opacity-50`}
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
            {creating ? 'Initialisation...' : 'Lier le numéro'}
          </button>
        ) : status.connected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Phone size={13} className="text-gray-400" />
              <span className="font-mono">+{status.phone}</span>
            </div>
            <button onClick={() => fetchStatus()} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <RefreshCw size={12} className="text-gray-400" />
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {qr ? (
              <div className="flex flex-col items-center gap-2">
                <div className="bg-white p-2 border-2 border-gray-200 rounded-xl inline-block">
                  <img src={qr} alt={`QR Code ${meta.label}`} className="w-40 h-40" />
                </div>
                <p className="text-[11px] text-gray-400 text-center">
                  WhatsApp → Appareils liés → Lier un appareil
                </p>
              </div>
            ) : (
              <button
                onClick={fetchQr}
                disabled={qrLoading}
                className={`w-full flex items-center justify-center gap-2 py-8 border-2 border-dashed rounded-xl transition-colors text-gray-400 ${meta.qrHoverCls} disabled:opacity-50`}
              >
                {qrLoading ? <Loader2 size={18} className="animate-spin" /> : <QrCode size={18} />}
                <span className="text-sm font-medium">{qrLoading ? 'Génération du QR...' : 'Lier le numéro'}</span>
              </button>
            )}
          </div>
        )}
        {status.instance && (
          <p className="text-[10px] text-gray-300 font-mono truncate">
            {status.instance.instance_name}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── WhatsAppTab ──────────────────────────────────────────────────────────────
function WhatsAppTab() {
  const [evolutionConfigured, setEvolutionConfigured] = useState(true);

  useEffect(() => {
    fetch('/api/ai-chatbot/whatsapp/instance')
      .then(r => r.json())
      .then(json => setEvolutionConfigured(json.evolutionConfigured ?? false));
  }, []);

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${appUrl}/api/ai-chatbot/webhook/whatsapp`;

  return (
    <div className="space-y-4 max-w-2xl">
      {!evolutionConfigured && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
          <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 space-y-2">
            <p className="font-semibold">Evolution API non configurée</p>
            <p>Ajoutez ces variables dans Netlify / Vercel :</p>
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

      <div>
        <h2 className="text-sm font-semibold text-gray-700">Connexions WhatsApp par service</h2>
        <p className="text-xs text-gray-400 mt-0.5">Chaque service utilise un numéro WhatsApp indépendant et isolé.</p>
      </div>

      {(['auto_confirmation', 'sav', 'tracking'] as WAServiceType[]).map(serviceType => (
        <ServiceConnectionBlock key={serviceType} serviceType={serviceType} />
      ))}

      {/* Shared webhook URL info */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ExternalLink size={13} className="text-gray-400" />
          <h3 className="font-semibold text-gray-900 text-sm">URL Webhook Evolution API</h3>
        </div>
        <p className="text-xs text-gray-400">Les 3 instances pointent vers ce webhook — le routage par service est automatique.</p>
        <div className="flex gap-2">
          <code className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 break-all">
            {webhookUrl}
          </code>
          <button
            onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success('Copié !'); }}
            className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 shrink-0"
          >
            <Copy size={13} className="text-gray-500" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── FacebookTab ──────────────────────────────────────────────────────────────
interface PendingPage { id: string; name: string; access_token: string; picture: string; }
interface FBConn { page_id: string; page_name: string; page_picture: string; verify_token: string; connected: boolean; }

function FacebookTab() {
  const [connection, setConnection] = useState<FBConn | null>(null);
  const [pendingPages, setPendingPages] = useState<PendingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);

  const fetchStatus = async () => {
    const res = await fetch('/api/ai-chatbot/facebook');
    const json = await res.json();
    setConnection(json.connection ?? null);
    setPendingPages(json.pending_pages ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchStatus();
    // Handle redirect from OAuth
    const params = new URLSearchParams(window.location.search);
    const success = params.get('success');
    const error = params.get('error');
    if (success === 'connected') toast.success('Page Facebook connectée avec succès !');
    if (success === 'select_page') toast.info('Choisissez votre page Facebook ci-dessous');
    if (error === 'denied') toast.error('Connexion annulée');
    if (error === 'no_pages') toast.error('Aucune page Facebook trouvée sur ce compte');
    if (success || error) {
      const url = new URL(window.location.href);
      url.searchParams.delete('success'); url.searchParams.delete('error'); url.searchParams.delete('tab');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const disconnect = async () => {
    await fetch('/api/ai-chatbot/facebook', { method: 'DELETE' });
    setConnection(null); setPendingPages([]);
    toast.success('Déconnecté');
  };

  const selectPage = async (page: PendingPage) => {
    setSelecting(true);
    const res = await fetch('/api/ai-chatbot/facebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_id: page.id }),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else { toast.success(`Page "${page.name}" connectée !`); setConnection(json.connection); setPendingPages([]); }
    setSelecting(false);
  };

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${appUrl}/api/ai-chatbot/webhook/facebook`;

  if (loading) return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Status card */}
      <div className={`rounded-2xl border p-5 flex items-center gap-4 ${connection?.connected ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden shrink-0 ${connection?.connected ? 'bg-blue-100' : 'bg-gray-100'}`}>
          {connection?.page_picture
            ? <img src={connection.page_picture} alt="" className="w-full h-full object-cover" />
            : <svg viewBox="0 0 24 24" className={`w-5 h-5 ${connection?.connected ? 'fill-blue-600' : 'fill-gray-400'}`}><path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.259L19.752 8l-6.561 6.963z" /></svg>
          }
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-900">
            {connection?.connected ? connection.page_name || 'Page connectée' : 'Aucune page connectée'}
          </p>
          <p className="text-sm text-gray-500">
            {connection?.connected ? `Page ID : ${connection.page_id}` : 'Connectez votre page Messenger en un clic'}
          </p>
        </div>
        {connection?.connected && (
          <button onClick={disconnect} className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors" title="Déconnecter">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Page selection (after OAuth with multiple pages) */}
      {pendingPages.length > 0 && (
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-5 space-y-3">
          <p className="font-semibold text-gray-900 text-sm">Choisissez votre page Facebook</p>
          <div className="space-y-2">
            {pendingPages.map(page => (
              <button
                key={page.id}
                onClick={() => selectPage(page)}
                disabled={selecting}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left disabled:opacity-50"
              >
                {page.picture
                  ? <img src={page.picture} alt="" className="w-9 h-9 rounded-xl object-cover shrink-0" />
                  : <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center shrink-0"><svg viewBox="0 0 24 24" className="w-4 h-4 fill-blue-600"><path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.259L19.752 8l-6.561 6.963z" /></svg></div>
                }
                <div>
                  <p className="text-sm font-semibold text-gray-900">{page.name}</p>
                  <p className="text-xs text-gray-400">ID : {page.id}</p>
                </div>
                {selecting && <Loader2 size={14} className="animate-spin text-blue-500 ml-auto" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Connect button */}
      {!connection?.connected && pendingPages.length === 0 && (
        <a
          href="/api/ai-chatbot/facebook/oauth"
          className="flex items-center justify-center gap-3 w-full py-4 rounded-2xl bg-[#1877F2] text-white font-semibold text-sm hover:bg-[#166fe5] transition-colors shadow-sm active:scale-[0.98]"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.259L19.752 8l-6.561 6.963z" /></svg>
          Se connecter avec Facebook
        </a>
      )}

      {/* Webhook info (visible once connected) */}
      {connection?.connected && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
          <h3 className="font-semibold text-gray-900 text-sm">Webhook Meta (configuré automatiquement)</h3>
          {[
            { label: 'URL du Webhook', value: webhookUrl },
            { label: 'Token de vérification', value: connection.verify_token },
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
      )}
    </div>
  );
}

// ─── GoogleSheetsTab ─────────────────────────────────────────────────────────
const TEMPLATE_LABELS: Record<string, string> = {
  auto_confirmation: 'Auto-Confirmation',
  sav: 'SAV & Réclamations',
  tracking: 'Suivi de Commande',
};

function GoogleSheetsTab() {
  const [serviceEmail, setServiceEmail] = useState('');
  const [configs, setConfigs] = useState<{ template_type: string; google_sheets_url: string }[]>([]);
  const [sheetUrls, setSheetUrls] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, 'ok' | 'error'>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ai-chatbot/googlesheets').then(r => r.json()).then(json => {
      setServiceEmail(json.service_email || '');
      setConfigs(json.configs || []);
      const urls: Record<string, string> = {};
      for (const c of (json.configs || [])) {
        // Show the original Sheet URL if it's a sheets.googleapis.com URL (extract ID and rebuild)
        const idMatch = c.google_sheets_url?.match(/spreadsheets\/([a-zA-Z0-9_-]+)/);
        urls[c.template_type] = idMatch
          ? `https://docs.google.com/spreadsheets/d/${idMatch[1]}/edit`
          : (c.google_sheets_url || '');
      }
      setSheetUrls(urls);
      setLoading(false);
    });
  }, []);

  const testConnection = async (templateType: string) => {
    const url = sheetUrls[templateType] || '';
    if (!url) { toast.error('Collez l\'URL de votre Sheet d\'abord'); return; }
    setTesting(templateType);
    const res = await fetch('/api/ai-chatbot/googlesheets/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_url: url }),
    });
    const json = await res.json();
    if (json.ok) {
      setTestResults(prev => ({ ...prev, [templateType]: 'ok' }));
      toast.success('Connexion réussie ! Le bot peut écrire dans ce Sheet ✅');
    } else {
      setTestResults(prev => ({ ...prev, [templateType]: 'error' }));
      toast.error(json.error || 'Accès refusé');
    }
    setTesting(null);
  };

  const saveSheet = async (templateType: string) => {
    setSaving(templateType);
    const res = await fetch('/api/ai-chatbot/googlesheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_type: templateType, sheet_url: sheetUrls[templateType] || '' }),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else toast.success('Sheet sauvegardé !');
    setSaving(null);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-5 max-w-2xl">
      {/* How it works */}
      <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-3">
        <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />
        <div className="text-sm text-green-800 space-y-1">
          <p className="font-semibold">Connexion directe — sans Make ni Zapier</p>
          <p>Le bot écrit automatiquement les données clients dans votre Google Sheet dès qu'une conversation est complète.</p>
        </div>
      </div>

      {/* Step 1 — Share with service account */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-6 h-6 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center text-xs font-bold shrink-0">1</span>
          <h3 className="font-semibold text-gray-900 text-sm">Partagez votre Sheet avec notre bot</h3>
        </div>
        <p className="text-xs text-gray-500 ml-8">Ouvrez votre Google Sheet → Partager → Collez cet email → Éditeur → Envoyer</p>
        {serviceEmail ? (
          <div className="flex gap-2 ml-8">
            <code className="flex-1 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2.5 text-sm text-indigo-700 font-mono break-all">{serviceEmail}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(serviceEmail); toast.success('Email copié !'); }}
              className="p-2.5 bg-indigo-100 text-indigo-600 rounded-xl hover:bg-indigo-200 transition-colors shrink-0"
            >
              <Copy size={14} />
            </button>
          </div>
        ) : (
          <div className="ml-8 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs text-amber-700 font-medium">Service account non configuré</p>
            <p className="text-xs text-amber-600 mt-0.5">Ajoutez <code className="bg-amber-100 px-1 rounded">GOOGLE_SERVICE_ACCOUNT_EMAIL</code> et <code className="bg-amber-100 px-1 rounded">GOOGLE_PRIVATE_KEY</code> dans vos variables d'environnement.</p>
          </div>
        )}
      </div>

      {/* Step 2 — Paste Sheet URL per template */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-6 h-6 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center text-xs font-bold shrink-0">2</span>
          <h3 className="font-semibold text-gray-900 text-sm">Collez l'URL de votre Sheet par template</h3>
        </div>

        {['auto_confirmation', 'sav', 'tracking'].map(type => {
          const result = testResults[type];
          return (
            <div key={type} className="ml-8 space-y-2">
              <label className="text-xs font-semibold text-gray-600">{TEMPLATE_LABELS[type]}</label>
              <div className="flex gap-2">
                <input
                  value={sheetUrls[type] || ''}
                  onChange={e => setSheetUrls(prev => ({ ...prev, [type]: e.target.value }))}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className={`flex-1 border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 font-mono text-xs transition-colors ${
                    result === 'ok' ? 'border-green-400 bg-green-50 focus:ring-green-500/20' :
                    result === 'error' ? 'border-red-300 bg-red-50 focus:ring-red-500/20' :
                    'border-gray-200 focus:ring-indigo-500/20 focus:border-indigo-400'
                  }`}
                />
                <button
                  onClick={() => testConnection(type)}
                  disabled={testing === type || !sheetUrls[type]}
                  title="Tester la connexion"
                  className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors shrink-0 flex items-center gap-1.5"
                >
                  {testing === type ? <Loader2 size={12} className="animate-spin" /> :
                   result === 'ok' ? <CheckCircle2 size={12} className="text-green-600" /> :
                   <RefreshCw size={12} />}
                  Tester
                </button>
                <button
                  onClick={() => saveSheet(type)}
                  disabled={saving === type || !sheetUrls[type]}
                  className="px-3 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors shrink-0 flex items-center gap-1.5"
                >
                  {saving === type ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Sauver
                </button>
              </div>
              {result === 'ok' && <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={10} />Connexion OK — le bot peut écrire dans ce Sheet</p>}
              {result === 'error' && <p className="text-xs text-red-500">Accès refusé — vérifiez que vous avez partagé avec l'email ci-dessus</p>}
            </div>
          );
        })}
      </div>

      {/* Columns written */}
      <div className="bg-gray-50 rounded-2xl p-4 space-y-2">
        <p className="text-xs font-semibold text-gray-600">Colonnes écrites automatiquement :</p>
        <div className="flex flex-wrap gap-2">
          {['Date', 'Client', 'Téléphone', 'Wilaya', 'Produit', 'Statut', 'Canal'].map(col => (
            <span key={col} className="text-[11px] bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded-lg font-mono">{col}</span>
          ))}
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

// ─── AnalyticsTab ─────────────────────────────────────────────────────────────
interface AnalyticsData {
  total: number; complete: number; sheets_sent: number; human_handover: number;
  conversion_rate: number;
  by_template: Record<string, { total: number; complete: number }>;
  by_channel: Record<string, number>;
  top_wilayas: { wilaya: string; count: number }[];
  by_day: { date: string; count: number }[];
}

function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [relancing, setRelancing] = useState(false);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/ai-chatbot/analytics');
    const json = await res.json();
    if (!json.error) setData(json);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const triggerRelance = async () => {
    setRelancing(true);
    const res = await fetch('/api/ai-chatbot/relance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else toast.success(`Relance envoyée à ${json.relanced} session(s) inactive(s)`);
    setRelancing(false);
  };

  const TEMPLATE_LABELS: Record<string, string> = {
    auto_confirmation: 'Auto-Confirmation',
    sav: 'SAV & Réclamations',
    tracking: 'Suivi de Commande',
  };

  const maxDay = data ? Math.max(...data.by_day.map(d => d.count), 1) : 1;

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total conversations', value: data?.total ?? 0, icon: MessageSquare, color: 'text-indigo-600 bg-indigo-50' },
          { label: 'Données complètes', value: data?.complete ?? 0, icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
          { label: 'Taux de conversion', value: `${data?.conversion_rate ?? 0}%`, icon: TrendingUp, color: 'text-blue-600 bg-blue-50' },
          { label: 'Transfert humain', value: data?.human_handover ?? 0, icon: Users, color: 'text-amber-600 bg-amber-50' },
        ].map(kpi => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-start gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${kpi.color}`}>
                <Icon size={16} />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-900">{loading ? '—' : kpi.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{kpi.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Conversations par jour (14 jours) */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <BarChart3 size={15} className="text-indigo-500" />
              Conversations (14 jours)
            </h3>
            <button onClick={fetchAnalytics} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <RefreshCw size={12} className={`text-gray-400 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {loading ? <div className="h-28 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-gray-300" /></div> : (
            <div className="flex items-end gap-1 h-28">
              {(data?.by_day ?? []).map(d => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-indigo-500 rounded-t-sm min-h-[2px] transition-all"
                    style={{ height: `${Math.round((d.count / maxDay) * 96)}px` }}
                    title={`${d.date}: ${d.count}`}
                  />
                  <span className="text-[8px] text-gray-300 rotate-0">{d.date.slice(8)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Par template */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Bot size={15} className="text-purple-500" />
            Par template
          </h3>
          {loading ? <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-gray-300" /></div> : (
            <div className="space-y-3">
              {Object.entries(data?.by_template ?? {}).map(([type, stats]) => {
                const rate = stats.total > 0 ? Math.round((stats.complete / stats.total) * 100) : 0;
                return (
                  <div key={type} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 font-medium">{TEMPLATE_LABELS[type] ?? type}</span>
                      <span className="text-xs text-gray-500">{stats.complete}/{stats.total} · {rate}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-500 rounded-full" style={{ width: `${rate}%` }} />
                    </div>
                  </div>
                );
              })}
              {Object.keys(data?.by_template ?? {}).length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Aucune session pour l'instant</p>
              )}
            </div>
          )}
        </div>

        {/* Top wilayas */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <MapPin size={15} className="text-green-500" />
            Top Wilayas
          </h3>
          {loading ? <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-gray-300" /></div> : (
            <div className="space-y-2.5">
              {(data?.top_wilayas ?? []).map((w, i) => (
                <div key={w.wilaya} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm text-gray-700">{w.wilaya}</span>
                      <span className="text-xs font-bold text-gray-900">{w.count}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-green-400 rounded-full" style={{ width: `${Math.round((w.count / (data?.top_wilayas[0]?.count || 1)) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
              {(data?.top_wilayas ?? []).length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Aucune donnée wilaya</p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <RefreshCw size={15} className="text-orange-500" />
            Automatisations
          </h3>
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-2">
            <p className="text-sm font-semibold text-orange-800">Relance inactivité (2h)</p>
            <p className="text-xs text-orange-600">Envoie un message de rappel aux sessions incomplètes inactives depuis plus de 2 heures.</p>
            <button
              onClick={triggerRelance}
              disabled={relancing}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {relancing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Lancer la relance maintenant
            </button>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 space-y-1">
            <p className="text-xs font-semibold text-gray-600">Automatiser via Vercel Cron</p>
            <code className="text-[10px] text-gray-500 block font-mono bg-gray-100 rounded px-2 py-1">
              POST /api/ai-chatbot/relance (every 30min)
            </code>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            {[
              { label: 'Google Sheets envoyés', value: data?.sheets_sent ?? 0, color: 'text-green-700 bg-green-50' },
              { label: 'Transferts humains', value: data?.human_handover ?? 0, color: 'text-amber-700 bg-amber-50' },
            ].map(s => (
              <div key={s.label} className={`rounded-xl p-3 text-center ${s.color}`}>
                <p className="text-xl font-bold">{loading ? '—' : s.value}</p>
                <p className="text-[10px] mt-0.5 opacity-80">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type Tab = 'templates' | 'whatsapp' | 'facebook' | 'googlesheets' | 'donnees' | 'analytics';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'templates', label: 'Templates IA', icon: <Bot size={14} /> },
  { id: 'whatsapp', label: 'WhatsApp', icon: <Phone size={14} /> },
  { id: 'facebook', label: 'Facebook', icon: <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.259L19.752 8l-6.561 6.963z" /></svg> },
  { id: 'googlesheets', label: 'Google Sheets', icon: <Sheet size={14} /> },
  { id: 'donnees', label: 'Données extraites', icon: <MessageSquare size={14} /> },
  { id: 'analytics', label: 'Analytiques', icon: <BarChart3 size={14} /> },
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
              <h1 className="text-lg font-bold text-gray-900">AI Chatbot</h1>
              <p className="text-xs text-gray-500">Gestion des bots WhatsApp et configurations</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
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

        {/* Tab Content */}
        {activeTab === 'templates' && <TemplatesTab />}
        {activeTab === 'whatsapp' && <WhatsAppTab />}
        {activeTab === 'facebook' && <FacebookTab />}
        {activeTab === 'googlesheets' && <GoogleSheetsTab />}
        {activeTab === 'donnees' && <DonneesTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
      </div>
    </AppLayout>
  );
}
