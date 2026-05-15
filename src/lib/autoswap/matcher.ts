// Matcher AutoSwap : logique pure (sans I/O).
// Reçoit deux listes de colis ZRExpress et produit des propositions de swap triées
// par confiance puis par proximité géographique.

import type {
  ZRParcel,
  NormalizedParcel,
  MatchProposal,
  Confidence,
} from './types';

// Parse "Nom Produit( SKU )( Couleur , Taille )XN : UUID - qty"
// Tolérant aux variations d'espaces et aux variants partiels.
interface ParsedDescription {
  productName: string;
  productSkuCode: string | null;
  variantColor: string | null;
  variantSize: string | null;
  productVariantId: string | null;
}

const DESCRIPTION_REGEX =
  /^(?<name>[^(]+?)\(\s*(?<sku>[^)]+?)\s*\)\s*(?:\(\s*(?<color>[^,)]+?)\s*(?:,\s*(?<size>[^)]+?)\s*)?\))?[^:]*(?::\s*(?<uuid>[a-f0-9-]{36}))?/i;

const UUID_REGEX = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

export function parseProductsDescription(raw: string): ParsedDescription {
  const desc = (raw || '').trim();
  if (!desc) {
    return { productName: '', productSkuCode: null, variantColor: null, variantSize: null, productVariantId: null };
  }

  const match = desc.match(DESCRIPTION_REGEX);
  // Fallback : extraction UUID seule si la regex principale échoue.
  const uuidFallback = desc.match(UUID_REGEX)?.[0] ?? null;

  if (!match?.groups) {
    return {
      productName: desc.split('(')[0]?.trim() || desc,
      productSkuCode: null,
      variantColor: null,
      variantSize: null,
      productVariantId: uuidFallback,
    };
  }

  return {
    productName: match.groups.name?.trim() || '',
    productSkuCode: normalizeKey(match.groups.sku),
    variantColor: match.groups.color ? normalizeKey(match.groups.color) : null,
    variantSize: match.groups.size ? normalizeKey(match.groups.size) : null,
    productVariantId: match.groups.uuid || uuidFallback,
  };
}

// Minuscules + sans accents + espaces normalisés. Utile pour comparer SKU/couleurs/tailles.
function normalizeKey(raw: string | undefined | null): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeParcel(p: ZRParcel): NormalizedParcel {
  const parsed = parseProductsDescription(p.productsDescription || '');
  const customerPhone =
    p.customer?.phone?.number1 ||
    p.customer?.phone?.number2 ||
    p.customer?.phone?.number3 ||
    '';

  return {
    id: p.id || '',
    trackingNumber: p.trackingNumber || '',
    externalId: p.externalId || '',
    productVariantId: parsed.productVariantId,
    productSkuCode: parsed.productSkuCode,
    productName: parsed.productName,
    variantColor: parsed.variantColor,
    variantSize: parsed.variantSize,
    rawDescription: p.productsDescription || '',
    cityTerritoryId: p.deliveryAddress?.cityTerritoryId || '',
    wilayaCode: Number(p.deliveryAddress?.cityTerritoryCode ?? 0),
    cityName: p.deliveryAddress?.city || '',
    district: p.deliveryAddress?.district || '',
    customerName: p.customer?.name || '',
    customerPhone,
    amount: Number(p.amount ?? 0),
    returnPrice: Number(p.returnPrice ?? 0),
    deliveryPrice: Number(p.deliveryPrice ?? 0),
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

// Vérifie qu'une commande est en attente d'expédition (cible candidate).
// `appel_confirmation` (URL de l'UI ZRExpress) n'existe pas côté API : les vrais
// états correspondants sont `commande_recue` et `pret_a_expedier`. On garde
// `appel_confirmation` par défense au cas où ZRExpress l'introduirait plus tard.
const TARGET_STATES = new Set(['commande_recue', 'pret_a_expedier', 'appel_confirmation']);

export function isTarget(p: NormalizedParcel): boolean {
  return TARGET_STATES.has(p.stateName);
}

// Détermine le niveau de confiance d'un match produit.
// Renvoie null si aucun critère n'est rempli.
function productConfidence(a: NormalizedParcel, b: NormalizedParcel): Confidence | null {
  // EXACT : même UUID de variante
  if (a.productVariantId && b.productVariantId && a.productVariantId === b.productVariantId) {
    return 'EXACT';
  }
  // STRONG : même SKU + même couleur + même taille (tous présents)
  if (
    a.productSkuCode &&
    b.productSkuCode &&
    a.productSkuCode === b.productSkuCode &&
    a.variantColor &&
    b.variantColor &&
    a.variantColor === b.variantColor &&
    a.variantSize &&
    b.variantSize &&
    a.variantSize === b.variantSize
  ) {
    return 'STRONG';
  }
  // WEAK : même SKU uniquement (variante différente ou inconnue)
  if (a.productSkuCode && b.productSkuCode && a.productSkuCode === b.productSkuCode) {
    return 'WEAK';
  }
  return null;
}

// Score d'une paire matchée. Plus haut = meilleur.
function scorePair(swappable: NormalizedParcel, target: NormalizedParcel, confidence: Confidence): {
  score: number;
  sameCity: boolean;
  sameWilaya: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Base : niveau de confiance produit
  const base = confidence === 'EXACT' ? 100 : confidence === 'STRONG' ? 90 : 60;

  const sameCity = !!swappable.cityTerritoryId && swappable.cityTerritoryId === target.cityTerritoryId;
  const sameWilaya = swappable.wilayaCode > 0 && swappable.wilayaCode === target.wilayaCode;

  let geoBonus = 0;
  if (sameCity) geoBonus = 30;
  else if (sameWilaya) geoBonus = 10;

  // Bonus prix proche (<10% de différence)
  let priceBonus = 0;
  if (swappable.amount > 0 && target.amount > 0) {
    const diff = Math.abs(swappable.amount - target.amount) / swappable.amount;
    if (diff < 0.1) priceBonus = 10;
    else if (diff > 0.3) warnings.push(`Écart de prix élevé : ${swappable.amount.toFixed(0)} → ${target.amount.toFixed(0)} DA`);
  }

  // Avertissements
  if (confidence === 'WEAK') {
    warnings.push('Variante non confirmée — vérifier taille/couleur manuellement');
  }
  if (!sameCity && !sameWilaya) {
    warnings.push(`Wilaya différente : ${swappable.cityName} → ${target.cityName}`);
  }
  if (swappable.swap.count > 0) {
    warnings.push(`Colis déjà swappé ${swappable.swap.count} fois`);
  }

  return {
    score: base + geoBonus + priceBonus,
    sameCity,
    sameWilaya,
    warnings,
  };
}

// Économies estimées : retour évité + nouvelle livraison évitée − frais de swap ZRExpress.
function estimateSavings(swappable: NormalizedParcel, target: NormalizedParcel, sameCity: boolean): number {
  const swapFee = sameCity ? swappable.swap.sameCityPrice : swappable.swap.differentCityPrice;
  return Math.max(0, swappable.returnPrice + target.deliveryPrice - swapFee);
}

function toProposalSide(p: NormalizedParcel) {
  return {
    id: p.id,
    tracking: p.trackingNumber,
    customer: p.customerName,
    customerPhone: p.customerPhone,
    wilaya: String(p.wilayaCode || ''),
    city: p.cityName,
    product: p.productName,
    variantColor: p.variantColor,
    variantSize: p.variantSize,
    amount: p.amount,
  };
}

// Point d'entrée principal du matcher.
// Reçoit les listes brutes ZRExpress, normalise, filtre, matche, score, et résout
// l'affectation 1-to-1 par algorithme glouton (meilleur score d'abord).
export function matchSwappables(allParcels: ZRParcel[]): MatchProposal[] {
  const normalized = allParcels.map(normalizeParcel);
  const swappables = normalized.filter(isSwappable);
  const targets = normalized.filter(isTarget);

  // Génère toutes les paires candidates (cartésien filtré).
  type Candidate = { s: NormalizedParcel; t: NormalizedParcel; confidence: Confidence; score: number; sameCity: boolean; sameWilaya: boolean; warnings: string[] };
  const candidates: Candidate[] = [];

  for (const s of swappables) {
    for (const t of targets) {
      const confidence = productConfidence(s, t);
      if (!confidence) continue;
      const { score, sameCity, sameWilaya, warnings } = scorePair(s, t, confidence);
      candidates.push({ s, t, confidence, score, sameCity, sameWilaya, warnings });
    }
  }

  // Tri par score desc — affectation gloutonne 1-to-1.
  candidates.sort((a, b) => b.score - a.score);

  const usedSources = new Set<string>();
  const usedTargets = new Set<string>();
  const proposals: MatchProposal[] = [];

  for (const c of candidates) {
    if (usedSources.has(c.s.id) || usedTargets.has(c.t.id)) continue;
    usedSources.add(c.s.id);
    usedTargets.add(c.t.id);

    proposals.push({
      swappable: toProposalSide(c.s),
      target: toProposalSide(c.t),
      confidence: c.confidence,
      score: c.score,
      same_city: c.sameCity,
      same_wilaya: c.sameWilaya,
      estimated_savings: estimateSavings(c.s, c.t, c.sameCity),
      warnings: c.warnings,
    });
  }

  return proposals;
}

// Helpers exposés pour les routes API (statistiques de scan).
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
