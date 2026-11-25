'use client';

// Demandes des clients reçues par WhatsApp le jour de la livraison :
// « reporter à demain » ou « changer l'adresse ». Le marchand les transmet au
// livreur / à ZRExpress puis les marque « traitée ».

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, MapPin, Phone } from 'lucide-react';

interface Request {
  id: string;
  tracking: string;
  phone: string;
  answer: string;
  label: string;
  answered_at: string;
  customer_name: string;
  wilaya: string;
  product: string;
}

const localPhone = (p: string) => (p.startsWith('213') ? '0' + p.slice(3) : p);

export default function ClientRequests() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/inbox/requests');
    if (r.ok) setRequests(((await r.json()) as { requests: Request[] }).requests ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (requests.length === 0) return null;

  const done = async (id: string) => {
    setBusy(id);
    await fetch('/api/inbox/requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setBusy(null);
    load();
  };

  return (
    <div className="card-soft bg-white dark:bg-stone-900 overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100 dark:border-stone-800">
        <h2 className="font-bold text-indigo-950 dark:text-stone-100">
          Demandes des clients ({requests.length})
        </h2>
        <p className="text-[13px] text-stone-500 dark:text-stone-400">
          Réponses WhatsApp le jour de la livraison — à transmettre au livreur ou à ZRExpress.
        </p>
      </div>
      <ul className="divide-y divide-stone-50 dark:divide-stone-800">
        {requests.map((r) => (
          <li key={r.id} className="px-6 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold ${
                r.answer === '2'
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                  : 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
              }`}
            >
              {r.answer === '2' ? <CalendarClock size={12} /> : <MapPin size={12} />}
              {r.label}
            </span>
            <span className="font-bold text-indigo-950 dark:text-stone-50">
              {r.customer_name || 'Client'}
            </span>
            <span className="text-[13px] text-stone-500 dark:text-stone-400">
              {r.wilaya || '—'}
            </span>
            <span className="font-mono text-[12px] text-stone-400">{r.tracking}</span>
            <a
              href={`tel:${localPhone(r.phone)}`}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-violet-700 dark:text-violet-300"
            >
              <Phone size={12} /> {localPhone(r.phone)}
            </a>
            <span className="text-[12px] text-stone-400">
              {new Date(r.answered_at).toLocaleString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <button
              disabled={busy === r.id}
              onClick={() => done(r.id)}
              className="ml-auto inline-flex items-center gap-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 px-3 py-1.5 text-[12.5px] font-bold disabled:opacity-50"
            >
              <Check size={13} /> Traitée
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
