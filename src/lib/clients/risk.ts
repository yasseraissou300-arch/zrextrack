// Score de fiabilité d'un client — calculé à partir de SES commandes passées.
//
// Pourquoi : en paiement à la livraison, la perte principale est le colis qui
// revient (frais aller + retour payés pour rien). Sur le compte pilote, ZRExpress
// rapporte ~59 % de colis « récupérés par le fournisseur ». Un client qui a déjà
// refusé deux colis refusera très probablement le troisième : il faut le voir
// AVANT d'expédier.
//
// Aucune donnée stockée : tout est dérivé des commandes existantes.

import { normalizePhone } from '@/lib/whatsapp/message-builder';

export type RiskLevel = 'fidele' | 'bon' | 'nouveau' | 'surveiller' | 'risque';

export interface ClientOrderRow {
  customer_name?: string | null;
  customer_whatsapp?: string | null;
  wilaya?: string | null;
  delivery_status?: string | null;
  cod?: number | string | null;
  tracking_number?: string | null;
  product_name?: string | null;
}

export interface ClientStats {
  key: string;
  client: string;
  whatsapp: string;
  wilaya: string;
  total: number;
  /** Colis livrés (client servi). */
  livre: number;
  /** Colis non livrés : échec + retourné. */
  refus: number;
  /** Colis encore en route (préparation, transit, livraison). */
  enCours: number;
  /** Montant encaissé sur les colis livrés (DA). */
  caLivre: number;
  /** Part des colis TERMINÉS qui ont été livrés, 0..100 (null si aucun terminé). */
  tauxLivraison: number | null;
  level: RiskLevel;
}

export interface ActiveRiskyOrder {
  tracking_number: string;
  client: string;
  whatsapp: string;
  wilaya: string;
  product_name: string;
  cod: number;
  delivery_status: string;
  refus: number;
  livre: number;
}

const ACTIVE = new Set(['en_preparation', 'en_transit', 'en_livraison']);
const REFUSED = new Set(['echec', 'retourne']);

/**
 * Niveau de fiabilité.
 * - risque     : au moins 2 refus ET au moins 2 colis terminés sur 3 refusés
 * - surveiller : au moins 1 refus (sans atteindre « risque » ni « bon »)
 * - fidele     : au moins 2 colis livrés, aucun refus
 * - bon        : a déjà reçu un colis et refuse moins d'1 colis sur 3
 * - nouveau    : aucun colis terminé (rien à juger)
 */
export function riskLevel(livre: number, refus: number): RiskLevel {
  const termine = livre + refus;
  if (termine === 0) return 'nouveau';
  if (refus >= 2 && refus / termine >= 2 / 3) return 'risque';
  if (refus === 0) return livre >= 2 ? 'fidele' : 'bon';
  if (livre >= 1 && refus / termine < 1 / 3) return 'bon';
  return 'surveiller';
}

/** Clé de regroupement : le téléphone normalisé, à défaut le nom. */
export function clientKey(row: ClientOrderRow): string {
  const phone = normalizePhone(String(row.customer_whatsapp ?? ''));
  if (phone.length >= 11) return phone;
  return `nom:${String(row.customer_name ?? '')
    .trim()
    .toLowerCase()}`;
}

/** Regroupe les commandes par client et calcule son score. */
export function buildClientStats(rows: ClientOrderRow[]): ClientStats[] {
  const map = new Map<string, ClientStats>();
  for (const o of rows) {
    const key = clientKey(o);
    if (key === 'nom:') continue; // ni téléphone ni nom : inexploitable
    let c = map.get(key);
    if (!c) {
      c = {
        key,
        client: String(o.customer_name ?? ''),
        whatsapp: String(o.customer_whatsapp ?? ''),
        wilaya: String(o.wilaya ?? ''),
        total: 0,
        livre: 0,
        refus: 0,
        enCours: 0,
        caLivre: 0,
        tauxLivraison: null,
        level: 'nouveau',
      };
      map.set(key, c);
    }
    const status = String(o.delivery_status ?? '');
    c.total++;
    if (status === 'livre') {
      c.livre++;
      c.caLivre += Number(o.cod) || 0;
    } else if (REFUSED.has(status)) c.refus++;
    else if (ACTIVE.has(status)) c.enCours++;
  }
  for (const c of map.values()) {
    const termine = c.livre + c.refus;
    c.tauxLivraison = termine > 0 ? Math.round((c.livre / termine) * 100) : null;
    c.level = riskLevel(c.livre, c.refus);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

/**
 * Commandes ENCORE EN COURS dont le client est « à risque » : celles sur
 * lesquelles le marchand peut encore agir (appeler, confirmer, annuler).
 */
export function activeOrdersOfRiskyClients(
  rows: ClientOrderRow[],
  stats: ClientStats[]
): ActiveRiskyOrder[] {
  const risky = new Map(stats.filter((c) => c.level === 'risque').map((c) => [c.key, c]));
  const out: ActiveRiskyOrder[] = [];
  for (const o of rows) {
    const status = String(o.delivery_status ?? '');
    if (!ACTIVE.has(status)) continue;
    const c = risky.get(clientKey(o));
    if (!c) continue;
    out.push({
      tracking_number: String(o.tracking_number ?? ''),
      client: String(o.customer_name ?? ''),
      whatsapp: String(o.customer_whatsapp ?? ''),
      wilaya: String(o.wilaya ?? ''),
      product_name: String(o.product_name ?? ''),
      cod: Number(o.cod) || 0,
      delivery_status: status,
      refus: c.refus,
      livre: c.livre,
    });
  }
  return out;
}
