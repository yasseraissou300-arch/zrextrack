'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import { Phone, PhoneCall, History, Settings as SettingsIcon, Loader2, Save, AlertCircle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';

interface VoiceSettings {
  account_sid?: string;
  auth_token?: string;
  from_number?: string;
  shop_name?: string;
  message_template?: string;
  voice?: string;
  confirm_text?: string;
  cancel_text?: string;
  no_answer_text?: string;
  enabled?: boolean;
}

interface VoiceCall {
  id: string;
  tracking_number?: string;
  customer_name?: string;
  customer_phone: string;
  amount?: number;
  twilio_call_sid?: string;
  status?: string;
  outcome?: string;
  duration_seconds?: number;
  cost_da?: number;
  created_at: string;
  completed_at?: string;
}

type Tab = 'connexion' | 'test' | 'historique';

export default function VoiceCallsPage() {
  const [tab, setTab] = useState<Tab>('test');
  return (
    <AppLayout>
      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center shadow-sm shadow-emerald-500/25">
            <PhoneCall size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100 tracking-tight">AI Voice Calling</h1>
            <p className="text-sm text-stone-500 dark:text-stone-400">Confirme tes commandes par appel automatique en darija</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-stone-100 dark:bg-stone-800 p-1 rounded-xl w-fit">
          {[
            { id: 'test', label: 'Lancer un appel', icon: <PhoneCall size={13} /> },
            { id: 'historique', label: 'Historique', icon: <History size={13} /> },
            { id: 'connexion', label: 'Connexion Twilio', icon: <SettingsIcon size={13} /> },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as Tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === t.id
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-sm'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'connexion' && <ConnexionTab />}
        {tab === 'test' && <TestTab />}
        {tab === 'historique' && <HistoriqueTab />}
      </div>
    </AppLayout>
  );
}

// ─── ConnexionTab ───────────────────────────────────────────────────────────
function ConnexionTab() {
  const [s, setS] = useState<VoiceSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/voice-calls/settings');
    const json = await res.json();
    setS({ ...(json.defaults ?? {}), ...(json.settings ?? {}) });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/voice-calls/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else { toast.success('Paramètres sauvegardés'); load(); }
    setSaving(false);
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-stone-400" /></div>;

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 space-y-1">
        <p className="font-semibold">Setup Twilio (5 min)</p>
        <ol className="list-decimal pl-5 space-y-0.5">
          <li>Crée un compte sur <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noopener" className="underline">twilio.com</a> (crédit gratuit ~$15)</li>
          <li>Achète un numéro virtuel (Active numbers → Buy a number, ~$1.15/mois)</li>
          <li>Console Twilio → copie ton <strong>Account SID</strong> et ton <strong>Auth Token</strong> (Dashboard)</li>
          <li>Colle-les ci-dessous + ton numéro Twilio au format +1xxx</li>
          <li>Active le module et fais un test depuis l'onglet « Lancer un appel »</li>
        </ol>
      </div>

      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 p-5 space-y-3">
        <h3 className="font-semibold text-stone-900 dark:text-stone-100 text-sm">Identifiants Twilio</h3>
        <Field label="Account SID" value={s.account_sid || ''} onChange={v => setS({ ...s, account_sid: v })} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
        <Field label="Auth Token" value={s.auth_token || ''} onChange={v => setS({ ...s, auth_token: v })} placeholder="••••••••" mono />
        <Field label="Numéro Twilio (from)" value={s.from_number || ''} onChange={v => setS({ ...s, from_number: v })} placeholder="+15551234567" />
        <label className="flex items-center gap-2 pt-2">
          <input type="checkbox" checked={!!s.enabled} onChange={e => setS({ ...s, enabled: e.target.checked })} />
          <span className="text-sm text-stone-700 dark:text-stone-200">Activer le module Voice Calling</span>
        </label>
      </div>

      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 p-5 space-y-3">
        <h3 className="font-semibold text-stone-900 dark:text-stone-100 text-sm">Script darija</h3>
        <Field label="Nom de la boutique" value={s.shop_name || ''} onChange={v => setS({ ...s, shop_name: v })} placeholder="Big Shopping" />
        <FieldArea label="Message principal (placeholders : {name} {amount} {shop_name})" value={s.message_template || ''} onChange={v => setS({ ...s, message_template: v })} />
        <FieldArea label="Si touche 1 (confirme)" value={s.confirm_text || ''} onChange={v => setS({ ...s, confirm_text: v })} />
        <FieldArea label="Si touche 2 (annule)" value={s.cancel_text || ''} onChange={v => setS({ ...s, cancel_text: v })} />
        <FieldArea label="Si pas de réponse" value={s.no_answer_text || ''} onChange={v => setS({ ...s, no_answer_text: v })} />
        <div className="text-[11px] text-stone-500 dark:text-stone-400">Voix : <code>Polly.Hala-Neural</code> (féminine arabe, naturelle). Modifiable dans la DB plus tard.</div>
      </div>

      <button onClick={save} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg disabled:opacity-50">
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        Enregistrer
      </button>
    </div>
  );
}

// ─── TestTab ────────────────────────────────────────────────────────────────
function TestTab() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [tracking, setTracking] = useState('');
  const [calling, setCalling] = useState(false);

  const start = async () => {
    if (!phone) { toast.error('Numéro de téléphone requis'); return; }
    setCalling(true);
    const res = await fetch('/api/voice-calls/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: name,
        customer_phone: phone,
        amount: amount ? Number(amount) : undefined,
        tracking,
      }),
    });
    const json = await res.json();
    if (json.error) {
      toast.error(`${json.error}${json.hint ? '\n' + json.hint : ''}`, { duration: 8000 });
    } else {
      toast.success(`Appel initié ✓ (Twilio SID : ${json.callSid?.slice(-8)})`);
      setName(''); setPhone(''); setAmount(''); setTracking('');
    }
    setCalling(false);
  };

  return (
    <div className="space-y-4 max-w-xl">
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-xs text-blue-900">
        <p className="font-semibold">💡 Test sur ton propre numéro d'abord</p>
        <p className="mt-1">Avant de lancer des appels en masse, teste sur ton tel personnel pour vérifier la voix, le contenu, et que la touche 1/2 fonctionne bien.</p>
      </div>

      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 p-5 space-y-3">
        <Field label="Nom client" value={name} onChange={setName} placeholder="Ahmed Belkacem" />
        <Field label="Téléphone" value={phone} onChange={setPhone} placeholder="0556172674 ou +213556172674" />
        <Field label="Montant DA" value={amount} onChange={setAmount} placeholder="4500" />
        <Field label="N° tracking (optionnel)" value={tracking} onChange={setTracking} placeholder="XX-XXXXXXX-ZR" />
        <button onClick={start} disabled={calling || !phone} className="w-full flex items-center justify-center gap-2 mt-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl disabled:opacity-50">
          {calling ? <Loader2 size={16} className="animate-spin" /> : <PhoneCall size={16} />}
          Lancer l'appel
        </button>
      </div>
    </div>
  );
}

// ─── HistoriqueTab ──────────────────────────────────────────────────────────
function HistoriqueTab() {
  const [calls, setCalls] = useState<VoiceCall[]>([]);
  const [stats, setStats] = useState<{ total: number; confirmed: number; cancelled: number; no_answer: number; failed: number; total_cost_da: number; total_duration_seconds: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/voice-calls/list?limit=200');
    const json = await res.json();
    setCalls(json.data ?? []);
    setStats(json.stats ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Refresh auto pendant qu'il y a des appels en cours
  useEffect(() => {
    const inProgress = calls.some(c => !c.completed_at);
    if (!inProgress) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [calls, load]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-stone-400" /></div>;

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Total appels" value={stats.total} color="bg-stone-50 text-stone-700" />
          <Stat label="Confirmés" value={stats.confirmed} color="bg-green-50 text-green-700" />
          <Stat label="Annulés" value={stats.cancelled} color="bg-red-50 text-red-700" />
          <Stat label="Sans réponse" value={stats.no_answer} color="bg-amber-50 text-amber-700" />
          <Stat label="Coût total (DA)" value={Math.round(stats.total_cost_da)} color="bg-purple-50 text-purple-700" />
        </div>
      )}

      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 overflow-hidden">
        {calls.length === 0 ? (
          <div className="py-16 text-center text-stone-400">
            <Phone size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Aucun appel passé</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 dark:bg-stone-800 border-b border-stone-100 dark:border-stone-700">
              <tr>
                {['Date', 'Client', 'Téléphone', 'Montant', 'Résultat', 'Durée', 'Coût'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-stone-500 dark:text-stone-400 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
              {calls.map(c => (
                <tr key={c.id} className="hover:bg-stone-50 dark:hover:bg-stone-800">
                  <td className="px-4 py-3 text-[11px] text-stone-500">{new Date(c.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-3 text-xs font-medium text-stone-800 dark:text-stone-100">{c.customer_name || '—'}</td>
                  <td className="px-4 py-3 text-[11px] font-mono text-stone-500">{c.customer_phone}</td>
                  <td className="px-4 py-3 text-xs text-stone-700 dark:text-stone-200">{c.amount ? `${c.amount} DA` : '—'}</td>
                  <td className="px-4 py-3"><OutcomeBadge outcome={c.outcome} status={c.status} /></td>
                  <td className="px-4 py-3 text-[11px] text-stone-500">{c.duration_seconds ? `${c.duration_seconds}s` : '—'}</td>
                  <td className="px-4 py-3 text-[11px] text-stone-500">{c.cost_da ? `${c.cost_da} DA` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 text-sm border border-stone-200 dark:border-stone-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

function FieldArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-1">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 text-sm border border-stone-200 dark:border-stone-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100"
      />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-2xl p-4 text-center ${color}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-[11px] mt-0.5 opacity-80">{label}</p>
    </div>
  );
}

function OutcomeBadge({ outcome, status }: { outcome?: string; status?: string }) {
  if (outcome === 'confirmed') return <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700"><CheckCircle2 size={10} />Confirmé</span>;
  if (outcome === 'cancelled') return <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700"><XCircle size={10} />Annulé</span>;
  if (outcome === 'no_answer' || outcome === 'no_response') return <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"><AlertCircle size={10} />Sans réponse</span>;
  if (outcome === 'failed') return <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700"><XCircle size={10} />Échec</span>;
  if (status === 'in-progress' || status === 'ringing' || status === 'initiated' || status === 'queued') {
    return <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700"><Clock size={10} className="animate-pulse" />En cours…</span>;
  }
  return <span className="text-[10px] text-stone-400">—</span>;
}
