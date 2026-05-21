// Matcher AutoSwap : logique pure (sans I/O).
// Reçoit deux listes de colis ZRExpress et produit des propositions de swap triées
// par confiance puis par proximité géographique.
//
// Parser : approche par VOCABULAIRE (pas regex stricte). Les descriptions ZRExpress
// sont très inconsistentes (virgules, slashes, ordre inversé, mots parasites, free
// text). On scanne tous les tokens et on classifie chacun comme couleur ou taille
// via des listes connues. Ça permet d'extraire la variante même quand le format
// n'a aucune structure.

import type {
  ZRParcel,
  NormalizedParcel,
  MatchProposal,
  Confidence,
} from './types';

// ── Vocabulaire ─────────────────────────────────────────────────────────────
// Couleurs FR + EN. La valeur est le synonyme canonique (noir/noire → noir,
// bleu/blue/bleue → bleu). Permet de matcher "blue" côté source avec "bleu" côté
// target sans manipulation manuelle.
const COLOR_ALIASES: Record<string, string> = {
  noir: 'noir', noire: 'noir', black: 'noir',
  blanc: 'blanc', blanche: 'blanc', white: 'blanc',
  beige: 'beige', creme: 'beige', cream: 'beige',
  bleu: 'bleu', bleue: 'bleu', blue: 'bleu', azur: 'bleu',
  vert: 'vert', verte: 'vert', green: 'vert',
  gris: 'gris', grise: 'gris', grey: 'gris', gray: 'gris',
  marron: 'marron', brown: 'marron', chocolat: 'marron',
  rouge: 'rouge', red: 'rouge',
  jaune: 'jaune', yellow: 'jaune',
  rose: 'rose', pink: 'rose',
  violet: 'violet', mauve: 'violet', purple: 'violet',
  orange: 'orange',
  kaki: 'kaki', khaki: 'kaki', olive: 'kaki',
  turquoise: 'turquoise',
};

// Tailles standards alpha. Les tailles numériques (38, 40, 42…) sont détectées
// par regex `^\d{2,3}$`.
const ALPHA_SIZES = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', 'xxxxl', '2xl', '3xl', '4xl', '5xl']);
const NUMERIC_SIZE_RE = /^\d{2,3}$/;

// Mots parasites à ignorer (n'apportent ni couleur ni taille).
const JUNK_TOKENS = new Set(['taille', 'size', 'couleur', 'color', 'pour', 'avec', 'et', 'and', 'or', 'ou', 'de', 'du', 'des', 'le', 'la', 'les']);

// ── Parsing ─────────────────────────────────────────────────────────────────

interface ParsedDescription {
  productName: string;
  productSkuCode: string | null;
  variantColors: string[];   // toutes les couleurs détectées (multi-variants ok)
  variantSizes: string[];    // toutes les tailles détectées
  productVariantId: string | null;
  quantity: number;          // nombre total d'articles dans le colis (extrait de " - N" en fin)
}

// Extrait la quantité totale du colis depuis productsDescription.
// Format observé : "Produit( SKU )( variantes )XN : uuid - QTY"
// Le " - QTY" en toute fin est la quantité totale.
// Ex : "pantalon lain( plin )( M noir , Blanc , Beige , Blue ) :  - 4" → 4
// Ex : "Pontalon lain sport beige M  :  - 1" → 1
function extractQuantity(raw: string): number {
  const m = raw.match(/-\s*(\d+)\s*$/);
  return m ? Math.max(1, parseInt(m[1], 10)) : 1;
}

const UUID_REGEX = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

// Extrait nom + SKU depuis "Nom Produit( SKU )" en tête de description.
// Tolérant : si pas de parenthèses, le nom est tout le préfixe avant " :" ou ":".
function extractNameAndSku(raw: string): { name: string; sku: string | null } {
  // [1] = nom produit, [2] = SKU. Positional groups pour compat ES2017.
  const m = raw.match(/^([^(:]+?)\(\s*([^)]+?)\s*\)/);
  if (m) {
    return { name: m[1].trim(), sku: cleanToken(m[2]) };
  }
  // Pas de parenthèses → free text. Prend tout avant " :" ou la chaîne entière.
  const beforeColon = raw.split(/\s+:|:/)[0]?.trim() || raw.trim();
  return { name: beforeColon, sku: null };
}

// Normalisation d'un token : minuscules, sans accents, sans accolades/parasites.
function cleanToken(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[{}\[\]"]/g, '')
    .trim();
}

// Découpe une chaîne en tokens : sépare sur tout sauf lettres et chiffres.
function tokenize(s: string): string[] {
  return s
    .split(/[\s,/()\\\-]+/)
    .map(t => cleanToken(t))
    .filter(t => t.length > 0 && !JUNK_TOKENS.has(t));
}

function classifyToken(tok: string): { type: 'color' | 'size'; canonical: string } | null {
  if (COLOR_ALIASES[tok]) return { type: 'color', canonical: COLOR_ALIASES[tok] };
  if (ALPHA_SIZES.has(tok)) return { type: 'size', canonical: tok.toUpperCase() };
  if (NUMERIC_SIZE_RE.test(tok)) return { type: 'size', canonical: tok };
  return null;
}

export function parseProductsDescription(raw: string): ParsedDescription {
  const desc = (raw || '').trim();
  if (!desc) {
    return { productName: '', productSkuCode: null, variantColors: [], variantSizes: [], productVariantId: null, quantity: 1 };
  }

  const { name, sku } = extractNameAndSku(desc);

  // Scanne TOUS les tokens de la description (pas seulement ceux dans les parens).
  // Permet de capter "Pontalon lain sport beige M" (free text) aussi bien que
  // "( Beige, XL )" structuré.
  const colors = new Set<string>();
  const sizes = new Set<string>();
  for (const tok of tokenize(desc)) {
    // Saute le SKU lui-même pour éviter de le confondre avec une couleur/taille
    if (sku && tok === sku) continue;
    const cls = classifyToken(tok);
    if (cls?.type === 'color') colors.add(cls.canonical);
    else if (cls?.type === 'size') sizes.add(cls.canonical);
  }

  return {
    productName: name,
    productSkuCode: sku,
    variantColors: [...colors].sort(),
    variantSizes: [...sizes].sort(),
    productVariantId: desc.match(UUID_REGEX)?.[0] || null,
    quantity: extractQuantity(desc),
  };
}

// Fingerprint nom produit : normalise pour matcher 2 produits sans SKU.
// "Pontalon lain sport" et "pantalon lain sport" → "pantalon lain sport".
function nameFingerprint(name: string): string {
  return tokenize(name)
    .filter(t => !COLOR_ALIASES[t] && !ALPHA_SIZES.has(t) && !NUMERIC_SIZE_RE.test(t))
    .map(t => t.replace(/^p[oa]ntalon$/, 'pantalon')) // correction faute fréquente "pontalon"
    .sort()
    .join(' ');
}

export function normalizeParcel(p: ZRParcel): NormalizedParcel {
  const parsed = parseProductsDescription(p.productsDescription || '');
  const phones = {
    number1: p.customer?.phone?.number1,
    number2: p.customer?.phone?.number2,
    number3: p.customer?.phone?.number3,
  };
  const customerPhone = phones.number1 || phones.number2 || phones.number3 || '';

  return {
    id: p.id || '',
    trackingNumber: p.trackingNumber || '',
    externalId: p.externalId || '',
    productVariantId: parsed.productVariantId,
    productSkuCode: parsed.productSkuCode,
    productName: parsed.productName,
    productNameFingerprint: nameFingerprint(parsed.productName),
    variantColors: parsed.variantColors,
    variantSizes: parsed.variantSizes,
    quantity: parsed.quantity,
    rawDescription: p.productsDescription || '',
    cityTerritoryId: p.deliveryAddress?.cityTerritoryId || '',
    wilayaCode: Number(p.deliveryAddress?.cityTerritoryCode ?? 0),
    cityName: p.deliveryAddress?.city || '',
    district: p.deliveryAddress?.district || '',
    customerName: p.customer?.name || '',
    customerId: p.customer?.customerId || null,
    customerPhone,
    customerPhones: phones,
    amount: Number(p.amount ?? 0),
    returnPrice: Number(p.returnPrice ?? 0),
    deliveryPrice: Number(p.deliveryPrice ?? 0),
    fullAddress: {
      street: p.deliveryAddress?.street ?? null,
      city: p.deliveryAddress?.city ?? null,
      cityTerritoryId: p.deliveryAddress?.cityTerritoryId || '',
      district: p.deliveryAddress?.district ?? null,
      districtTerritoryId: p.deliveryAddress?.districtTerritoryId || '',
      postalCode: p.deliveryAddress?.postalCode ?? null,
      country: p.deliveryAddress?.country ?? null,
      coordinates: p.deliveryAddress?.coordinates,
    },
    hubId: p.deliveryAddress?.hubId || null,
    deliveryType: p.deliveryType ?? null,
    stateName: p.state?.name || '',
    swap: {
      isEligibleForSwap: !!p.swap?.isEligibleForSwap,
      swappedAt: p.swap?.swappedAt ?? null,
      sameCityPrice: Number(p.swap?.sameCityPrice ?? 0),
      differentCityPrice: Number(p.swap?.differentCityPrice ?? 0),
      count: Number(p.swap?.count ?? 0),
    },
  };
}

// ── Règles métier ZRExpress (source : note officielle) ──────────────────────

// Un colis ne peut être swappé que 2 fois maximum.
const MAX_SWAP_COUNT = 2;

// Wilayas du Sud algérien qui ne peuvent swapper que dans la même wilaya
// (interdiction cross-wilaya pour ces régions). Codes officiels ZRExpress.
const RESTRICTED_WILAYAS = new Set<number>([
  1,  // Adrar
  8,  // Bechar
  11, // Tamanrasset
  30, // Ouargla
  32, // El Bayadh
  45, // Naama
  49, // Timimoun
  52, // Beni Abbes
  53, // In Salah
  54, // In Guezzam
  58, // El Menia
]);

// Vérifie qu'un colis est éligible côté source (swap possible).
//
// L'API ZRExpress positionne `isEligibleForSwap=true` uniquement pour les états
// « Ne répond pas 3 » ou « Commande annulée » — on délègue ce check à l'API.
//
// `swap.count` est le nombre de swaps déjà effectués sur ce colis. ZRExpress
// limite à 2 swaps par colis ; on inclut donc count=0 (jamais swappé) ET
// count=1 (swappé une fois, encore éligible pour un 2e swap). On NE filtre PAS
// sur `swappedAt` car ce champ est rempli après le 1er swap mais le colis reste
// swappable jusqu'à count=2 (vérifié sur 8 colis count=1 du pool live).
export function isSwappable(p: NormalizedParcel): boolean {
  return p.swap.isEligibleForSwap === true
    && p.swap.count < MAX_SWAP_COUNT;
}

// `appel_confirmation` (URL de l'UI ZRExpress) n'existe pas côté API : les vrais
// états correspondants sont `commande_recue` et `pret_a_expedier`.
const TARGET_STATES = new Set(['commande_recue', 'pret_a_expedier', 'appel_confirmation']);

export function isTarget(p: NormalizedParcel): boolean {
  return TARGET_STATES.has(p.stateName);
}

// Vérifie la contrainte géographique du swap selon la règle ZRExpress :
// si le colis source est dans une wilaya du Sud (RESTRICTED_WILAYAS),
// la cible doit être dans la MÊME wilaya. Sinon swap interdit.
function isGeoSwapAllowed(source: NormalizedParcel, target: NormalizedParcel): boolean {
  if (RESTRICTED_WILAYAS.has(source.wilayaCode)) {
    return source.wilayaCode === target.wilayaCode;
  }
  return true;
}

// ── Tailles équivalentes par produit ────────────────────────────────────────
// Configuration métier : certaines tailles sont interchangeables au sein d'un
// même produit (ex : pour le hijab miral, les tailles 40/42/44 sont équivalentes).
//
// MULTI-TENANT : chaque utilisateur définit ses propres équivalences via la table
// autoswap_size_equivalences. Le matcher reçoit le dictionnaire en paramètre via
// matchSwappables(parcels, { sizeEquivalences }). Cette constante n'est plus
// utilisée par défaut — elle sert juste de modèle exportable pour le bouton
// « Importer les templates par défaut » dans la UI.
//
// IMPORTANT : les tailles à l'intérieur d'un groupe doivent être identiques au
// format retourné par classifyToken() — donc upper-case pour les alpha, et la
// chaîne brute pour les numériques.
export const DEFAULT_SIZE_EQUIVALENCES: Record<string, string[][]> = {
  mrl: [['40', '42', '44'], ['46', '48', '50']],
  'hijab miral': [['40', '42', '44'], ['46', '48', '50']],
  ayl: [['40', '42', '44'], ['46', '48', '50']],
  'ayla abaya': [['40', '42', '44'], ['46', '48', '50']],
  spt: [['S', 'M'], ['L', 'XL'], ['XXL', 'XXXL']],
  'pantalon lain sport': [['S', 'M'], ['L', 'XL'], ['XXL', 'XXXL']],
  plin: [['S', 'M'], ['L', 'XL'], ['XXL', 'XXXL']],
  'pantalon lain': [['S', 'M'], ['L', 'XL'], ['XXL', 'XXXL']],
};

// Renvoie le représentant canonique d'une taille pour un produit donné selon
// la table d'équivalences fournie (celle du user courant en runtime).
function normalizeSize(
  productKey: string | null,
  size: string,
  table: Record<string, string[][]>
): string {
  if (!productKey) return size;
  const groups = table[productKey];
  if (!groups) return size;
  for (const group of groups) {
    if (group.includes(size)) return group[0];
  }
  return size;
}

// Pour un colis donné, retourne la clé produit la plus précise disponible
// (SKU si présent, sinon nameFingerprint). Sert au lookup des équivalences.
function getProductKey(
  p: NormalizedParcel,
  table: Record<string, string[][]>
): string | null {
  if (p.productSkuCode && table[p.productSkuCode]) return p.productSkuCode;
  if (p.productNameFingerprint && table[p.productNameFingerprint]) return p.productNameFingerprint;
  return null;
}

// ── Matching ────────────────────────────────────────────────────────────────

// Égalité ensembliste : a et b contiennent exactement les mêmes éléments
// (ordre ignoré, doublons ignorés). Utilisé pour exiger que TOUTES les
// couleurs/tailles d'un colis multi-variants correspondent à la cible.
function setsEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every(x => set.has(x));
}

// Détermine le niveau de confiance d'un match produit.
// Mode STRICT : un swap n'est proposé que si :
//   - même produit (SKU ou fingerprint du nom)
//   - même quantité (contenu du colis identique)
//   - même ENSEMBLE de couleurs (pas juste intersection : pour un colis
//     multi-variants à 2 couleurs [noir, vert], la cible doit aussi avoir
//     EXACTEMENT [noir, vert] — pas seulement [noir] ou [noir, blanc])
//   - même ENSEMBLE de tailles
//
// La wilaya n'est PAS un critère de filtrage (juste un bonus de score).
//
// EXACT  → même UUID variante (rare en pratique, bypass les checks de set)
// STRONG → même produit + même quantité + sets de couleurs et tailles identiques
function productConfidence(
  a: NormalizedParcel,
  b: NormalizedParcel,
  sizeEquivalences: Record<string, string[][]>,
): {
  confidence: Confidence;
  sharedColors: string[];
  sharedSizes: string[];
} | null {
  // EXACT par UUID — bypass le check ensembliste, mais la règle géographique
  // ZRExpress reste obligatoire (contrainte du transporteur).
  if (a.productVariantId && b.productVariantId && a.productVariantId === b.productVariantId) {
    if (!isGeoSwapAllowed(a, b)) return null;
    return {
      confidence: 'EXACT',
      sharedColors: a.variantColors,
      sharedSizes: a.variantSizes,
    };
  }

  // Même produit : SKU identique OU (les deux sans SKU mais même fingerprint nom)
  const sameSku = !!a.productSkuCode && a.productSkuCode === b.productSkuCode;
  const sameName = !a.productSkuCode && !b.productSkuCode &&
                   !!a.productNameFingerprint &&
                   a.productNameFingerprint === b.productNameFingerprint;

  if (!sameSku && !sameName) return null;

  // Règle ZRExpress : certaines wilayas du Sud ne peuvent swap qu'en interne.
  // Si la source est dans une wilaya restreinte, la cible doit y être aussi.
  if (!isGeoSwapAllowed(a, b)) return null;

  // Quantité identique (contenu du colis = ce que veut la cible).
  if (a.quantity !== b.quantity) return null;

  // Garde-fou : il faut avoir détecté au moins une couleur ET une taille
  // des 2 côtés. Sans info, on ne peut pas garantir la correspondance.
  if (a.variantColors.length === 0 || b.variantColors.length === 0) return null;
  if (a.variantSizes.length === 0 || b.variantSizes.length === 0) return null;

  // Sets identiques sur les couleurs.
  if (!setsEqual(a.variantColors, b.variantColors)) return null;

  // Tailles : on applique d'abord la table d'équivalence DU USER COURANT
  // (ex : pour hijab miral, 40/42/44 sont interchangeables) avant de comparer.
  // Si la table connaît le produit, les tailles sont rabattues sur le
  // représentant de leur groupe — sinon comparaison stricte.
  const productKey = getProductKey(a, sizeEquivalences) || getProductKey(b, sizeEquivalences);
  const aSizesNorm = a.variantSizes.map(s => normalizeSize(productKey, s, sizeEquivalences));
  const bSizesNorm = b.variantSizes.map(s => normalizeSize(productKey, s, sizeEquivalences));
  if (!setsEqual(aSizesNorm, bSizesNorm)) return null;

  return {
    confidence: 'STRONG',
    sharedColors: a.variantColors,
    sharedSizes: a.variantSizes, // on garde l'affichage des tailles réelles (pas le canonique)
  };
}

interface MatchResult {
  confidence: Confidence;
  sharedColors: string[];
  sharedSizes: string[];
  score: number;
  sameCity: boolean;
  sameWilaya: boolean;
  warnings: string[];
}

function scorePair(s: NormalizedParcel, t: NormalizedParcel, match: ReturnType<typeof productConfidence>): MatchResult {
  if (!match) throw new Error('scorePair called without match');
  const warnings: string[] = [];
  const base = match.confidence === 'EXACT' ? 100 : match.confidence === 'STRONG' ? 90 : 60;

  const sameCity = !!s.cityTerritoryId && s.cityTerritoryId === t.cityTerritoryId;
  const sameWilaya = s.wilayaCode > 0 && s.wilayaCode === t.wilayaCode;

  let geoBonus = 0;
  if (sameCity) geoBonus = 30;
  else if (sameWilaya) geoBonus = 10;

  let priceBonus = 0;
  if (s.amount > 0 && t.amount > 0) {
    const diff = Math.abs(s.amount - t.amount) / s.amount;
    if (diff < 0.1) priceBonus = 10;
    else if (diff > 0.3) warnings.push(`Écart de prix : ${s.amount.toFixed(0)} → ${t.amount.toFixed(0)} DA`);
  }

  // En mode strict, plus de warning variante (impossible que ça arrive).
  // On garde uniquement les infos contextuelles non bloquantes.
  if (!sameCity && !sameWilaya) {
    warnings.push(`Wilaya différente : ${s.cityName} → ${t.cityName}`);
  }
  if (s.swap.count > 0) {
    warnings.push(`Colis déjà swappé ${s.swap.count} fois`);
  }

  return {
    confidence: match.confidence,
    sharedColors: match.sharedColors,
    sharedSizes: match.sharedSizes,
    score: base + geoBonus + priceBonus,
    sameCity,
    sameWilaya,
    warnings,
  };
}

function estimateSavings(s: NormalizedParcel, t: NormalizedParcel, sameCity: boolean): number {
  const swapFee = sameCity ? s.swap.sameCityPrice : s.swap.differentCityPrice;
  return Math.max(0, s.returnPrice + t.deliveryPrice - swapFee);
}

// Formate les couleurs/tailles partagées pour affichage UI.
// Si une seule couleur/taille partagée → affiche celle-là (cas single-variant).
// Sinon → joint avec /
function formatMatched(values: string[]): string | null {
  if (values.length === 0) return null;
  return values.join(' / ');
}

function toSwappableSide(p: NormalizedParcel, sharedColors: string[], sharedSizes: string[]) {
  return {
    id: p.id,
    tracking: p.trackingNumber,
    customer: p.customerName,
    wilaya: String(p.wilayaCode || ''),
    city: p.cityName,
    product: p.productName,
    variantColor: formatMatched(sharedColors) || formatMatched(p.variantColors),
    variantSize: formatMatched(sharedSizes) || formatMatched(p.variantSizes),
    quantity: p.quantity,
    amount: p.amount,
  };
}

function toTargetSide(p: NormalizedParcel, sharedColors: string[], sharedSizes: string[]) {
  return {
    id: p.id,
    tracking: p.trackingNumber,
    customer: p.customerName,
    customerPhone: p.customerPhone,
    wilaya: String(p.wilayaCode || ''),
    city: p.cityName,
    product: p.productName,
    variantColor: formatMatched(sharedColors) || formatMatched(p.variantColors),
    variantSize: formatMatched(sharedSizes) || formatMatched(p.variantSizes),
    quantity: p.quantity,
    amount: p.amount,
    // Tout ce dont execute/route.ts a besoin pour construire le payload de swap.
    // Ces champs ne sont pas affichés dans la UI mais sont préservés à travers le round-trip.
    swapPayload: {
      phone: p.customerPhones,
      deliveryType: p.deliveryType,
      deliveryAddress: p.fullAddress,
      hubId: p.hubId,
      customerId: p.customerId,
    },
  };
}

export interface MatchOptions {
  // Table d'équivalences de tailles spécifique à l'utilisateur courant.
  // Format : { 'mrl': [['40','42','44'],['46','48','50']], ... }
  // Si non fourni → comparaison stricte des tailles (aucune équivalence).
  sizeEquivalences?: Record<string, string[][]>;
}

export function matchSwappables(
  allParcels: ZRParcel[],
  options: MatchOptions = {},
): MatchProposal[] {
  const equiv = options.sizeEquivalences ?? {};
  const normalized = allParcels.map(normalizeParcel);
  const swappables = normalized.filter(isSwappable);
  const targets = normalized.filter(isTarget);

  type Candidate = { s: NormalizedParcel; t: NormalizedParcel; result: MatchResult };
  const candidates: Candidate[] = [];

  for (const s of swappables) {
    for (const t of targets) {
      const match = productConfidence(s, t, equiv);
      if (!match) continue;
      candidates.push({ s, t, result: scorePair(s, t, match) });
    }
  }

  // Tri par score desc — affectation gloutonne 1-to-1.
  candidates.sort((a, b) => b.result.score - a.result.score);

  const usedSources = new Set<string>();
  const usedTargets = new Set<string>();
  const proposals: MatchProposal[] = [];

  for (const c of candidates) {
    if (usedSources.has(c.s.id) || usedTargets.has(c.t.id)) continue;
    usedSources.add(c.s.id);
    usedTargets.add(c.t.id);

    proposals.push({
      swappable: toSwappableSide(c.s, c.result.sharedColors, c.result.sharedSizes),
      target: toTargetSide(c.t, c.result.sharedColors, c.result.sharedSizes),
      confidence: c.result.confidence,
      score: c.result.score,
      same_city: c.result.sameCity,
      same_wilaya: c.result.sameWilaya,
      estimated_savings: estimateSavings(c.s, c.t, c.result.sameCity),
      warnings: c.result.warnings,
    });
  }

  return proposals;
}

export function splitSourcesAndTargets(allParcels: ZRParcel[]): {
  swappables: NormalizedParcel[];
  targets: NormalizedParcel[];
} {
  const normalized = allParcels.map(normalizeParcel);
  return {
    swappables: normalized.filter(isSwappable),
    targets: normalized.filter(isTarget),
  };
}
