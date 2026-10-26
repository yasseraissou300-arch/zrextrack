// Classificateurs de texte du chatbot WhatsApp — extraits de
// src/app/api/ai-chatbot/webhook/whatsapp/route.ts pour être testables
// (Next 15 interdit tout export autre que les méthodes HTTP dans un route.ts).

// ─── 58 Wilayas Algeria normalization ─────────────────────────────────────────
export const WILAYA_MAP: Record<string, string> = {
  adrar: 'Adrar',
  chlef: 'Chlef',
  chleff: 'Chlef',
  'el chlef': 'Chlef',
  laghouat: 'Laghouat',
  'oum el bouaghi': 'Oum El Bouaghi',
  'oum bouaghi': 'Oum El Bouaghi',
  batna: 'Batna',
  bejaia: 'Béjaïa',
  béjaïa: 'Béjaïa',
  bgayet: 'Béjaïa',
  biskra: 'Biskra',
  bechar: 'Béchar',
  béchar: 'Béchar',
  blida: 'Blida',
  bouira: 'Bouira',
  tamanrasset: 'Tamanrasset',
  tamanghasset: 'Tamanrasset',
  tebessa: 'Tébessa',
  tébessa: 'Tébessa',
  tlemcen: 'Tlemcen',
  tiaret: 'Tiaret',
  'tizi ouzou': 'Tizi Ouzou',
  'tizi-ouzou': 'Tizi Ouzou',
  'tizi ouzu': 'Tizi Ouzou',
  tizi: 'Tizi Ouzou',
  alger: 'Alger',
  algiers: 'Alger',
  dzair: 'Alger',
  djelfa: 'Djelfa',
  jijel: 'Jijel',
  setif: 'Sétif',
  sétif: 'Sétif',
  setiff: 'Sétif',
  saida: 'Saïda',
  saïda: 'Saïda',
  skikda: 'Skikda',
  'sidi bel abbes': 'Sidi Bel Abbès',
  'sidi bel abbès': 'Sidi Bel Abbès',
  sba: 'Sidi Bel Abbès',
  annaba: 'Annaba',
  guelma: 'Guelma',
  constantine: 'Constantine',
  qsentina: 'Constantine',
  medea: 'Médéa',
  médéa: 'Médéa',
  mostaganem: 'Mostaganem',
  msila: "M'Sila",
  "m'sila": "M'Sila",
  mascara: 'Mascara',
  ouargla: 'Ouargla',
  oran: 'Oran',
  wahran: 'Oran',
  'el bayadh': 'El Bayadh',
  illizi: 'Illizi',
  'bordj bou arreridj': 'Bordj Bou Arréridj',
  bba: 'Bordj Bou Arréridj',
  boumerdes: 'Boumerdès',
  boumerdès: 'Boumerdès',
  'el tarf': 'El Tarf',
  tindouf: 'Tindouf',
  tissemsilt: 'Tissemsilt',
  'el oued': 'El Oued',
  eloued: 'El Oued',
  khenchela: 'Khenchela',
  soukahras: 'Souk Ahras',
  'souk ahras': 'Souk Ahras',
  tipaza: 'Tipaza',
  tipasa: 'Tipaza',
  mila: 'Mila',
  'ain defla': 'Aïn Defla',
  'aïn defla': 'Aïn Defla',
  naama: 'Naâma',
  naâma: 'Naâma',
  'ain temouchent': 'Aïn Témouchent',
  'aïn témouchent': 'Aïn Témouchent',
  ghardaia: 'Ghardaïa',
  ghardaïa: 'Ghardaïa',
  relizane: 'Relizane',
  timimoun: 'Timimoun',
  'bordj badji mokhtar': 'Bordj Badji Mokhtar',
  'ouled djellal': 'Ouled Djellal',
  'beni abbes': 'Béni Abbès',
  'in salah': 'In Salah',
  'in guezzam': 'In Guezzam',
  touggourt: 'Touggourt',
  djanet: 'Djanet',
  'el meghaier': "El M'Ghair",
};

export function normalizeWilaya(raw: string): string {
  const clean = raw
    .toLowerCase()
    .trim()
    .replace(/[éèê]/g, 'e')
    .replace(/[àâ]/g, 'a')
    .replace(/[îï]/g, 'i')
    .replace(/[ôö]/g, 'o')
    .replace(/[ùûü]/g, 'u');
  return WILAYA_MAP[clean] ?? WILAYA_MAP[raw.toLowerCase().trim()] ?? raw;
}

// ─── Anger / frustration detection ────────────────────────────────────────────
export const ANGER_KEYWORDS = [
  'hram',
  '7ram',
  'malhoul',
  'mahoul',
  'ndir plainte',
  'nchakou',
  'ghachi',
  'sba7a',
  'dawir',
  'faci',
  'khayb',
  'wahd',
  'wa7d dial',
  'arnab',
  'nas khayba',
  'f*** ',
  'merde',
  'nta khayb',
  'nti khayba',
  'ndir fi',
  'ndiru fikom',
  'hadchi mazal',
  'mazal mazal',
  'disappointed',
  'furious',
  'angry',
  'scam',
  'arnaque',
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Correspondance sur MOTS ENTIERS. L'ancien `includes()` déclenchait sur des
// sous-chaînes : « bghit wahda » (wahd), « c'est facile » (faci),
// « ndir fiha » (ndir fi)… Chaque faux positif bascule définitivement la
// conversation en humain (human_handover) : le bot ne répondait plus au client.
const ANGER_PATTERNS = ANGER_KEYWORDS.map(
  (kw) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(kw.trim())}($|[^\\p{L}\\p{N}])`, 'iu')
);

export function isAngerDetected(text: string): boolean {
  const lower = text.toLowerCase();
  return ANGER_PATTERNS.some((re) => re.test(lower));
}

// ─── Blabla / non-serious detection ───────────────────────────────────────────
export const BLABLA_PATTERNS = [
  /^(hi|hello|salam|mrhba|ahlan|slt|cava|كيف|مرحبا|صباح|مساء)[\s!?.]*$/i,
  /^(ok|okay|oui|non|yes|no|wah|la|ewa|ewa ewa)[\s!?.]*$/i,
  /^\p{Emoji}+$/u,
  /^.{1,3}$/,
];

// ⚠️ Ne s'applique qu'au PREMIER message d'un contact : en cours de
// conversation, « wah », « 2 », « 16 » sont des réponses aux questions du bot
// (confirmation, quantité, code wilaya) — cf. l'appel dans le webhook.
// (\p{Emoji} inclut aussi les chiffres 0-9, # et *.)
export function isBlabla(text: string): boolean {
  return BLABLA_PATTERNS.some((p) => p.test(text.trim()));
}
