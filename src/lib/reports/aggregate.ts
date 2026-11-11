// Agrégats de la page Rapports — calculés à partir des commandes.
//
// Avant : seulement des compteurs et le top des wilayas. Le marchand ne voyait
// ni l'argent encaissé, ni ce que les retours lui coûtent, ni QUELS produits
// et QUELLES wilayas font ses retours.

export interface ReportRow {
  delivery_status?: string | null;
  wilaya?: string | null;
  cod?: number | string | null;
  product_name?: string | null;
}

export interface GroupStat {
  name: string;
  total: number;
  livre: number;
  refus: number;
  /** Livrés / colis terminés, 0..100 (null si aucun colis terminé). */
  taux: number | null;
  /** Montant encaissé sur les colis livrés (DA). */
  ca: number;
}

export interface Report {
  total: number;
  livre: number;
  echec: number;
  retourne: number;
  enCours: number;
  /** Livrés / (livrés + échecs + retours), 0..100. */
  tauxLivraison: number;
  caEncaisse: number;
  caPerdu: number;
  caEnCours: number;
  panierMoyen: number;
  wilayas: GroupStat[];
  produits: GroupStat[];
}

const ACTIVE = new Set(['en_preparation', 'en_transit', 'en_livraison']);

/**
 * Nom de produit sans la variante : « Veste EMY ( 50 / Grenat ) - 1 » →
 * « Veste EMY ». Le libellé ZRExpress colle taille, couleur et quantité au nom,
 * ce qui éclatait un même produit en dizaines de lignes.
 */
export function productBase(raw: string | null | undefined): string {
  const base = String(raw ?? '')
    .split(/[([{]/)[0]
    .replace(/\s*[-x×*]\s*\d+\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return base || 'Sans nom';
}

function group(rows: ReportRow[], nameOf: (r: ReportRow) => string | null): GroupStat[] {
  const map = new Map<string, GroupStat>();
  for (const r of rows) {
    const name = nameOf(r);
    if (!name) continue;
    const key = name.toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = { name, total: 0, livre: 0, refus: 0, taux: null, ca: 0 };
      map.set(key, g);
    }
    g.total++;
    if (r.delivery_status === 'livre') {
      g.livre++;
      g.ca += Number(r.cod) || 0;
    } else if (r.delivery_status === 'echec' || r.delivery_status === 'retourne') g.refus++;
  }
  for (const g of map.values()) {
    const termine = g.livre + g.refus;
    g.taux = termine > 0 ? Math.round((g.livre / termine) * 100) : null;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export function buildReport(rows: ReportRow[], top = { wilayas: 15, produits: 10 }): Report {
  let livre = 0;
  let echec = 0;
  let retourne = 0;
  let enCours = 0;
  let caEncaisse = 0;
  let caPerdu = 0;
  let caEnCours = 0;
  for (const r of rows) {
    const cod = Number(r.cod) || 0;
    const s = String(r.delivery_status ?? '');
    if (s === 'livre') {
      livre++;
      caEncaisse += cod;
    } else if (s === 'echec' || s === 'retourne') {
      if (s === 'echec') echec++;
      else retourne++;
      caPerdu += cod;
    } else if (ACTIVE.has(s)) {
      enCours++;
      caEnCours += cod;
    }
  }
  const termine = livre + echec + retourne;
  return {
    total: rows.length,
    livre,
    echec,
    retourne,
    enCours,
    tauxLivraison: termine > 0 ? Math.round((livre / termine) * 100) : 0,
    caEncaisse,
    caPerdu,
    caEnCours,
    panierMoyen: livre > 0 ? Math.round(caEncaisse / livre) : 0,
    wilayas: group(rows, (r) => String(r.wilaya ?? '').trim() || null).slice(0, top.wilayas),
    produits: group(rows, (r) => productBase(r.product_name)).slice(0, top.produits),
  };
}
