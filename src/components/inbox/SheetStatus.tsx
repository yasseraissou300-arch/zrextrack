'use client';

// État du Google Sheet relié : erreur du dernier import en clair (Sheet non
// partagé, introuvable, colonnes non reconnues) + changement de lien.

import { useState } from 'react';
import { AlertTriangle, FileSpreadsheet } from 'lucide-react';

const ERRORS: Record<string, { title: string; help: string }> = {
  no_access: {
    title: 'Google Sheet inaccessible',
    help: 'Dans Google Sheets : Partager → Accès général → « Toute personne disposant du lien » → Lecteur. Puis cliquez « Importer du Sheet ».',
  },
  not_found: {
    title: 'Google Sheet introuvable',
    help: 'Le lien ne correspond à aucun Sheet. Collez à nouveau le lien complet (docs.google.com/spreadsheets/d/…).',
  },
  bad_header: {
    title: 'Colonnes non reconnues',
    help: 'La 1re ligne du Sheet doit contenir les titres : au minimum « nom » et « téléphone » (ou « الاسم » et « رقم الهاتف »).',
  },
  unavailable: {
    title: 'Google Sheets indisponible',
    help: 'Nouvel essai automatique dans 2 minutes.',
  },
};

export default function SheetStatus({
  status,
  owner,
  onSaved,
}: {
  status: string | null;
  owner: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = status ? ERRORS[status] : undefined;

  const save = async (sheetUrl: string) => {
    setBusy(true);
    setError('');
    const res = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'settings', sheet_url: sheetUrl }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error || 'Erreur');
    setEditing(false);
    setUrl('');
    onSaved();
  };

  if (!problem && !editing) {
    return owner ? (
      <button
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-violet-700 dark:text-violet-300 hover:underline"
      >
        <FileSpreadsheet size={13} /> Changer de Google Sheet
      </button>
    ) : null;
  }

  return (
    <div
      className={`card-soft p-4 ${problem ? 'bg-amber-50 dark:bg-amber-500/10' : 'bg-white dark:bg-stone-900'}`}
    >
      {problem && (
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-bold text-amber-900 dark:text-amber-200">{problem.title}</p>
            <p className="text-[13px] text-amber-800/90 dark:text-amber-200/80">{problem.help}</p>
          </div>
          {owner && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-[12.5px] font-semibold text-violet-700 dark:text-violet-300 hover:underline whitespace-nowrap"
            >
              Changer le lien
            </button>
          )}
        </div>
      )}
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(url);
          }}
          className="mt-3 flex flex-wrap gap-2"
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
            Enregistrer
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="h-10 px-3 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 dark:bg-white/[0.06] dark:text-stone-300"
          >
            Annuler
          </button>
          {error && <p className="w-full text-[13px] text-rose-600">{error}</p>}
        </form>
      )}
    </div>
  );
}
