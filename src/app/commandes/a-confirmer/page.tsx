'use client';

// Commandes à confirmer — tableau par colonnes (à la Notify) :
//   Nouvelles → En confirmation (WhatsApp envoyé) → Confirmées → Envoyées à ZR
// Les commandes arrivent du Google Sheet du marchand.

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import ShipDialog from '@/components/inbox/ShipDialog';
import WebhookCard from '@/components/inbox/WebhookCard';
import SheetStatus from '@/components/inbox/SheetStatus';
import { Globe } from 'lucide-react';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileSpreadsheet,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  PhoneOff,
  RefreshCw,
  Send,
  Store,
  Truck,
  X,
} from 'lucide-react';

type Status = 'new' | 'confirming' | 'confirmed' | 'cancelled' | 'no_answer' | 'sent';

interface Order {
  id: string;
  status: Status;
  source: string;
  customer_name: string;
  phone: string;
  wilaya: string;
  commune: string;
  address: string;
  product: string;
  quantity: number;
  price: number;
  delivery_type: 'domicile' | 'stopdesk';
  note: string;
  zr_tracking: string | null;
  zr_error: string | null;
  created_at: string;
  ordered_at: string | null;
  /** Colis passés de ce client chez ZRExpress. */
  history: { livre: number; refus: number; level: string } | null;
  /** Commandes en attente avec le même numéro (doublon possible si > 1). */
  duplicates: number;
}

const HISTORY_BADGE: Record<string, string> = {
  risque: 'bg-rose-600 text-white',
  surveiller: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  fidele: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  bon: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};

function HistoryBadge({ h }: { h: Order['history'] }) {
  if (!h || h.livre + h.refus === 0) return null;
  const label =
    h.level === 'risque'
      ? `⚠ ${h.refus} refus · ${h.livre} livré${h.livre > 1 ? 's' : ''}`
      : h.level === 'fidele' || h.level === 'bon'
        ? `Client fidèle · ${h.livre} livré${h.livre > 1 ? 's' : ''}`
        : `${h.refus} refus · ${h.livre} livré${h.livre > 1 ? 's' : ''}`;
  return (
    <span
      title="Colis passés de ce client chez ZRExpress"
      className={`rounded-full px-2 py-0.5 ${HISTORY_BADGE[h.level] ?? HISTORY_BADGE.surveiller}`}
    >
      {label}
    </span>
  );
}

interface Board {
  available: boolean;
  role: 'owner' | 'employe';
  source: {
    sheet_id: string | null;
    auto_confirm: boolean;
    confirm_template: string | null;
    last_import_at: string | null;
    last_import_status: string | null;
  } | null;
  service_email: string;
  webhook_url: string | null;
  default_template: string;
  whatsapp: { connected: boolean; reason?: string; remaining: number; official?: boolean };
  counts: Partial<Record<Status, number>>;
  orders: Order[];
}

const COLUMNS: {
  id: string;
  statuses: Status[];
  label: string;
  dot: string;
  icon: typeof Clock;
}[] = [
  { id: 'new', statuses: ['new'], label: 'Nouvelles', dot: 'bg-amber-400', icon: Clock },
  {
    id: 'confirming',
    statuses: ['confirming', 'no_answer'],
    label: 'En confirmation',
    dot: 'bg-blue-500',
    icon: MessageCircle,
  },
  {
    id: 'confirmed',
    statuses: ['confirmed'],
    label: 'Confirmées',
    dot: 'bg-emerald-500',
    icon: CheckCircle2,
  },
  { id: 'sent', statuses: ['sent'], label: 'Envoyées à ZR', dot: 'bg-violet-500', icon: Truck },
];

const da = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} DA`;
const localPhone = (p: string) => (p.startsWith('213') ? '0' + p.slice(3) : p);

function OrderCard({
  o,
  busy,
  onMove,
  onSend,
  onShip,
}: {
  o: Order;
  busy: boolean;
  onMove: (id: string, status: Status) => void;
  onSend: (id: string) => void;
  onShip: (o: Order) => void;
}) {
  const canConfirm = ['new', 'confirming', 'no_answer', 'cancelled'].includes(o.status);
  const canCancel = ['new', 'confirming', 'no_answer', 'confirmed'].includes(o.status);
  return (
    <div className="rounded-2xl bg-white dark:bg-stone-900 p-3.5 shadow-[0_4px_14px_-8px_rgba(80,60,180,0.25)] border border-transparent dark:border-stone-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-indigo-950 dark:text-stone-50 truncate">
            {o.customer_name || 'Sans nom'}
          </p>
          <p className="text-[12.5px] text-stone-500 dark:text-stone-400 truncate">
            {[o.wilaya, o.commune].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
        <span className="font-extrabold text-indigo-950 dark:text-stone-50 whitespace-nowrap text-[14px]">
          {da(o.price)}
        </span>
      </div>
      <p className="mt-2 text-[13px] text-stone-700 dark:text-stone-200 line-clamp-2">
        {o.product || '—'}
        {o.quantity > 1 && <span className="font-bold"> ×{o.quantity}</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] font-bold">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 px-2 py-0.5">
          {o.source === 'manual' ? <Globe size={11} /> : <FileSpreadsheet size={11} />}
          {o.source === 'manual' ? 'Site web' : 'Sheets'}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
            o.delivery_type === 'stopdesk'
              ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
              : 'bg-stone-100 text-stone-600 dark:bg-white/[0.06] dark:text-stone-300'
          }`}
        >
          {o.delivery_type === 'stopdesk' ? <Store size={11} /> : <MapPin size={11} />}
          {o.delivery_type === 'stopdesk' ? 'Stop desk' : 'Domicile'}
        </span>
        {o.status === 'no_answer' && (
          <span className="rounded-full bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 px-2 py-0.5">
            Sans réponse
          </span>
        )}
        <HistoryBadge h={o.history} />
        {o.duplicates > 1 && o.status !== 'sent' && (
          <span
            title="Le même numéro a d’autres commandes en attente"
            className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200 px-2 py-0.5"
          >
            Doublon ? ({o.duplicates})
          </span>
        )}
        {o.zr_tracking && (
          <span className="rounded-full bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 px-2 py-0.5 font-mono">
            {o.zr_tracking}
          </span>
        )}
      </div>
      <a
        href={`tel:${localPhone(o.phone)}`}
        className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-violet-700 dark:text-violet-300 font-semibold"
      >
        <Phone size={12} /> {localPhone(o.phone)}
      </a>
      {o.status === 'confirmed' && (
        <button
          disabled={busy}
          onClick={() => onShip(o)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg btn-brand py-1.5 text-[12.5px] font-bold disabled:opacity-50"
        >
          <Truck size={13} /> Envoyer à ZRExpress
        </button>
      )}
      {o.status === 'confirmed' && o.zr_error && o.zr_error !== '__envoi_en_cours__' && (
        <p className="mt-1.5 text-[11.5px] font-semibold text-rose-600 line-clamp-2">
          ZR : {o.zr_error}
        </p>
      )}
      {o.status === 'new' && (
        <button
          disabled={busy}
          onClick={() => onSend(o.id)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg btn-brand py-1.5 text-[12.5px] font-bold disabled:opacity-50"
        >
          <MessageCircle size={13} /> Demander la confirmation
        </button>
      )}
      {o.status !== 'sent' && (
        <div className="mt-1.5 flex gap-1.5">
          {canConfirm && o.status !== 'confirmed' && (
            <button
              disabled={busy}
              onClick={() => onMove(o.id, 'confirmed')}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 py-1.5 text-[12.5px] font-bold disabled:opacity-50"
            >
              <Check size={13} /> Confirmer
            </button>
          )}
          {(o.status === 'new' || o.status === 'confirming') && (
            <button
              disabled={busy}
              onClick={() => onMove(o.id, 'no_answer')}
              title="Appelé, pas de réponse"
              aria-label="Pas de réponse"
              className="w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-white/[0.06] dark:text-stone-300 py-1.5 disabled:opacity-50"
            >
              <PhoneOff size={14} />
            </button>
          )}
          {canCancel && (
            <button
              disabled={busy}
              onClick={() => onMove(o.id, 'cancelled')}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300 py-1.5 text-[12.5px] font-bold disabled:opacity-50"
            >
              <X size={13} /> Annuler
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const SAMPLE: Record<string, string> = {
  client: 'أمين',
  produit: 'Veste EMY',
  quantite: '1',
  prix: '3 200',
  wilaya: 'Oran',
  livraison: 'للدار',
};

function WhatsAppPanel({ board, onSaved }: { board: Board; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [tpl, setTpl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const owner = board.role === 'owner';
  const auto = !!board.source?.auto_confirm;
  const wa = board.whatsapp;

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    const res = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'settings', ...patch }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error || 'Erreur');
    setEditing(false);
    onSaved();
  };

  const preview = Object.entries(SAMPLE).reduce(
    (t, [k, v]) => t.split(`{{${k}}}`).join(v),
    tpl || board.default_template
  );

  return (
    <div className="card-soft bg-white dark:bg-stone-900 p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl grid place-items-center bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
          <MessageCircle size={19} />
        </div>
        <div className="flex-1 min-w-[220px]">
          <h2 className="font-extrabold text-indigo-950 dark:text-stone-50">
            Confirmation par WhatsApp
          </h2>
          <p className="text-[13px] text-stone-500 dark:text-stone-400">
            Le client répond <strong>1</strong> pour confirmer ou <strong>2</strong> pour annuler —
            la commande change de colonne toute seule.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-[12.5px] font-bold ${
            wa.connected
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
          }`}
        >
          {wa.connected
            ? `${wa.official ? 'WhatsApp officiel · ' : ''}${wa.remaining} message(s) restant(s) aujourd’hui`
            : 'WhatsApp non connecté'}
        </span>
      </div>

      {owner && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-stone-700 dark:text-stone-200 cursor-pointer">
            <input
              type="checkbox"
              checked={auto}
              disabled={busy}
              onChange={(e) => save({ auto_confirm: e.target.checked })}
              className="w-4 h-4 accent-violet-600"
            />
            Envoyer automatiquement aux nouvelles commandes
          </label>
          <button
            onClick={() => {
              setTpl(board.source?.confirm_template || board.default_template);
              setEditing((v) => !v);
            }}
            className="text-[13px] font-semibold text-violet-700 dark:text-violet-300 hover:underline"
          >
            {editing ? 'Fermer' : 'Modifier le message'}
          </button>
        </div>
      )}
      <p className="text-[12.5px] text-stone-500 dark:text-stone-400">
        Plafond partagé avec les notifications de livraison (protection contre le blocage du numéro)
        : au-delà, les demandes attendent le lendemain.
      </p>

      {editing && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <textarea
              value={tpl}
              onChange={(e) => setTpl(e.target.value)}
              rows={10}
              dir="auto"
              className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-3 text-[13.5px] text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(SAMPLE).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTpl((t) => `${t}{{${v}}}`)}
                  className="rounded-full bg-violet-50 dark:bg-white/[0.06] px-2.5 py-1 text-[12px] font-bold text-violet-700 dark:text-violet-200"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={() => save({ confirm_template: tpl })}
                className="btn-brand px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                Enregistrer
              </button>
              <button
                disabled={busy}
                onClick={() => save({ confirm_template: '' })}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 dark:bg-white/[0.06] dark:text-stone-300 disabled:opacity-50"
              >
                Message par défaut
              </button>
            </div>
            {error && <p className="text-[13px] text-rose-600">{error}</p>}
          </div>
          <div className="rounded-2xl bg-[#efeae2] dark:bg-stone-800 p-4">
            <div
              dir="auto"
              className="max-w-[320px] rounded-2xl rounded-tl-sm bg-white dark:bg-stone-700 px-3.5 py-2.5 text-[13.5px] leading-6 text-stone-800 dark:text-stone-100 whitespace-pre-line shadow-sm"
            >
              {preview}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SheetSetup({ board, onSaved }: { board: Board; onSaved: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  if (board.role !== 'owner') {
    return (
      <div className="card-soft bg-white dark:bg-stone-900 p-6 text-sm text-stone-600 dark:text-stone-300">
        Le propriétaire du compte doit d’abord relier son Google Sheet de commandes.
      </div>
    );
  }

  return (
    <div className="card-soft bg-white dark:bg-stone-900 p-6 space-y-4 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl grid place-items-center bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
          <FileSpreadsheet size={19} />
        </div>
        <div>
          <h2 className="font-extrabold text-indigo-950 dark:text-stone-50">
            Reliez votre Google Sheet de commandes
          </h2>
          <p className="text-[13px] text-stone-500 dark:text-stone-400">
            Les nouvelles lignes apparaissent ici automatiquement, prêtes à confirmer.
          </p>
        </div>
      </div>
      <ol className="space-y-3 text-[13.5px] text-stone-700 dark:text-stone-200">
        <li>
          <strong>1.</strong> Dans Google Sheets → <em>Partager</em> → <em>Accès général</em> :
          choisissez <strong>« Toute personne disposant du lien »</strong> en <em>Lecteur</em>.
          {board.service_email && (
            <span className="block mt-1.5 text-[12.5px] text-stone-500 dark:text-stone-400">
              Ou, pour garder le Sheet privé, partagez-le en Lecteur avec :
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(board.service_email);
                  setCopied(true);
                }}
                className="mt-1 flex items-center gap-2 rounded-lg bg-violet-50 dark:bg-white/[0.06] px-3 py-2 font-mono text-[12.5px] text-violet-800 dark:text-violet-200 break-all text-left"
              >
                <Copy size={13} className="shrink-0" /> {board.service_email}
                {copied && <span className="font-sans font-bold text-emerald-600">copié</span>}
              </button>
            </span>
          )}
        </li>
        <li>
          <strong>2.</strong> La 1re ligne doit contenir les titres des colonnes (nom, téléphone,
          wilaya, commune, produit, quantité, prix… en français ou en arabe).
        </li>
        <li>
          <strong>3.</strong> Collez le lien du Sheet :
        </li>
      </ol>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const res = await fetch('/api/inbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'settings', sheet_url: url }),
          });
          const j = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) return setError(j.error || 'Erreur');
          onSaved();
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          className="flex-1 min-w-[240px] h-10 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <button
          disabled={busy || !url}
          className="btn-brand h-10 px-4 rounded-xl text-sm font-semibold disabled:opacity-50"
        >
          Relier
        </button>
      </form>
      {error && <p className="text-[13px] text-rose-600">{error}</p>}
    </div>
  );
}

export default function AConfirmerPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [shipping, setShipping] = useState<Order | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/inbox');
    if (res.ok) setBoard(await res.json());
  }, []);

  const importNow = useCallback(
    async (silent = false) => {
      if (!silent) setBusy(true);
      const res = await fetch('/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!silent) {
        setBusy(false);
        if (!res.ok) setNotice({ ok: false, text: j.error || 'Import impossible' });
        else if (j.reason === 'too_soon')
          setNotice({ ok: true, text: 'Déjà à jour (import il y a moins d’une minute)' });
        else
          setNotice({
            ok: true,
            text: `${j.imported} nouvelle(s) commande(s) importée(s)${j.skipped ? ` · ${j.skipped} ligne(s) sans téléphone valide ignorée(s)` : ''}`,
          });
      }
      await load();
    },
    [load]
  );

  useEffect(() => {
    load().then(() => importNow(true));
    // Nouvelles lignes du Sheet toutes les 2 minutes tant que la page est ouverte.
    const t = setInterval(() => importNow(true), 120_000);
    return () => clearInterval(t);
  }, [load, importNow]);

  const sendConfirm = async (id: string) => {
    setBusy(true);
    const res = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send_confirm', id }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    setNotice(
      res.ok
        ? { ok: true, text: `Message WhatsApp envoyé · ${j.remaining} restant(s) aujourd’hui` }
        : { ok: false, text: j.error || 'Envoi impossible' }
    );
    await load();
  };

  const move = async (id: string, status: Status) => {
    setBusy(true);
    const res = await fetch('/api/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setNotice({ ok: false, text: j.error || 'Erreur' });
    await load();
  };

  const byColumn = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const c of COLUMNS) m.set(c.id, []);
    for (const o of board?.orders ?? []) {
      const col = COLUMNS.find((c) => c.statuses.includes(o.status));
      if (col) m.get(col.id)!.push(o);
    }
    return m;
  }, [board]);

  const cancelled = (board?.orders ?? []).filter((o) => o.status === 'cancelled');
  const count = (statuses: Status[]) => statuses.reduce((n, s) => n + (board?.counts?.[s] ?? 0), 0);

  return (
    <AppLayout>
      <div className="px-5 sm:px-8 lg:px-10 py-8 lg:py-10 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-indigo-950 dark:text-stone-50">
              À confirmer
            </h1>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              Commandes de votre boutique ou de votre Google Sheet, à confirmer avant l’envoi à
              ZRExpress
            </p>
          </div>
          {board?.available && board.source?.sheet_id && (
            <button
              disabled={busy}
              onClick={() => importNow(false)}
              className="btn-brand inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Importer du Sheet
            </button>
          )}
        </div>

        {notice && (
          <p
            className={`text-[13.5px] font-semibold ${notice.ok ? 'text-emerald-600' : 'text-rose-600'}`}
          >
            {notice.text}
          </p>
        )}

        {!board ? (
          <div className="flex justify-center py-16">
            <Loader2 size={22} className="animate-spin text-stone-400" />
          </div>
        ) : !board.available ? (
          <div className="card-soft bg-white dark:bg-stone-900 p-6 text-sm text-stone-600 dark:text-stone-300 max-w-2xl">
            Cette fonction sera disponible dans quelques instants (mise à jour de la base en cours).
          </div>
        ) : (
          <>
            {board.role === 'owner' && (
              <div className="grid gap-4 lg:grid-cols-2 items-start">
                {/* Boutique déjà reliée (commandes reçues) : le Sheet devient facultatif. */}
                {!board.source?.sheet_id && board.orders.length === 0 && (
                  <SheetSetup board={board} onSaved={() => importNow(false)} />
                )}
                <WebhookCard
                  url={board.webhook_url}
                  defaultOpen={!board.source?.sheet_id && board.orders.length === 0}
                />
              </div>
            )}
            {board.role !== 'owner' && !board.source?.sheet_id && board.orders.length === 0 && (
              <SheetSetup board={board} onSaved={() => importNow(false)} />
            )}
            {board.source?.sheet_id && (
              <SheetStatus
                status={board.source.last_import_status}
                owner={board.role === 'owner'}
                onSaved={() => importNow(false)}
              />
            )}
            <WhatsAppPanel board={board} onSaved={load} />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 items-start">
              {COLUMNS.map((c) => {
                const list = byColumn.get(c.id) ?? [];
                return (
                  <section
                    key={c.id}
                    className="rounded-2xl bg-white/60 dark:bg-white/[0.03] p-3 min-h-[200px]"
                  >
                    <header className="flex items-center gap-2 px-1 pb-3">
                      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                      <h2 className="font-extrabold text-indigo-950 dark:text-stone-50 text-[14.5px]">
                        {c.label}
                      </h2>
                      <span className="ml-auto rounded-full bg-white dark:bg-white/[0.08] px-2 py-0.5 text-[12px] font-bold text-stone-600 dark:text-stone-300">
                        {count(c.statuses)}
                      </span>
                    </header>
                    <div className="space-y-2.5">
                      {list.length === 0 ? (
                        <p className="px-1 py-6 text-center text-[12.5px] text-stone-400">
                          Aucune commande
                        </p>
                      ) : (
                        list.map((o) => (
                          <OrderCard
                            key={o.id}
                            o={o}
                            busy={busy}
                            onMove={move}
                            onSend={sendConfirm}
                            onShip={setShipping}
                          />
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
            </div>

            {cancelled.length > 0 && (
              <div>
                <button
                  onClick={() => setShowCancelled((v) => !v)}
                  className="text-[13px] font-semibold text-stone-500 hover:text-violet-700"
                >
                  {showCancelled ? 'Masquer' : 'Voir'} les {count(['cancelled'])} commande(s)
                  annulée(s)
                </button>
                {showCancelled && (
                  <div className="mt-3 grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                    {cancelled.map((o) => (
                      <OrderCard
                        key={o.id}
                        o={o}
                        busy={busy}
                        onMove={move}
                        onSend={sendConfirm}
                        onShip={setShipping}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {board.source?.sheet_id && (
              <p className="flex items-center gap-2 text-[12.5px] text-stone-400">
                <Send size={13} /> Dernier import du Sheet :{' '}
                {board.source.last_import_at
                  ? new Date(board.source.last_import_at).toLocaleString('fr-FR')
                  : 'jamais'}
              </p>
            )}
          </>
        )}
      </div>
      {shipping && (
        <ShipDialog
          order={shipping}
          onClose={() => setShipping(null)}
          onDone={async (tracking) => {
            setShipping(null);
            setNotice({ ok: true, text: `Colis créé chez ZRExpress : ${tracking}` });
            await load();
          }}
        />
      )}
    </AppLayout>
  );
}
