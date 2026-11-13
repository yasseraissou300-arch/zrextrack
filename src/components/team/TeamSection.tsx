'use client';

// Section « Équipe » de la page Mon compte.
//   - propriétaire : inviter un employé par e-mail Google, voir / retirer, journal
//   - employé      : dans quel espace il travaille, bouton « Quitter l'équipe »

import { useCallback, useEffect, useState } from 'react';
import { History, Loader2, LogOut, UserPlus, Users, X } from 'lucide-react';

interface Member {
  id: string;
  email: string;
  status: 'invited' | 'active';
  invited_at: string;
}

interface Activity {
  id: string;
  actor_email: string;
  actor_role: 'owner' | 'employe';
  summary: string;
  created_at: string;
}

type TeamState =
  | { role: 'employe'; workspace: string }
  | {
      role: 'owner';
      available: boolean;
      members: Member[];
      seats: number;
      activity: Activity[];
    };

const when = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function TeamSection() {
  const [team, setTeam] = useState<TeamState | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/team');
    if (res.ok) setTeam(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const call = async (method: 'POST' | 'PATCH', url: string, body: unknown, ok: string) => {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    setMessage(res.ok ? { ok: true, text: ok } : { ok: false, text: j.error || 'Erreur' });
    return res.ok;
  };

  if (!team) {
    return (
      <div className="card-soft bg-white dark:bg-stone-900 p-6 flex justify-center">
        <Loader2 size={20} className="animate-spin text-stone-400" />
      </div>
    );
  }

  if (team.role === 'employe') {
    return (
      <div className="card-soft bg-white dark:bg-stone-900 p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl grid place-items-center bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
            <Users size={19} />
          </div>
          <div>
            <h2 className="font-extrabold text-indigo-950 dark:text-stone-50">Équipe</h2>
            <p className="text-[13px] text-stone-500 dark:text-stone-400">
              Vous travaillez dans l’espace de <strong>{team.workspace}</strong> (compte employé).
            </p>
          </div>
        </div>
        <button
          disabled={busy}
          onClick={async () => {
            if (!window.confirm('Quitter cette équipe ? Vous retrouverez votre propre espace.'))
              return;
            if (await call('POST', '/api/team/invitation', { action: 'leave' }, 'Équipe quittée'))
              window.location.href = '/admin-dashboard';
          }}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13.5px] font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 disabled:opacity-50"
        >
          <LogOut size={15} /> Quitter l’équipe
        </button>
        {message && !message.ok && <p className="mt-2 text-[13px] text-rose-600">{message.text}</p>}
      </div>
    );
  }

  const used = team.members.length;
  const full = used >= team.seats;

  return (
    <div className="card-soft bg-white dark:bg-stone-900 p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl grid place-items-center bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
          <Users size={19} />
        </div>
        <div className="flex-1">
          <h2 className="font-extrabold text-indigo-950 dark:text-stone-50">Équipe</h2>
          <p className="text-[13px] text-stone-500 dark:text-stone-400">
            Donnez un accès à vos employés sans partager votre compte Google.
          </p>
        </div>
        <span className="rounded-full bg-violet-50 dark:bg-white/[0.06] px-3 py-1 text-[12.5px] font-bold text-violet-700 dark:text-violet-200">
          {used} / {team.seats}
        </span>
      </div>

      {!team.available ? (
        <p className="rounded-xl bg-amber-50 dark:bg-amber-500/10 p-3 text-[13px] text-amber-800 dark:text-amber-200">
          La gestion d’équipe sera disponible très bientôt.
        </p>
      ) : team.seats === 0 ? (
        <p className="rounded-xl bg-violet-50 dark:bg-white/[0.04] p-3 text-[13px] text-violet-800 dark:text-violet-200">
          L’offre Basic comprend 1 utilisateur. Passez à <strong>Pro</strong> (5 utilisateurs) ou{' '}
          <strong>Business</strong> (20 utilisateurs) pour ajouter des employés.
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call('POST', '/api/team', { email }, 'Invitation envoyée')) {
              setEmail('');
              load();
            }
          }}
          className="flex flex-wrap gap-2"
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-mail Google de l’employé"
            disabled={full || busy}
            className="flex-1 min-w-[220px] h-10 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={full || busy || !email}
            className="btn-brand h-10 px-4 rounded-xl text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <UserPlus size={15} /> Inviter
          </button>
        </form>
      )}

      {team.seats > 0 && team.available && (
        <p className="-mt-2 text-[12.5px] text-stone-500 dark:text-stone-400">
          L’employé se connecte sur AutoTim avec ce compte Google, puis accepte l’invitation. Il
          voit les commandes, l’AutoSwap, les clients et les rapports — pas les réglages, WhatsApp
          ni la corbeille.
        </p>
      )}

      {message && (
        <p className={`text-[13px] ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
          {message.text}
        </p>
      )}

      {team.members.length > 0 && (
        <ul className="divide-y divide-stone-100 dark:divide-stone-800 rounded-xl border border-stone-100 dark:border-stone-800">
          {team.members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 min-w-0 truncate text-sm font-semibold text-indigo-950 dark:text-stone-100">
                {m.email}
              </span>
              <span
                className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${
                  m.status === 'active'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                }`}
              >
                {m.status === 'active' ? 'Actif' : 'Invitation envoyée'}
              </span>
              <button
                disabled={busy}
                title="Retirer l’accès"
                onClick={async () => {
                  if (!window.confirm(`Retirer l’accès de ${m.email} ?`)) return;
                  if (await call('PATCH', '/api/team', { id: m.id }, 'Accès retiré')) load();
                }}
                className="w-8 h-8 grid place-items-center rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 disabled:opacity-50"
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {team.activity.length > 0 && (
        <div>
          <h3 className="flex items-center gap-2 text-[13px] font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wide">
            <History size={14} /> Journal
          </h3>
          <ul className="mt-2 space-y-1.5">
            {team.activity.slice(0, 15).map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3 text-[13px]">
                <span className="text-stone-400 tabular-nums">{when(a.created_at)}</span>
                <span className="font-semibold text-indigo-950 dark:text-stone-100">
                  {a.actor_role === 'owner' ? 'Vous' : a.actor_email}
                </span>
                <span className="text-stone-600 dark:text-stone-300">{a.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
