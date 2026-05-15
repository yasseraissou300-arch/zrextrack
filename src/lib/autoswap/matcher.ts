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
    return { productName: '', productSkuCode: null, variantColors: [], variantSizes: [], productVariantId: null };
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

// Vérifie qu'un colis est éligible côté source (swap possible).
export function isSwappable(p: NormalizedParcel): boolean {
  return p.swap.isEligibleForSwap === true && p.swap.swappedAt === null;
}

// `appel_confirmation` (URL de l'UI ZRExpress) n'existe pas côté API : les vrais
// états correspondants sont `commande_recue` et `pret_a_expedier`.
const TARGET_STATES = new Set(['commande_recue', 'pret_a_expedier', 'appel_confirmation']);

export function isTarget(p: NormalizedParcel): boolean {
  return TARGET_STATES.has(p.stateName);
}

// ── Matching ────────────────────────────────────────────────────────────────

function intersection<T>(a: T[], b: T[]): T[] {
  const set = new Set(b);
  return a.filter(x => set.has(x));
}

// Détermine le niveau de confiance d'un match produit.
// Mode STRICT : un swap n'est proposé que si produit + couleur + taille sont identiques.
// Tout ce qui diffère sur l'un de ces 3 critères → null (pas de proposition).
// La wilaya n'est PAS un critère de filtrage (juste un bonus de score plus tard).
//
// EXACT  → même UUID variante (cas idéal, rare en pratique)
// STRONG → même produit (SKU ou nom-fingerprint) + couleur commune + taille commune
//
// Pas de tier WEAK exposé : si variant manquant d'un côté ou variantes contradictoires,
// on rejette le match plutôt que de demander à l'humain de vérifier.
function productConfidence(a: NormalizedParcel, b: NormalizedParcel): {
  confidence: Confidence;
  sharedColors: string[];
  sharedSizes: string[];
} | null {
  // EXACT par UUID — seule façon de bypasser le check couleur/taille
  // car l'UUID encode déjà la variante exacte.
  if (a.productVariantId && b.productVariantId && a.productVariantId === b.productVariantId) {
    return {
      confidence: 'EXACT',
      sharedColors: intersection(a.variantColors, b.variantColors),
      sharedSizes: intersection(a.variantSizes, b.variantSizes),
    };
  }

  // Même produit : SKU identique OU (les deux sans SKU mais même fingerprint nom)
  const sameSku = !!a.productSkuCode && a.productSkuCode === b.productSkuCode;
  const sameName = !a.productSkuCode && !b.productSkuCode &&
                   !!a.productNameFingerprint &&
                   a.productNameFingerprint === b.productNameFingerprint;

  if (!sameSku && !sameName) return null;

  const sharedColors = intersection(a.variantColors, b.variantColors);
  const sharedSizes = intersection(a.variantSizes, b.variantSizes);

  // Mode STRICT : couleur ET taille doivent être identiques des 2 côtés.
  if (sharedColors.length > 0 && sharedSizes.length > 0) {
    return { confidence: 'STRONG', sharedColors, sharedSizes };
  }

  // Toute autre situation = pas de proposition (variant manquant, couleur OU taille différente).
  return null;
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

export function matchSwappables(allParcels: ZRParcel[]): MatchProposal[] {
  const normalized = allParcels.map(normalizeParcel);
  const swappables = normalized.filter(isSwappable);
  const targets = normalized.filter(isTarget);

  type Candidate = { s: NormalizedParcel; t: NormalizedParcel; result: MatchResult };
  const candidates: Candidate[] = [];

  for (const s of swappables) {
    for (const t of targets) {
      const match = productConfidence(s, t);
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
