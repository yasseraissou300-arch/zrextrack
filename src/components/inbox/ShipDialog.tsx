'use client';

// Fenêtre « Envoyer à ZRExpress » : le marchand vérifie wilaya, commune,
// type de livraison (domicile / stop desk + bureau), montant et produit avant
// la création du colis — le colis est RÉEL.

import { useEffect, useState } from 'react';
import { Loader2, Truck, X } from 'lucide-react';

interface Place {
  id: string;
  name: string;
  nameArabic: string;
  code: number | null;
}
interface Hub {
  id: string;
  name: string;
  street: string;
}

interface Proposal {
  wilayas: Place[];
  match: { wilayaId: string | null; communeId: string | null };
  communes: Place[];
  hubs: Hub[];
  suggestion: {
    deliveryType: 'home' | 'pickup-point';
    amount: number;
    description: string;
    street: string;
  };
}

export interface ShipTarget {
  id: string;
  customer_name: string;
  wilaya: string;
  commune: string;
  zr_error: string | null;
}

const field =
  'w-full h-10 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-violet-500';
const label = 'block text-[12.5px] font-bold text-stone-500 dark:text-stone-400 mb-1';

export default function ShipDialog({
  order,
  onClose,
  onDone,
}: {
  order: ShipTarget;
  onClose: () => void;
  onDone: (tracking: string) => void;
}) {
  const [p, setP] = useState<Proposal | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wilayaId, setWilayaId] = useState('');
  const [communeId, setCommuneId] = useState('');
  const [communes, setCommunes] = useState<Place[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [deliveryType, setDeliveryType] = useState<'home' | 'pickup-point'>('home');
  const [hubId, setHubId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [street, setStreet] = useState('');

  useEffect(() => {
    fetch(`/api/inbox/ship?id=${encodeURIComponent(order.id)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Chargement impossible');
        return j as Proposal;
      })
      .then((j) => {
        setP(j);
        setWilayaId(j.match.wilayaId ?? '');
        setCommuneId(j.match.communeId ?? '');
        setCommunes(j.communes);
        setHubs(j.hubs);
        setDeliveryType(j.suggestion.deliveryType);
        setHubId(j.hubs.length === 1 ? j.hubs[0].id : '');
        setAmount(String(j.suggestion.amount));
        setDescription(j.suggestion.description);
        setStreet(j.suggestion.street);
      })
      .catch((e) => setError(e.message));
  }, [order.id]);

  const changeWilaya = async (id: string) => {
    setWilayaId(id);
    setCommuneId('');
    setHubId('');
    setCommunes([]);
    setHubs([]);
    if (!id) return;
    const r = await fetch(`/api/inbox/ship?wilaya=${id}`);
    if (r.ok) {
      const j = (await r.json()) as { communes: Place[]; hubs: Hub[] };
      setCommunes(j.communes);
      setHubs(j.hubs);
      if (j.hubs.length === 1) setHubId(j.hubs[0].id);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    const r = await fetch('/api/inbox/ship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: order.id,
        wilayaId,
        communeId,
        deliveryType,
        hubId: deliveryType === 'pickup-point' ? hubId : null,
        amount: Number(amount),
        description,
        street,
      }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(j.error || 'Envoi impossible');
    onDone(j.tracking);
  };

  const place = (x: Place) =>
    `${x.code ? `${x.code} - ` : ''}${x.name}${x.nameArabic ? ` · ${x.nameArabic}` : ''}`;
  const ready =
    wilayaId &&
    communeId &&
    description.trim() &&
    (deliveryType === 'home' || hubId) &&
    amount !== '';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-stone-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg card-soft bg-white dark:bg-stone-900 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl grid place-items-center bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
            <Truck size={19} />
          </div>
          <div className="flex-1">
            <h2 className="font-extrabold text-indigo-950 dark:text-stone-50">
              Envoyer à ZRExpress
            </h2>
            <p className="text-[13px] text-stone-500 dark:text-stone-400">
              {order.customer_name} — Sheet :{' '}
              {[order.wilaya, order.commune].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-stone-700"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {order.zr_error && order.zr_error !== '__envoi_en_cours__' && (
          <p className="mt-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 p-3 text-[13px] text-rose-700 dark:text-rose-300">
            Dernier essai refusé : {order.zr_error}
          </p>
        )}

        {!p && !error ? (
          <div className="flex justify-center py-10">
            <Loader2 size={22} className="animate-spin text-stone-400" />
          </div>
        ) : p ? (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className={label}>Wilaya</span>
                <select
                  className={field}
                  value={wilayaId}
                  onChange={(e) => changeWilaya(e.target.value)}
                >
                  <option value="">— choisir —</option>
                  {p.wilayas.map((w) => (
                    <option key={w.id} value={w.id}>
                      {place(w)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className={label}>Commune</span>
                <select
                  className={field}
                  value={communeId}
                  onChange={(e) => setCommuneId(e.target.value)}
                  disabled={!wilayaId}
                >
                  <option value="">— choisir —</option>
                  {communes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {place(c)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <span className={label}>Livraison</span>
              <div className="flex gap-2">
                {(['home', 'pickup-point'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDeliveryType(t)}
                    className={`flex-1 h-10 rounded-xl text-sm font-bold ${
                      deliveryType === t
                        ? 'btn-brand'
                        : 'bg-violet-50 text-violet-700 dark:bg-white/[0.06] dark:text-violet-200'
                    }`}
                  >
                    {t === 'home' ? 'À domicile' : 'Stop desk (bureau)'}
                  </button>
                ))}
              </div>
            </div>

            {deliveryType === 'pickup-point' && (
              <div>
                <span className={label}>Bureau ZRExpress</span>
                <select className={field} value={hubId} onChange={(e) => setHubId(e.target.value)}>
                  <option value="">
                    {hubs.length ? '— choisir —' : 'Aucun bureau dans cette wilaya'}
                  </option>
                  {hubs.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                      {h.street ? ` — ${h.street}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {deliveryType === 'home' && (
              <div>
                <span className={label}>Adresse</span>
                <input
                  className={field}
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                />
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <span className={label}>Produit</span>
                <input
                  className={field}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                <span className={label}>Montant (DA)</span>
                <input
                  className={field}
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                />
              </div>
            </div>

            <p className="text-[12.5px] text-stone-500 dark:text-stone-400">
              Le colis est créé pour de vrai chez ZRExpress (montant encaissé à la livraison).
            </p>
          </div>
        ) : null}

        {error && <p className="mt-4 text-[13px] font-semibold text-rose-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 h-10 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 dark:bg-white/[0.06] dark:text-stone-300"
          >
            Annuler
          </button>
          <button
            disabled={!ready || busy}
            onClick={submit}
            className="btn-brand px-5 h-10 rounded-xl text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Truck size={15} />}
            Créer le colis
          </button>
        </div>
      </div>
    </div>
  );
}
