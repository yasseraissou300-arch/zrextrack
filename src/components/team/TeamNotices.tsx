'use client';

// Deux encarts affichés au-dessus de chaque page de l'espace connecté :
//   - InvitationBanner : « X vous invite dans son équipe » → Accepter / Refuser
//   - OwnerOnlyNotice  : un employé ouvre une page réservée au propriétaire

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock, Users } from 'lucide-react';

interface Invitation {
  id: string;
  from: string;
}

export function InvitationBanner() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/team/invitation')
      .then((r) => (r.ok ? r.json() : { invitations: [] }))
      .then((j) => setInvitations(Array.isArray(j.invitations) ? j.invitations : []))
      .catch(() => {});
  }, []);

  if (invitations.length === 0) return null;

  const answer = async (id: string, action: 'accept' | 'decline') => {
    setBusy(id);
    setError('');
    const res = await fetch('/api/team/invitation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(j.error || 'Action impossible');
      return;
    }
    if (action === 'accept') {
      window.location.href = '/admin-dashboard';
      return;
    }
    setInvitations((list) => list.filter((i) => i.id !== id));
  };

  return (
    <div className="mx-5 sm:mx-8 lg:mx-10 mt-5 space-y-2">
      {invitations.map((inv) => (
        <div
          key={inv.id}
          className="card-soft bg-white dark:bg-stone-900 p-4 flex flex-wrap items-center gap-3"
        >
          <div className="w-10 h-10 rounded-xl grid place-items-center bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300 shrink-0">
            <Users size={19} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <p className="font-extrabold text-indigo-950 dark:text-stone-50">
              {inv.from} vous invite dans son équipe
            </p>
            <p className="text-[13px] text-stone-500 dark:text-stone-400">
              En acceptant, vous travaillerez sur ses commandes (vos propres données restent de
              côté).
            </p>
          </div>
          <div className="flex gap-2">
            <button
              disabled={busy === inv.id}
              onClick={() => answer(inv.id, 'decline')}
              className="px-4 py-2 rounded-xl text-[13.5px] font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 dark:bg-white/[0.06] dark:text-stone-300 disabled:opacity-50"
            >
              Refuser
            </button>
            <button
              disabled={busy === inv.id}
              onClick={() => answer(inv.id, 'accept')}
              className="btn-brand px-4 py-2 rounded-xl text-[13.5px] font-semibold disabled:opacity-50"
            >
              Accepter
            </button>
          </div>
        </div>
      ))}
      {error && <p className="text-[13px] text-rose-600">{error}</p>}
    </div>
  );
}

export function OwnerOnlyNotice() {
  return (
    <div className="max-w-xl mx-auto px-5 py-20 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl grid place-items-center bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
        <Lock size={24} />
      </div>
      <h1 className="mt-4 text-[22px] font-extrabold text-indigo-950 dark:text-stone-50">
        Page réservée au propriétaire
      </h1>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        Votre compte employé donne accès aux commandes, à l’AutoSwap, aux clients et aux rapports.
        Les réglages, WhatsApp et la corbeille restent gérés par le propriétaire du compte.
      </p>
      <Link
        href="/admin-dashboard"
        className="btn-brand inline-block mt-6 px-5 py-2.5 rounded-xl text-sm font-semibold"
      >
        Retour à l’accueil
      </Link>
    </div>
  );
}
