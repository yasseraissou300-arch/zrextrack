// Validation serveur de la sortie du modèle — LLM output ≠ trusted input.
//
// Le webhook WhatsApp extrait un bloc <data>{…}</data> de la réponse Gemini,
// le fusionne dans la session puis, une fois « complet », l'envoie dans le
// Google Sheet du marchand et notifie son WhatsApp admin. Avant ce module :
//   - aucune validation : le téléphone, la wilaya, le produit étaient ceux que
//     le modèle écrivait (le prompt « demande » un 05/06/07, rien ne le vérifie ;
//     un client peut aussi dicter le bloc au modèle — injection de prompt) ;
//   - « complet » = le bloc contient ≥ 3 clés, N'IMPORTE LESQUELLES ;
//   - le prompt SAV produit 2 clés (reclamation, commande) → jamais « complet »
//     → aucune réclamation n'atteignait le Sheet ni l'admin ;
//   - les valeurs partaient telles quelles dans Google Sheets : « =IMPORTXML(…) »
//     devient une formule (injection de formule).

import { WILAYA_MAP, normalizeWilaya } from './classifiers';

/** Champs obligatoires par modèle de prompt PAR DÉFAUT. null = jamais « complet ». */
export const REQUIRED_FIELDS: Record<string, string[] | null> = {
  auto_confirmation: ['nom', 'telephone', 'wilaya', 'produit'],
  sav: ['reclamation', 'commande'],
  tracking: null, // consultation : rien à pousser dans le Sheet
};

/** Ancienne règle, conservée pour les prompts PERSONNALISÉS (clés libres). */
export const LEGACY_MIN_KEYS = 3;

const MAX_KEYS = 20;
const MAX_VALUE_LENGTH = 300;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/i;

const CANONICAL_WILAYAS = new Set(Object.values(WILAYA_MAP));

/**
 * Mobile algérien → 0XXXXXXXXX (05/06/07 + 8 chiffres).
 * Accepte 0…, 213…, +213…, 00213…, avec espaces, points, tirets. null sinon.
 */
export function normalizeDzMobile(raw: string): string | null {
  const digits = String(raw ?? '').replace(/[\s\-().+]/g, '');
  const m = digits.match(/^(?:00213|213|0)([567]\d{8})$/);
  return m ? `0${m[1]}` : null;
}

/** Wilaya canonique (liste officielle) ou null si inconnue. */
export function canonicalWilaya(raw: string): string | null {
  const n = normalizeWilaya(String(raw ?? ''));
  return CANONICAL_WILAYAS.has(n) ? n : null;
}

/**
 * Neutralise l'injection de formule tableur : une valeur commençant par
 * = + - @ (ou tabulation / retour chariot) est préfixée d'une apostrophe,
 * que Google Sheets affiche comme du texte.
 */
export function sheetSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Retire les caractères de contrôle, sauf tabulation, saut de ligne et retour chariot. */
function stripControlChars(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    out += ch;
  }
  return out;
}

function cleanValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return null; // pas d'objets/tableaux imbriqués
  const s = stripControlChars(String(v)).trim();
  if (!s || s === '...') return null; // placeholder recopié du prompt
  return s.slice(0, MAX_VALUE_LENGTH);
}

export interface ValidationResult {
  /** Données assainies (clés valides, valeurs chaînes bornées, champs critiques normalisés). */
  data: Record<string, string>;
  /** Champs critiques présents mais invalides (ils sont retirés de `data`). */
  invalid: string[];
}

/**
 * Assainit un bloc extrait. Les champs critiques invalides sont RETIRÉS :
 * ils ne peuvent ni compléter la commande ni écraser une valeur déjà validée.
 */
export function sanitizeExtracted(raw: unknown): ValidationResult {
  const data: Record<string, string> = {};
  const invalid: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { data, invalid };

  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_KEYS)) {
    if (!KEY_PATTERN.test(k)) continue;
    const value = cleanValue(v);
    if (value === null) continue;

    if (k === 'telephone') {
      const phone = normalizeDzMobile(value);
      if (phone) data[k] = phone;
      else invalid.push(k);
      continue;
    }
    if (k === 'wilaya') {
      const w = canonicalWilaya(value);
      if (w) data[k] = w;
      else invalid.push(k);
      continue;
    }
    data[k] = value;
  }
  return { data, invalid };
}

/**
 * La commande (ou réclamation) est-elle complète ?
 *
 * - prompt par défaut : tous les champs obligatoires du modèle sont présents
 *   et valides dans les données FUSIONNÉES de la session ;
 * - prompt personnalisé (clés choisies par le marchand) : ancienne règle
 *   (bloc courant ≥ 3 clés), mais jamais si un champ critique est invalide.
 */
export function isExtractionComplete(opts: {
  templateType: string;
  customPrompt: boolean;
  current: ValidationResult;
  merged: Record<string, string>;
}): boolean {
  const { templateType, customPrompt, current, merged } = opts;
  if (current.invalid.length > 0) return false;

  if (customPrompt) return Object.keys(current.data).length >= LEGACY_MIN_KEYS;

  const required = requiredFor(templateType);
  if (!required) return false;
  return missingFields(required, merged).length === 0;
}

function requiredFor(templateType: string): string[] | null {
  return templateType in REQUIRED_FIELDS
    ? REQUIRED_FIELDS[templateType]
    : REQUIRED_FIELDS.auto_confirmation;
}

function missingFields(required: string[], merged: Record<string, string>): string[] {
  return required.filter((f) => !(typeof merged[f] === 'string' && merged[f].length > 0));
}

const FIELD_LABELS: Record<string, string> = {
  nom: 'l-isem kamel',
  telephone: 'raqm téléphone (05/06/07 + 8 arqam)',
  wilaya: 'l-wilaya',
  produit: 'l-produit',
  reclamation: 'wasf l-mushkil',
  commande: 'raqm l-commande',
};

/**
 * Réponse à envoyer À LA PLACE de celle du modèle quand il a émis un bloc
 * <data> que le serveur refuse. Sans elle, le client lisait « commande
 * enregistrée ✅ » alors que rien n'était enregistré. null = rien à corriger.
 */
export function correctionReply(opts: {
  templateType: string;
  customPrompt: boolean;
  current: ValidationResult;
  merged: Record<string, string>;
}): string | null {
  const { templateType, customPrompt, current, merged } = opts;
  if (current.invalid.includes('telephone')) {
    return 'Raqm téléphone ma ybanch sah 🙏 Lazem ykoun 05, 06 wella 07 + 8 arqam. 3awed iktebh 3afak.';
  }
  if (current.invalid.includes('wilaya')) {
    return 'Ma fhemtch l-wilaya 🙏 3awed iktebha 3afak (ex : Alger, Oran, Constantine, Sétif…).';
  }
  if (customPrompt) return null;
  const required = requiredFor(templateType);
  if (!required) return null;
  const missing = missingFields(required, merged);
  if (missing.length === 0) return null;
  return `Bach nkemlou, 9olli 3afak : ${missing.map((f) => FIELD_LABELS[f] ?? f).join(', ')} 🙏`;
}

/** Copie des données prête pour Google Sheets (anti-injection de formule). */
export function toSheetRow(data: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) out[k] = sheetSafe(String(v));
  return out;
}
