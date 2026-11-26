'use client';

// « Connecter mon site » : adresse webhook personnelle + exemple d'envoi.
// Le site du marchand (formulaire de commande, boutique, Make / Zapier…)
// envoie chaque commande en JSON ; elle arrive dans « Nouvelles ».

import { useState } from 'react';
import { Check, Copy, Globe } from 'lucide-react';

const EXAMPLE = `{
  "id": "CMD-1001",
  "nom": "Amine B.",
  "telephone": "0550 12 34 56",
  "wilaya": "Oran",
  "commune": "Bir El Djir",
  "adresse": "Cité 200 logements",
  "produit": "Veste EMY",
  "quantite": 1,
  "prix": 3200,
  "livraison": "domicile"
}`;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 dark:bg-white/[0.06] px-3 py-1.5 text-[12.5px] font-bold text-violet-700 dark:text-violet-200"
    >
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copié' : label}
    </button>
  );
}

export default function WebhookCard({
  url,
  defaultOpen,
}: {
  url: string | null;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card-soft bg-white dark:bg-stone-900 p-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 text-left"
      >
        <div className="w-10 h-10 rounded-xl grid place-items-center bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
          <Globe size={19} />
        </div>
        <div className="flex-1">
          <h2 className="font-extrabold text-indigo-950 dark:text-stone-50">
            Connecter mon site (webhook)
          </h2>
          <p className="text-[13px] text-stone-500 dark:text-stone-400">
            Chaque commande passée sur votre site arrive ici automatiquement.
          </p>
        </div>
        <span className="text-[13px] font-semibold text-violet-700 dark:text-violet-300">
          {open ? 'Fermer' : 'Afficher'}
        </span>
      </button>

      {open &&
        (url ? (
          <div className="mt-4 space-y-4 text-[13.5px] text-stone-700 dark:text-stone-200">
            <div>
              <p className="font-bold">1. Votre adresse webhook (gardez-la secrète) :</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <code className="flex-1 min-w-[240px] rounded-lg bg-stone-100 dark:bg-stone-800 px-3 py-2 text-[12px] break-all">
                  {url}
                </code>
                <CopyButton text={url} label="Copier l’adresse" />
              </div>
            </div>
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-3">
              <p className="font-bold text-emerald-800 dark:text-emerald-200">
                Boutique TimStore (timstore.site) :
              </p>
              <p className="text-[13px] text-emerald-900/90 dark:text-emerald-100/90">
                Tableau de bord TimStore → <strong>Webhooks</strong> → Ajouter → collez l’adresse
                ci-dessus → événement <strong>Commande créée</strong> → Enregistrer. Chaque commande
                de la boutique arrive ici, prête à confirmer.
              </p>
            </div>
            <div>
              <p className="font-bold">
                2. Autre site : envoyez chaque nouvelle commande en <code>POST</code> (JSON) à cette
                adresse :
              </p>
              <pre className="mt-1.5 rounded-lg bg-stone-900 text-stone-100 p-3 text-[12px] overflow-x-auto">
                {EXAMPLE}
              </pre>
              <div className="mt-1.5">
                <CopyButton text={EXAMPLE} label="Copier l’exemple" />
              </div>
            </div>
            <p className="text-[12.5px] text-stone-500 dark:text-stone-400">
              Les noms de champs peuvent être en français, en anglais ou en arabe (nom / name /
              الاسم, telephone / phone / رقم الهاتف…). Seuls le nom et le téléphone sont
              obligatoires. Une commande renvoyée avec le même <code>id</code> n’est pas créée deux
              fois.
            </p>
          </div>
        ) : (
          <p className="mt-4 text-[13px] text-rose-600">
            Webhook indisponible : chiffrement non configuré sur le serveur.
          </p>
        ))}
    </div>
  );
}
