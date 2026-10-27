// Présentation des commandes dans l'interface (aucune règle métier ici).

/**
 * Description ZRExpress → libellé lisible.
 * "Veste EMY( EMY )( 48 / Grenat ) : - 1" → { name: "Veste EMY", variant: "48 / Grenat" }
 */
export function prettyProduct(raw: string | null | undefined): { name: string; variant: string } {
  const text = (raw ?? '').replace(/\s*:\s*-\s*\d+\s*$/, '').trim();
  if (!text) return { name: '—', variant: '' };
  const name = text.split('(')[0].trim() || text;
  const groups = [...text.matchAll(/\(([^()]*)\)/g)].map((m) => m[1].trim()).filter(Boolean);
  // Le premier groupe est le SKU quand il y en a plusieurs : on garde la variante.
  const variant = groups.length > 1 ? groups[groups.length - 1] : '';
  return { name, variant };
}

export const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  livre: {
    label: 'Livrée',
    className: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/10',
  },
  en_livraison: {
    label: 'En livraison',
    className: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-500/10',
  },
  en_transit: {
    label: 'En transit',
    className: 'text-sky-700 bg-sky-50 dark:text-sky-300 dark:bg-sky-500/10',
  },
  en_preparation: {
    label: 'Préparation',
    className: 'text-stone-600 bg-stone-100 dark:text-stone-300 dark:bg-white/[0.06]',
  },
  echec: {
    label: 'Échec',
    className: 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-500/10',
  },
  retourne: {
    label: 'Retournée',
    className: 'text-stone-600 bg-stone-100 dark:text-stone-300 dark:bg-white/[0.06]',
  },
};

export function statusBadge(status: string | null | undefined) {
  return (
    STATUS_LABEL[status ?? ''] ?? {
      label: status || '—',
      className: 'text-stone-600 bg-stone-100 dark:text-stone-300 dark:bg-white/[0.06]',
    }
  );
}

export const formatDA = (n: number | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('fr-FR')} DA`;
