'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import {
  MessageSquare,
  Wifi,
  WifiOff,
  QrCode,
  Send,
  History,
  CheckCircle,
  RefreshCw,
  AlertCircle,
  Loader2,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Bell,
  Flame,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { loadSyncSettings, saveSyncSettings } from '@/lib/sync-settings-client';
import { selectResendable } from '@/lib/whatsapp/resend-selection';

interface WASettings {
  instance_id: string;
  api_token: string;
  connected: boolean;
  phone: string;
}
interface Order {
  id: string;
  tracking_number: string;
  customer_name: string;
  customer_whatsapp: string;
  situation: string;
  wilaya: string;
  delivery_status: string;
  cod: number;
  product_name: string;
}
// Réponse de /api/whatsapp/send (champs optionnels selon le cas).
interface SendResponse {
  error?: string;
  code?: string;
  hint?: string;
  sent?: number;
  failed?: number;
  sentToday?: number;
  dailyLimit?: number;
  skippedForQuota?: number;
  sessionDead?: boolean;
  circuitBroken?: boolean;
  deferred?: Array<{ tracking: string; client: string }>;
  /** Écartés : même numéro + même colis déjà envoyé (< 10 min) ou en double. */
  duplicates?: Array<{ tracking: string; client: string }>;
  results?: Array<{ error?: string }>;
}

// Une réponse non JSON (504 de la plateforme, coupure réseau) ne doit ni
// bloquer le bouton ni inviter à renvoyer à l'aveugle : certains messages
// sont peut-être partis.
async function postSend(
  recipients: Array<{ tracking: string; client: string; whatsapp: string; message: string }>
): Promise<SendResponse> {
  try {
    const res = await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients }),
    });
    return (await res.json().catch(() => ({
      error: `Réponse inattendue (HTTP ${res.status}) — vérifie l'historique avant de renvoyer.`,
    }))) as SendResponse;
  } catch {
    return { error: "Connexion interrompue — vérifie l'historique avant de renvoyer." };
  }
}

interface MsgLog {
  id: string;
  tracking_number: string;
  customer_name: string;
  customer_whatsapp: string;
  message: string;
  status: 'envoye' | 'echec' | 'en_attente';
  sent_at: string;
  error_message?: string | null;
}

const MOCK_ORDER: Order = {
  id: 'preview',
  tracking_number: 'ZR-000000',
  customer_name: 'محمد',
  customer_whatsapp: '',
  situation: '',
  wilaya: 'الجزائر',
  delivery_status: '',
  cod: 2500,
  product_name: 'منتج',
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
  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/track/${o.tracking_number}`
      : `/track/${o.tracking_number}`;
  return (content || '')
    .replace(/\{\{client\}\}/g, o.customer_name || 'cher client')
    .replace(/\{\{tracking\}\}/g, o.tracking_number || '')
    .replace(/\{\{wilaya\}\}/g, o.wilaya || '')
    .replace(/\{\{produit\}\}/g, o.product_name || '')
    .replace(/\{\{cod\}\}/g, String(o.cod ?? ''))
    .replace(/\{\{lien\}\}/g, link);
}

// Quand on filtre par situation, on pré-sélectionne le template correspondant.
const SITUATION_TO_KEY: Record<string, string> = {
  'commande annul': 'commande_annulee',
  'commune erron': 'commune_erronee',
  'en cours de livraison': 'en_livraison',
  livr: 'livre',
  retour: 'retourne',
  'en transit': 'en_transit',
  'en preparation': 'en_transit',
};

// Statuts qui peuvent déclencher une notification WhatsApp automatique
// (au changement de statut pendant le sync ZRExpress).
const AUTO_NOTIFY_STATUSES = [
  { key: 'en_transit', label: 'En transit' },
  { key: 'en_livraison', label: 'En cours de livraison' },
  { key: 'livre', label: 'Livré' },
  { key: 'echec', label: 'Échec de livraison' },
  { key: 'retourne', label: 'Retourné' },
];

// Interrupteurs ON/OFF des notifications automatiques. Réglage partagé
// (user_sync_settings) — déplacé ici depuis la page Sync pour tout regrouper
// dans Messages WhatsApp. Clé absente = activé (comme le sync).
function AutoNotifyToggles() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadSyncSettings()
      .then((s) => {
        setEnabled(s.notify_enabled ?? {});
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const isOn = (key: string) => enabled[key] !== false;

  const toggle = async (key: string) => {
    const next = { ...enabled, [key]: !isOn(key) };
    setEnabled(next);
    try {
      await saveSyncSettings({ notify_enabled: next });
    } catch {
      toast.error('Erreur de sauvegarde');
    }
  };

  return (
    <div className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200/80 dark:border-stone-800 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Bell size={16} className="text-amber-500" />
        <h3 className="font-semibold text-stone-900 dark:text-stone-100">
          Notifications automatiques
        </h3>
        <span className="ml-auto text-xs text-stone-400 dark:text-stone-500">
          Au changement de statut
        </span>
      </div>
      <p className="text-xs text-stone-400 dark:text-stone-500">
        Choisissez les statuts qui envoient un WhatsApp automatique à vos clients. Le contenu = les
        messages ci-dessus.
      </p>
      {!loaded ? (
        <div className="flex justify-center py-4">
          <Loader2 size={18} className="animate-spin text-stone-400 dark:text-stone-500" />
        </div>
      ) : (
        <div className="space-y-2">
          {AUTO_NOTIFY_STATUSES.map((s) => (
            <div
              key={s.key}
              className="flex items-center gap-3 px-3 py-2 rounded-xl border border-stone-200 dark:border-stone-700"
            >
              <button
                onClick={() => toggle(s.key)}
                title={isOn(s.key) ? 'Désactiver' : 'Activer'}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${isOn(s.key) ? 'bg-green-500' : 'bg-stone-300'}`}
              >
                <span
                  className={`inline-block h-4 w-4 mt-0.5 transform rounded-full bg-white shadow transition-transform ${isOn(s.key) ? 'translate-x-4' : 'translate-x-0.5'}`}
                />
              </button>
              <span
                className={`flex-1 text-sm font-medium ${isOn(s.key) ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500 line-through'}`}
              >
                {s.label}
              </span>
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isOn(s.key) ? 'text-green-600 bg-green-100' : 'text-stone-400 dark:text-stone-500 bg-stone-100'}`}
              >
                {isOn(s.key) ? 'ON' : 'OFF'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function statusToLabel(status: string): string {
  const map: Record<string, string> = {
    en_preparation: 'En preparation',
    en_livraison: 'En cours de livraison',
    livre: 'Livre',
    retourne: 'Retourne',
    en_transit: 'En transit',
    echec: 'Echec',
  };
  return map[status] || status || '—';
}

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}
    >
      {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
      {connected ? 'Connecte' : 'Deconnecte'}
    </span>
  );
}

// Carte « Warm-up » — laisse l'user démarrer/arrêter le régime progressif pour
// un nouveau numéro WhatsApp. C'est la protection principale contre le ban :
// un numéro neuf commence à 8 msg/j puis monte à 15, 25 et 40 sur ~2 semaines.
function WarmupCard() {
  interface State {
    isActive: boolean;
    limit: number;
    label: string;
    daysElapsed: number;
    nextPhaseInDays: number | null;
    startedAt: string | null;
  }
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/whatsapp/warmup')
      .then((r) => r.json())
      .then(setState)
      .catch(() => setState(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (action: 'start' | 'stop') => {
    setBusy(true);
    const r = await fetch('/api/whatsapp/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error || 'Erreur');
      setBusy(false);
      return;
    }
    setState(j);
    toast.success(
      action === 'start'
        ? 'Warm-up démarré — le plafond montera automatiquement'
        : 'Warm-up désactivé — plafond normal 40/24h'
    );
    setBusy(false);
  };

  if (!state) return null;
  const days = Math.floor(state.daysElapsed);

  return (
    <div
      className={`rounded-xl p-4 border ${state.isActive ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30' : 'bg-stone-50 dark:bg-stone-800/50 border-stone-200 dark:border-stone-700'}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${state.isActive ? 'bg-amber-500 text-white' : 'bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400'}`}
        >
          {state.isActive ? <Flame size={17} /> : <Zap size={17} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-stone-900 dark:text-stone-100 text-sm">
              Warm-up numéro WhatsApp
            </p>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${state.isActive ? 'bg-amber-500 text-white' : 'bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300'}`}
            >
              {state.limit} msg/24h
            </span>
          </div>
          <p className="text-xs text-stone-600 dark:text-stone-300 mt-0.5">{state.label}</p>
          {state.isActive && (
            <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">
              Jour {days + 1} du warm-up
              {state.nextPhaseInDays != null && state.nextPhaseInDays > 0 && (
                <> · palier suivant dans {Math.ceil(state.nextPhaseInDays)}&nbsp;j</>
              )}
            </p>
          )}
          {!state.isActive && (
            <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">
              Active-le quand tu connectes un <strong>nouveau numéro</strong> pour éviter un ban.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            {state.isActive ? (
              <>
                <button
                  onClick={() => post('start')}
                  disabled={busy}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700 disabled:opacity-50"
                >
                  Réinitialiser
                </button>
                <button
                  onClick={() => post('stop')}
                  disabled={busy}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
                >
                  Arrêter
                </button>
              </>
            ) : (
              <button
                onClick={() => post('start')}
                disabled={busy}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50"
              >
                Démarrer le warm-up
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnexionTab() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [phone, setPhone] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    fetch('/api/ai-chatbot/whatsapp/status')
      .then((r) => r.json())
      .then((j) => {
        setConnected(j.connected || false);
        setPhone(j.phone || '');
      })
      .catch(() => setConnected(false));
    return stopPoll;
  }, []);

  const startPoll = () => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const j = await fetch('/api/ai-chatbot/whatsapp/status').then((r) => r.json());
        if (j.connected) {
          setConnected(true);
          setPhone(j.phone || '');
          setQr(null);
          setBusy(false);
          stopPoll();
          toast.success(`WhatsApp connecté${j.phone ? ` — +${j.phone}` : ''} !`);
        }
      } catch {
        /* rafraîchissement non bloquant */
      }
    }, 3000);
  };

  const connect = async () => {
    setBusy(true);
    setQr(null);

    // Ensure instance exists
    const instJson = await fetch('/api/ai-chatbot/whatsapp/instance')
      .then((r) => r.json())
      .catch(() => ({}));
    if (!instJson.instance) {
      const cr = await fetch('/api/ai-chatbot/whatsapp/instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
      })
        .then((r) => r.json())
        .catch(() => ({ error: 'Erreur réseau' }));
      if (cr.error) {
        toast.error(cr.error);
        setBusy(false);
        return;
      }
    }

    // Get QR from Evolution API
    const qrJson = await fetch('/api/ai-chatbot/whatsapp/qr')
      .then((r) => r.json())
      .catch(() => ({ error: 'Erreur réseau' }));
    if (qrJson.connected) {
      setConnected(true);
      setPhone(qrJson.phone || '');
      setBusy(false);
      return;
    }
    if (!qrJson.qr) {
      toast.error(qrJson.error || "Impossible d'obtenir le QR");
      setBusy(false);
      return;
    }

    const qrData = qrJson.qr.startsWith('data:') ? qrJson.qr : `data:image/png;base64,${qrJson.qr}`;
    setQr(qrData);
    setBusy(false);
    startPoll();
  };

  const handleDisconnect = async () => {
    stopPoll();
    await fetch('/api/ai-chatbot/whatsapp/instance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    }).catch(() => {});
    setConnected(false);
    setPhone('');
    setQr(null);
    toast.success('Déconnecté');
  };

  const handleRefreshQr = async () => {
    stopPoll();
    setBusy(true);
    setQr(null);
    const qrJson = await fetch('/api/ai-chatbot/whatsapp/qr')
      .then((r) => r.json())
      .catch(() => ({ error: 'Erreur réseau' }));
    if (!qrJson.qr) {
      toast.error(qrJson.error || 'QR non disponible');
      setBusy(false);
      return;
    }
    const qrData = qrJson.qr.startsWith('data:') ? qrJson.qr : `data:image/png;base64,${qrJson.qr}`;
    setQr(qrData);
    setBusy(false);
    startPoll();
  };

  const handleCheckStatus = async () => {
    const j = await fetch('/api/ai-chatbot/whatsapp/status')
      .then((r) => r.json())
      .catch(() => ({}));
    setConnected(j.connected || false);
    setPhone(j.phone || '');
  };

  if (connected === null)
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-stone-400 dark:text-stone-500" />
      </div>
    );

  return (
    <div className="max-w-xl space-y-6">
      {/* Statut */}
      <div
        className={`rounded-xl p-5 border-2 ${connected ? 'border-green-200 bg-green-50' : 'border-stone-200 dark:border-stone-700 bg-stone-50'}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${connected ? 'bg-green-500' : qr ? 'bg-amber-400' : 'bg-stone-300'}`}
            >
              <MessageSquare size={20} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-stone-900 dark:text-stone-100">WhatsApp</p>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${connected ? 'bg-green-100 text-green-700' : qr ? 'bg-amber-100 text-amber-700' : busy ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}
              >
                {connected ? (
                  <>
                    <Wifi size={12} /> Connecté
                  </>
                ) : qr ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> En attente du scan...
                  </>
                ) : busy ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> Connexion...
                  </>
                ) : (
                  <>
                    <WifiOff size={12} /> Déconnecté
                  </>
                )}
              </span>
              {connected && phone && <p className="text-xs text-green-600 mt-0.5">+{phone}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCheckStatus}
              className="p-1.5 border border-stone-200 dark:border-stone-700 rounded-lg hover:bg-white dark:bg-stone-900"
            >
              <RefreshCw size={14} className="text-stone-400 dark:text-stone-500" />
            </button>
            {connected && (
              <button
                onClick={handleDisconnect}
                className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
              >
                Déconnecter
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Warm-up — protège un nouveau numéro d'un ban */}
      <WarmupCard />

      {/* QR Code */}
      {!connected && (
        <div className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200/80 dark:border-stone-800 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <QrCode size={16} className="text-stone-500 dark:text-stone-400" />
            <h3 className="font-semibold text-stone-900 dark:text-stone-100">Connecter WhatsApp</h3>
          </div>

          {qr ? (
            <div className="flex flex-col items-center gap-3">
              <img
                src={qr}
                alt="QR Code WhatsApp"
                className="w-56 h-56 rounded-xl border border-stone-200 dark:border-stone-700"
              />
              <p className="text-xs text-stone-500 dark:text-stone-400 text-center">
                Ouvre WhatsApp → <strong>Appareils liés</strong> → scanne ce QR
              </p>
              <p className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg">
                QR expire en 20 secondes — rafraichis si expiré
              </p>
              <button
                onClick={handleRefreshQr}
                disabled={busy}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg hover:bg-stone-50 dark:hover:bg-stone-800 disabled:opacity-50"
              >
                <RefreshCw size={13} /> Nouveau QR
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-blue-50 rounded-xl p-4 space-y-1.5">
                {[
                  "Ton numero WhatsApp sera le numero d'envoi des notifications",
                  'Aucun abonnement requis — utilise ton compte WhatsApp personnel ou Business',
                  'Session gérée par Evolution API',
                ].map((t, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle size={13} className="text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-blue-800">{t}</p>
                  </div>
                ))}
              </div>
              <button
                onClick={connect}
                disabled={busy}
                className="w-full bg-green-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Génération QR...
                  </>
                ) : (
                  <>
                    <QrCode size={15} /> Connecter WhatsApp
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {connected && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle size={20} className="text-green-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">WhatsApp connecté</p>
            <p className="text-xs text-green-700">
              Les notifications de livraison seront envoyées depuis le +{phone}
            </p>
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
  const [defaults, setDefaults] = useState<DbTemplate[]>([]);
  const [editing, setEditing] = useState(false);
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

  useEffect(() => {
    fetch('/api/ai-chatbot/whatsapp/status')
      .then((r) => r.json())
      .then((j) => setConnected(j.connected || false));
  }, []);
  useEffect(() => {
    fetch('/api/templates')
      .then((r) => r.json())
      .then((j) => {
        setTemplates(j.data || []);
        setDefaults(j.defaults || []);
      })
      .catch(() => {});
  }, []);

  const saveTemplate = async (t: EditableTemplate) => {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...t, is_active: true }),
    });
    const json = await res.json();
    if (json.error) {
      toast.error(json.error);
      return;
    }
    toast.success('Message sauvegardé !');
    setTemplates((prev) => prev.map((p) => (p.key === t.key ? { ...p, ...t } : p)));
  };
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);
  useEffect(() => {
    setSubSituationFilter('');
    if (!situationFilter) return;
    const key = SITUATION_TO_KEY[situationFilter];
    if (key) setTemplateId(key);
  }, [situationFilter]);

  // Unique wilayas from loaded orders for sub-filter
  const SUB_SITUATIONS = [
    'Reporté à une date ultérieure',
    'Ne répond pas 3',
    'Ne répond pas 2',
    'Ne répond pas 1',
  ];

  // Apply wilaya sub-filter client-side
  const displayedOrders = subSituationFilter
    ? orders.filter((o) => o.situation === subSituationFilter)
    : orders;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const template = templates.find((t) => t.key === templateId) || null;
  const previewOrder = orders[0] || MOCK_ORDER;
  const ordersWithPhone = displayedOrders.filter(
    (o) => o.customer_whatsapp && o.customer_whatsapp.length > 5
  );

  const toggleAll = () => {
    if (ordersWithPhone.every((o) => selected.has(o.id))) setSelected(new Set());
    else setSelected(new Set(ordersWithPhone.map((o) => o.id)));
  };

  const sendMessages = async () => {
    if (selected.size === 0) {
      toast.error('Selectionne au moins un client');
      return;
    }
    const recipients = displayedOrders
      .filter((o) => selected.has(o.id))
      .map((o) => ({
        tracking: o.tracking_number,
        client: o.customer_name,
        whatsapp: o.customer_whatsapp,
        message:
          templateId === 'custom' ? customText : renderTemplate(template?.content_darija ?? '', o),
      }));
    setSending(true);
    try {
      const json = await postSend(recipients);
      if (json.error) toast.error(json.error);
      else if (json.deferred?.length) {
        // Envoi partiel : seuls les destinataires NON traités restent
        // sélectionnés — un nouveau clic ne renvoie rien aux premiers.
        const left = new Set(json.deferred.map((d) => d.tracking));
        setSelected(
          new Set(displayedOrders.filter((o) => left.has(o.tracking_number)).map((o) => o.id))
        );
        toast.warning(`${json.sent} envoyé(s). ${json.hint}`, { duration: 12000 });
      } else {
        toast.success(`${json.sent} message(s) envoye(s)`);
        setSelected(new Set());
      }
      if (!json.error && json.duplicates?.length) {
        toast.info(
          `${json.duplicates.length} destinataire(s) déjà servi(s) récemment ou en double — non renvoyé(s).`,
          { duration: 8000 }
        );
      }
    } finally {
      setSending(false);
    }
  };

  const sendTest = async () => {
    if (!testPhone) {
      toast.error('Entre un numero de telephone');
      return;
    }
    const mockO = { ...MOCK_ORDER, whatsapp: testPhone };
    const message =
      templateId === 'custom'
        ? customText || 'هذا رسالة تجريبية'
        : renderTemplate(template?.content_darija ?? '', mockO);
    setSendingTest(true);
    try {
      const json = await postSend([
        { tracking: 'TEST', client: 'Test', whatsapp: testPhone, message },
      ]);
      if (json.error) toast.error(json.error);
      else toast.success('Message de test envoye !');
    } finally {
      setSendingTest(false);
    }
  };

  const card =
    'rounded-xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900';
  const field =
    'h-10 w-full px-3 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-[14px] text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-900/10 dark:focus:ring-white/10';
  const step = (n: number) => (
    <span className="w-6 h-6 rounded-full bg-stone-900 dark:bg-white text-white dark:text-stone-900 grid place-items-center text-[12px] font-medium shrink-0">
      {n}
    </span>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
      <div className="space-y-6 min-w-0">
        {/* 1. À qui ? */}
        <section className={`${card} p-6`}>
          <div className="flex items-center gap-3">
            {step(1)}
            <h2 className="text-[15px] font-semibold text-stone-900 dark:text-stone-50">À qui ?</h2>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <select
              value={situationFilter}
              onChange={(e) => {
                setSituationFilter(e.target.value);
                setPage(1);
                setSelected(new Set());
              }}
              className={field}
              aria-label="Situation"
            >
              {SITUATION_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            {situationFilter === 'en cours de livraison' && (
              <select
                value={subSituationFilter}
                onChange={(e) => setSubSituationFilter(e.target.value)}
                className={`${field} sm:max-w-[260px]`}
                aria-label="Précision"
              >
                <option value="">Toutes les précisions</option>
                {SUB_SITUATIONS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between rounded-lg bg-stone-50 dark:bg-white/[0.04] px-4 py-3 text-[14px]">
            <span className="text-stone-700 dark:text-stone-200">
              <span className="font-semibold tabular-nums">
                {(subSituationFilter ? displayedOrders.length : total).toLocaleString('fr-FR')}
              </span>{' '}
              commande(s) · cochez les clients à contacter
            </span>
            {ordersWithPhone.length > 0 && (
              <button
                onClick={toggleAll}
                className="text-[13px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
              >
                {ordersWithPhone.every((o) => selected.has(o.id))
                  ? 'Tout décocher'
                  : 'Cocher la page'}
              </button>
            )}
          </div>

          <ul className="mt-3 divide-y divide-stone-100 dark:divide-stone-800 text-[14px]">
            {loadingOrders ? (
              [0, 1, 2].map((i) => (
                <li key={i} className="py-3">
                  <div className="h-8 rounded bg-stone-100 dark:bg-stone-800 animate-pulse" />
                </li>
              ))
            ) : displayedOrders.length === 0 ? (
              <li className="py-6 text-center text-stone-400">Aucune commande pour ce filtre.</li>
            ) : (
              displayedOrders.map((order) => {
                const hasPhone = !!(order.customer_whatsapp && order.customer_whatsapp.length > 5);
                return (
                  <li
                    key={order.id}
                    onClick={() => {
                      if (!hasPhone) return;
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(order.id)) n.delete(order.id);
                        else n.add(order.id);
                        return n;
                      });
                    }}
                    className={`flex items-center gap-3 py-2.5 ${
                      hasPhone
                        ? 'cursor-pointer hover:bg-stone-50/70 dark:hover:bg-white/[0.03]'
                        : 'opacity-40'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(order.id)}
                      disabled={!hasPhone}
                      readOnly
                      className="rounded border-stone-300 dark:border-stone-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-stone-900 dark:text-stone-100 truncate">
                        <bdi>{order.customer_name || '—'}</bdi>
                      </div>
                      <div className="text-[12.5px] text-stone-400 truncate">
                        {order.customer_whatsapp || 'Pas de numéro'} · {order.wilaya || '—'}
                      </div>
                    </div>
                    <span className="hidden sm:inline text-[12px] text-stone-500 bg-stone-100 dark:bg-white/[0.06] px-2 py-0.5 rounded truncate max-w-[200px]">
                      {order.situation || statusToLabel(order.delivery_status)}
                    </span>
                  </li>
                );
              })
            )}
          </ul>

          {totalPages > 1 && !subSituationFilter && (
            <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between text-[13px] text-stone-500">
              <span className="tabular-nums">
                Page {page} / {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="h-8 px-3 rounded-md border border-stone-200 dark:border-stone-800 disabled:text-stone-300 dark:disabled:text-stone-600"
                >
                  Précédent
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="h-8 px-3 rounded-md border border-stone-200 dark:border-stone-800 disabled:text-stone-300 dark:disabled:text-stone-600"
                >
                  Suivant
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 2. Quel message ? */}
        <section className={`${card} p-6`}>
          <div className="flex items-center gap-3">
            {step(2)}
            <h2 className="text-[15px] font-semibold text-stone-900 dark:text-stone-50">
              Quel message ?
            </h2>
            <div className="flex-1" />
            {templateId !== 'custom' && template && (
              <button
                onClick={() => setEditing((e) => !e)}
                className="text-[13px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
              >
                {editing ? 'Terminé' : 'Modifier'}
              </button>
            )}
          </div>

          <select
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setEditing(false);
            }}
            className={`${field} mt-4`}
            aria-label="Message"
          >
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
            <option value="custom">Message personnalisé</option>
          </select>

          <div className="mt-4">
            {templateId === 'custom' ? (
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="كتب رسالتك..."
                rows={5}
                dir="rtl"
                className="w-full rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-stone-900/10 dark:focus:ring-white/10"
              />
            ) : editing && template ? (
              <TemplateEditCard
                key={template.key}
                inline
                tpl={template}
                def={defaults.find((d) => d.key === template.key)}
                onSave={saveTemplate}
              />
            ) : (
              <>
                <div
                  className="rounded-lg bg-[#e7f8ee] dark:bg-emerald-500/10 px-4 py-3.5 text-[14px] leading-7 text-stone-800 dark:text-stone-100 whitespace-pre-line text-right"
                  dir="rtl"
                >
                  {renderTemplate(template?.content_darija ?? '', previewOrder)}
                </div>
                <p className="mt-2 text-[12.5px] text-stone-400">
                  {orders.length > 0 ? 'Aperçu avec le premier client' : 'Aperçu (exemple)'} · les
                  variables sont remplacées pour chaque client.
                </p>
              </>
            )}
          </div>
        </section>
      </div>

      {/* Envoi */}
      <aside className={`${card} p-6 lg:sticky lg:top-6`}>
        <h2 className="text-[15px] font-semibold text-stone-900 dark:text-stone-50">Envoi</h2>

        {connected === false && (
          <div className="mt-4 rounded-md border border-amber-200/70 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-500/[0.06] px-3 py-2.5 text-[12.5px] text-amber-900 dark:text-amber-100">
            WhatsApp n’est pas connecté : ouvrez l’onglet Connexion pour scanner le QR code.
          </div>
        )}

        <dl className="mt-4 space-y-2.5 text-[14px]">
          <div className="flex justify-between">
            <dt className="text-stone-500">Clients cochés</dt>
            <dd className="tabular-nums font-medium text-stone-900 dark:text-stone-100">
              {selected.size}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">Message</dt>
            <dd className="text-stone-900 dark:text-stone-100 truncate max-w-[160px]">
              {templateId === 'custom' ? 'Personnalisé' : (template?.name ?? '—')}
            </dd>
          </div>
        </dl>

        <p className="mt-4 rounded-md bg-stone-50 dark:bg-white/[0.04] px-3 py-2.5 text-[12.5px] text-stone-500">
          Protection anti-blocage : envois espacés et limités par jour. Ce qui dépasse la limite
          reste coché pour plus tard.
        </p>

        <button
          onClick={sendMessages}
          disabled={sending || selected.size === 0 || !connected}
          className="mt-5 w-full h-10 rounded-md bg-stone-900 dark:bg-white text-white dark:text-stone-900 text-[14px] font-medium flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {selected.size > 0
            ? `Envoyer à ${selected.size} client${selected.size > 1 ? 's' : ''}`
            : 'Cochez des clients'}
        </button>

        <div className="mt-5 pt-5 border-t border-stone-100 dark:border-stone-800">
          <div className="text-[13px] text-stone-500 mb-2">Tester d’abord sur mon numéro</div>
          <div className="flex gap-2">
            <input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="0770 12 34 56"
              className="h-9 flex-1 min-w-0 px-3 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-stone-900/10 dark:focus:ring-white/10"
            />
            <button
              onClick={sendTest}
              disabled={!testPhone || sendingTest || !connected}
              className="h-9 px-3 rounded-md border border-stone-200 dark:border-stone-800 text-[13.5px] text-stone-700 dark:text-stone-200 disabled:opacity-40 flex items-center gap-1.5"
            >
              {sendingTest && <Loader2 size={13} className="animate-spin" />}
              Tester
            </button>
          </div>
        </div>
      </aside>
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
    setResending((s) => new Set(s).add(msg.id));
    try {
      const json = await postSend([
        {
          tracking: msg.tracking_number,
          client: msg.customer_name,
          whatsapp: msg.customer_whatsapp,
          message: msg.message,
        },
      ]);
      if (json.error) toast.error(json.error);
      else if ((json.sent ?? 0) > 0) {
        toast.success('Message renvoyé !');
        fetchMessages();
      } else
        toast.error(
          `Echec du renvoi${json.results?.[0]?.error ? ' : ' + json.results[0].error : ''}`
        );
    } finally {
      setResending((s) => {
        const n = new Set(s);
        n.delete(msg.id);
        return n;
      });
    }
  };

  const resendAll = async () => {
    // Uniquement les échecs RÉCENTS jamais renvoyés avec succès (voir
    // lib/whatsapp/resend-selection) — jamais l'historique d'avril-juillet.
    const failed = selectResendable(messages);
    if (failed.length === 0) return;
    setResendingAll(true);
    const recipients = failed.map((m) => ({
      tracking: m.tracking_number,
      client: m.customer_name,
      whatsapp: m.customer_whatsapp,
      message: m.message,
    }));
    try {
      await handleResendAll(await postSend(recipients), failed.length);
    } finally {
      setResendingAll(false);
    }
  };

  const handleResendAll = async (json: SendResponse, total: number) => {
    if (json.code === 'NOT_CONNECTED') {
      // Erreur claire avec hint : on garde l'info visible, pas juste un toast éphémère
      toast.error(`${json.error}${json.hint ? '\n' + json.hint : ''}`, { duration: 8000 });
      checkWaStatus(); // refresh la bannière
    } else if (json.code === 'DAILY_LIMIT_REACHED') {
      // Protection anti-suspension : on ne dépasse pas le plafond journalier
      toast.error(
        `${json.error}\n${json.hint || ''}\nDéjà envoyé : ${json.sentToday}/${json.dailyLimit} en 24h`,
        { duration: 12000 }
      );
    } else if (json.sessionDead) {
      // Evolution dit « open » mais Baileys est mort → on signale clairement
      toast.error(json.hint || 'Session WhatsApp expirée — reconnecte le QR', { duration: 10000 });
      checkWaStatus();
      fetchMessages(); // affiche quand même les nouveaux échecs (pour debug)
    } else if (json.circuitBroken) {
      // Coupe-circuit anti-spam déclenché
      toast.warning(`${json.sent} envoyé(s), ${json.failed} échec(s) — ${json.hint}`, {
        duration: 10000,
      });
      fetchMessages();
    } else if (json.error) {
      toast.error(json.error);
    } else {
      const quotaMsg = json.dailyLimit ? ` · Quota : ${json.sentToday}/${json.dailyLimit}` : '';
      const skipped = json.skippedForQuota ? ` · ${json.skippedForQuota} sautés (quota)` : '';
      const deferred = json.deferred?.length
        ? ` · ${json.deferred.length} en attente (relance)`
        : '';
      toast.success(
        `${json.sent}/${total} message(s) renvoyé(s)${(json.failed ?? 0) > 0 ? ` — ${json.failed} échec(s)` : ''}${skipped}${deferred}${quotaMsg}`
      );
      fetchMessages();
    }
  };

  const statusConfig: Record<string, { label: string; bg: string }> = {
    envoye: { label: 'Envoye', bg: 'bg-green-100 text-green-700' },
    echec: { label: 'Echec', bg: 'bg-red-100 text-red-600' },
    en_attente: { label: 'En attente', bg: 'bg-amber-100 text-amber-700' },
  };

  const echecCount = messages.filter((m) => m.status === 'echec').length;
  const resendableCount = selectResendable(messages).length;
  const displayed = filterEchec ? messages.filter((m) => m.status === 'echec') : messages;

  return (
    <div className="space-y-4">
      {/* Bannière protections anti-suspension — visible en permanence pour rappeler
          les règles automatiques qui protègent le numéro WhatsApp d'être banni. */}
      <details className="bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 group">
        <summary className="px-4 py-2.5 cursor-pointer flex items-center gap-2 font-medium select-none">
          <AlertCircle size={14} className="text-blue-600 shrink-0" />
          <span>Protections anti-suspension WhatsApp actives</span>
          <span className="ml-auto text-blue-500 text-[10px] group-open:hidden">▼ détails</span>
          <span className="ml-auto text-blue-500 text-[10px] hidden group-open:inline">
            ▲ masquer
          </span>
        </summary>
        <div className="px-4 pb-3 pt-1 space-y-1.5 text-blue-800">
          <p>
            Pour éviter que ton numéro soit suspendu pour spam, AutoTim applique automatiquement :
          </p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>
              <strong>Plafond 100 messages / 24h</strong> glissant — au-delà, le batch est refusé
            </li>
            <li>
              <strong>Délai aléatoire 3-6 sec</strong> entre chaque envoi — pas de rythme robotique
            </li>
            <li>
              <strong>Variation du texte</strong> (emoji + caractère invisible) — chaque message a
              une signature unique pour WhatsApp
            </li>
            <li>
              <strong>Coupe-circuit</strong> : si 5 envois consécutifs échouent, le batch s'arrête
              automatiquement
            </li>
          </ul>
          <p className="pt-1 text-[11px] text-blue-700">
            Conseils complémentaires : démarre un nouveau numéro avec 20-30 messages/jour pendant 1
            semaine, puis augmente progressivement. Évite d'envoyer entre 22h et 8h.
          </p>
        </div>
      </details>

      {/* Bannière statut connexion WhatsApp — diagnostic principal du « pourquoi
          mes messages échouent ». Si la session WA est déconnectée, ne pas
          essayer de renvoyer en masse — ça générera juste 200 échecs de plus. */}
      {waStatus && !waStatus.connected && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="text-amber-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                WhatsApp déconnecté — c'est pour ça que tes messages échouent
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                État backend : <code className="font-mono">{waStatus.status}</code>. Reconnecte
                WhatsApp avant de renvoyer.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={checkWaStatus}
              disabled={statusChecking}
              className="p-2 hover:bg-amber-100 rounded-lg disabled:opacity-50"
              title="Vérifier à nouveau"
            >
              <RefreshCw
                size={14}
                className={`text-amber-700 ${statusChecking ? 'animate-spin' : ''}`}
              />
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
          <button
            onClick={checkWaStatus}
            disabled={statusChecking}
            className="text-green-600 hover:text-green-800"
            title="Rafraîchir"
          >
            <RefreshCw size={11} className={statusChecking ? 'animate-spin' : ''} />
          </button>
        </div>
      )}

      {/* Bannière échecs */}
      {echecCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="text-red-500 shrink-0" />
            <p className="text-sm text-red-700 font-medium">
              {echecCount} message{echecCount > 1 ? 's' : ''} en échec — non livré
              {echecCount > 1 ? 's' : ''}
            </p>
          </div>
          {resendableCount > 0 && (
            <button
              onClick={resendAll}
              disabled={resendingAll}
              title="Échecs de moins de 24 h, jamais renvoyés avec succès"
              className="flex items-center gap-1.5 text-sm px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 font-medium shrink-0"
            >
              {resendingAll ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Renvoyer les échecs récents ({resendableCount})
            </button>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200/80 dark:border-stone-800 overflow-hidden">
        <div className="p-4 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <History size={16} className="text-stone-500 dark:text-stone-400" />
            <h3 className="font-semibold text-stone-900 dark:text-stone-100">
              Historique des messages
            </h3>
            {echecCount > 0 && (
              <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">
                {echecCount} echec
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {resendableCount > 0 && (
              <button
                onClick={resendAll}
                disabled={resendingAll}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 font-medium"
              >
                {resendingAll ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                Renvoyer les récents ({resendableCount})
              </button>
            )}
            <button
              onClick={() => setFilterEchec((f) => !f)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border font-medium transition-colors ${filterEchec ? 'bg-red-600 text-white border-red-600' : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:border-red-400 hover:text-red-600'}`}
            >
              <AlertCircle size={12} />
              Echec seulement
            </button>
            <button
              onClick={fetchMessages}
              className="p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg"
            >
              <RefreshCw size={14} className="text-stone-400 dark:text-stone-500" />
            </button>
          </div>
        </div>

        <div className="divide-y divide-stone-50 dark:divide-stone-800">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-stone-400 dark:text-stone-500" />
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-stone-400 dark:text-stone-500">
              <MessageSquare size={32} className="mb-2 opacity-30" />
              <p className="text-sm">
                {filterEchec ? 'Aucun message en echec' : 'Aucun message envoye'}
              </p>
            </div>
          ) : (
            displayed.map((msg) => {
              const cfg = statusConfig[msg.status] || statusConfig.en_attente;
              const isResending = resending.has(msg.id);
              return (
                <div
                  key={msg.id}
                  className={`p-4 hover:bg-stone-50 dark:hover:bg-stone-800 ${msg.status === 'echec' ? 'border-l-2 border-red-300' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-stone-900 dark:text-stone-100 text-sm">
                          {msg.customer_name}
                        </span>
                        <span className="text-xs text-stone-400 dark:text-stone-500">
                          {msg.customer_whatsapp}
                        </span>
                        {msg.tracking_number && (
                          <span className="text-xs font-mono bg-stone-100 px-1.5 py-0.5 rounded text-stone-500 dark:text-stone-400">
                            {msg.tracking_number}
                          </span>
                        )}
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg}`}>
                          {cfg.label}
                        </span>
                      </div>
                      <p
                        className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 whitespace-pre-line text-right"
                        dir="rtl"
                      >
                        {msg.message}
                      </p>
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
                      <span className="text-[10px] text-stone-400 dark:text-stone-500">
                        {new Date(msg.sent_at).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {msg.status === 'echec' && (
                        <button
                          onClick={() => resend(msg)}
                          disabled={isResending}
                          className="flex items-center gap-1 text-xs px-2.5 py-1 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-600 hover:text-white transition-colors disabled:opacity-50 font-medium"
                        >
                          {isResending ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <RefreshCw size={11} />
                          )}
                          Renvoyer
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
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

const TPL_VARS = ['{{client}}', '{{tracking}}', '{{produit}}', '{{wilaya}}', '{{cod}}', '{{lien}}'];

type LangKey = 'content_darija' | 'content_arabic' | 'content_french';

function TemplateEditCard({
  tpl,
  def,
  onSave,
  inline,
}: {
  tpl: EditableTemplate;
  def?: EditableTemplate;
  onSave: (t: EditableTemplate) => Promise<void>;
  inline?: boolean;
}) {
  const [open, setOpen] = useState(inline ?? false);
  const [lang, setLang] = useState<LangKey>('content_darija');
  const [form, setForm] = useState<EditableTemplate>(tpl);
  const [saving, setSaving] = useState(false);

  const langCfg = TPL_LANGS.find((l) => l.id === lang)!;
  const content = form[lang] as string;

  const save = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div
      className={
        inline
          ? 'border border-stone-100 dark:border-stone-800 rounded-xl overflow-hidden'
          : 'bg-white dark:bg-stone-900 rounded-xl border border-stone-200/80 dark:border-stone-800 overflow-hidden'
      }
    >
      {!inline && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-100 dark:bg-green-500/15 rounded-lg flex items-center justify-center">
              <MessageSquare size={15} className="text-green-600" />
            </div>
            <span className="font-semibold text-stone-900 dark:text-stone-100">{tpl.name}</span>
            <span className="text-xs text-stone-400 dark:text-stone-500 font-mono">{tpl.key}</span>
          </div>
          {open ? (
            <ChevronUp size={16} className="text-stone-400 dark:text-stone-500" />
          ) : (
            <ChevronDown size={16} className="text-stone-400 dark:text-stone-500" />
          )}
        </button>
      )}
      {open && (
        <div
          className={`space-y-4 ${inline ? 'p-4 bg-stone-50/60 dark:bg-stone-800/40' : 'border-t border-stone-100 dark:border-stone-800 p-5'}`}
        >
          <div className="flex gap-1 bg-stone-100 p-1 rounded-xl w-fit">
            {TPL_LANGS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLang(l.id as LangKey)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${lang === l.id ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-sm' : 'text-stone-500 dark:text-stone-400'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TPL_VARS.map((v) => (
              <button
                key={v}
                onClick={() => setForm((f) => ({ ...f, [lang]: (f[lang] as string) + v }))}
                className="text-[10px] font-mono bg-green-50 text-green-700 px-1.5 py-0.5 rounded border border-green-200 hover:bg-green-100"
              >
                {v}
              </button>
            ))}
          </div>
          <textarea
            value={content}
            onChange={(e) => setForm((f) => ({ ...f, [lang]: e.target.value }))}
            rows={5}
            dir={langCfg.dir}
            className="w-full border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10 dark:focus:ring-white/10 resize-none"
          />
          <div className="flex gap-2">
            {def && (
              <button
                onClick={() => setForm((f) => ({ ...f, [lang]: def[lang] as string }))}
                className="flex items-center gap-1.5 text-xs px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-500 dark:text-stone-400"
              >
                <RotateCcw size={12} /> Réinitialiser
              </button>
            )}
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 text-sm px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium ml-auto"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}{' '}
              Sauvegarder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: 'envoyer', label: 'Envoyer' },
  { id: 'automatique', label: 'Automatique' },
  { id: 'historique', label: 'Historique' },
  { id: 'connexion', label: 'Connexion' },
];

export default function MessagesPage() {
  const [tab, setTab] = useState('envoyer');
  return (
    <AppLayout>
      <div className="max-w-[1120px] mx-auto px-5 sm:px-8 lg:px-10 py-8 lg:py-10 space-y-6">
        <h1 className="text-[26px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          Messages
        </h1>
        <div className="flex items-center gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-stone-200 dark:border-stone-800 text-[14px]">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-3 -mb-px border-b-2 whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-50 font-medium'
                  : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'envoyer' && <EnvoyerTab />}
        {tab === 'automatique' && (
          <div className="max-w-[760px]">
            <AutoNotifyToggles />
          </div>
        )}
        {tab === 'historique' && <HistoriqueTab />}
        {tab === 'connexion' && <ConnexionTab />}
      </div>
    </AppLayout>
  );
}
