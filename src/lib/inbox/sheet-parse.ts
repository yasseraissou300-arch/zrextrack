// Lecture d'un Google Sheet de commandes (formulaire de landing page, YouCan,
// export manuel…) → commandes « à confirmer ».
//
// Aucun réglage de colonnes demandé au marchand : la ligne d'en-tête est
// reconnue par des synonymes (français, anglais, arabe). Chaque colonne ne sert
// qu'à un seul champ.

import { createHash } from 'node:crypto';
import { normalizePhone } from '@/lib/whatsapp/message-builder';

export type InboxField =
  | 'customer_name'
  | 'phone'
  | 'wilaya'
  | 'commune'
  | 'address'
  | 'product'
  | 'quantity'
  | 'price'
  | 'delivery_type'
  | 'note'
  | 'ordered_at';

export interface InboxDraft {
  external_ref: string;
  customer_name: string;
  phone: string;
  wilaya: string;
  commune: string;
  address: string;
  product: string;
  quantity: number;
  price: number;
  delivery_type: 'domicile' | 'stopdesk';
  note: string;
  ordered_at: string | null;
}

export function normHeader(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/[_\-:.*()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ordre = priorité : un en-tête « type de livraison » doit aller à
// delivery_type avant que « prix » ne tente « prix livraison ».
const ALIASES: [InboxField, string[]][] = [
  [
    'delivery_type',
    [
      'type livraison',
      'type de livraison',
      'mode livraison',
      'mode de livraison',
      'delivery type',
      'shipping type',
      'نوع التوصيل',
      'طريقة التوصيل',
      'stop desk',
      'stopdesk',
      'livraison',
      'delivery',
      'shipping',
      'التوصيل',
    ],
  ],
  [
    'ordered_at',
    [
      'date',
      'date commande',
      'order date',
      'created at',
      'التاريخ',
      'تاريخ',
      'horodateur',
      'timestamp',
    ],
  ],
  [
    'customer_name',
    [
      'nom complet',
      'nom et prenom',
      'nom',
      'name',
      'full name',
      'client',
      'customer',
      'customer name',
      'prenom',
      'الاسم الكامل',
      'الاسم',
      'اسم',
      'الاسم و اللقب',
      'الاسم واللقب',
    ],
  ],
  [
    'phone',
    [
      'telephone',
      'numero de telephone',
      'numero',
      'tel',
      'phone',
      'phone number',
      'mobile',
      'whatsapp',
      'رقم الهاتف',
      'الهاتف',
      'رقم الجوال',
      'الجوال',
      'هاتف',
      'رقم',
    ],
  ],
  ['wilaya', ['wilaya', 'province', 'state', 'region', 'الولاية', 'ولاية']],
  [
    'commune',
    [
      'commune',
      'baladia',
      'baladiya',
      'daira',
      'ville',
      'city',
      'district',
      'البلدية',
      'بلدية',
      'المدينة',
    ],
  ],
  ['address', ['adresse', 'adresse complete', 'address', 'العنوان', 'عنوان']],
  [
    'product',
    [
      'produit',
      'nom du produit',
      'product',
      'product name',
      'article',
      'item',
      'المنتج',
      'المنتوج',
      'منتج',
      'السلعة',
    ],
  ],
  ['quantity', ['quantite', 'qte', 'qty', 'quantity', 'الكمية', 'كمية', 'العدد']],
  [
    'price',
    [
      'prix total',
      'total',
      'prix',
      'price',
      'montant',
      'amount',
      'cod',
      'المبلغ',
      'المبلغ الاجمالي',
      'السعر',
      'الثمن',
      'المجموع',
    ],
  ],
  ['note', ['note', 'notes', 'remarque', 'commentaire', 'comment', 'ملاحظة', 'ملاحظات']],
];

const SHIPPING_WORDS = ['livraison', 'shipping', 'delivery', 'توصيل', 'التوصيل'];

// Mots trop génériques : seulement si l'en-tête est EXACTEMENT ce mot
// (« adresse de livraison » est une adresse, pas un type de livraison).
const EXACT_ONLY = new Set(['livraison', 'delivery', 'shipping', 'التوصيل']);

/** Colonne → champ, à partir de la ligne d'en-tête. */
export function detectColumns(header: unknown[]): Partial<Record<InboxField, number>> {
  const cols = header.map(normHeader);
  const map: Partial<Record<InboxField, number>> = {};
  const used = new Set<number>();
  for (const [field, aliases] of ALIASES) {
    let found = -1;
    // 1) égalité exacte, 2) l'en-tête contient le synonyme (synonymes ≥ 4 lettres)
    for (const pass of [0, 1]) {
      for (const alias of aliases) {
        found = cols.findIndex((c, i) => {
          if (used.has(i) || !c) return false;
          if (field === 'price' && SHIPPING_WORDS.some((w) => c.includes(w))) return false;
          if (pass === 1 && EXACT_ONLY.has(alias)) return false;
          return pass === 0 ? c === alias : alias.length >= 4 && c.includes(alias);
        });
        if (found >= 0) break;
      }
      if (found >= 0) break;
    }
    if (found >= 0) {
      map[field] = found;
      used.add(found);
    }
  }
  return map;
}

/** « 3 200 DA », « 3200.00 », « 3,200 », « ٣٢٠٠ دج » → 3200. */
export function parseAmount(raw: unknown): number {
  let s = String(raw ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\d.,]/g, '');
  if (!s) return 0;
  // Virgule décimale seule (« 3200,50 ») ; sinon séparateur de milliers.
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  // « 3.200 » (point de milliers) vs « 3200.50 »
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

export function parseQuantity(raw: unknown): number {
  const n = Math.trunc(parseAmount(raw));
  return n >= 1 && n <= 999 ? n : 1;
}

export function parseDeliveryType(raw: unknown): 'domicile' | 'stopdesk' {
  const s = normHeader(raw);
  return /stop|desk|bureau|agence|point relais|مكتب|المكتب|نقطة/.test(s) ? 'stopdesk' : 'domicile';
}

function parseDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // « 24/11/2026 14:05:00 » (format Google Forms FR) → ISO
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  const d = m
    ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0) - 1, +(m[5] ?? 0), +(m[6] ?? 0))) // Alger = UTC+1
    : new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

const clip = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Empreinte stable d'une ligne : la même ligne n'est jamais importée deux fois. */
export function rowRef(row: unknown[]): string {
  const key = row.map((c) => String(c ?? '').trim()).join('\u001f');
  return 'sh:' + createHash('sha1').update(key).digest('hex').slice(0, 32);
}

export interface ParseResult {
  columns: Partial<Record<InboxField, number>>;
  drafts: InboxDraft[];
  skipped: number;
  /** Champs indispensables introuvables dans l'en-tête. */
  missing: InboxField[];
}

/**
 * Lignes d'un Sheet (1re ligne = en-tête) → commandes.
 * Une ligne sans téléphone exploitable est ignorée : on ne peut ni la
 * confirmer par WhatsApp ni l'expédier.
 */
export function parseSheet(values: unknown[][], maxRows = 2000): ParseResult {
  const [header = [], ...rows] = values;
  const columns = detectColumns(header);
  const missing = (['phone', 'customer_name'] as InboxField[]).filter(
    (f) => columns[f] === undefined
  );
  if (missing.length) return { columns, drafts: [], skipped: rows.length, missing };

  const at = (row: unknown[], f: InboxField) => (columns[f] === undefined ? '' : row[columns[f]!]);
  const drafts: InboxDraft[] = [];
  let skipped = 0;
  for (const row of rows.slice(-maxRows)) {
    if (!Array.isArray(row) || row.every((c) => String(c ?? '').trim() === '')) continue;
    const phone = normalizePhone(String(at(row, 'phone') ?? ''));
    if (!/^\d{11,15}$/.test(phone)) {
      skipped++;
      continue;
    }
    drafts.push({
      external_ref: rowRef(row),
      customer_name: clip(at(row, 'customer_name'), 120),
      phone,
      wilaya: clip(at(row, 'wilaya'), 80),
      commune: clip(at(row, 'commune'), 80),
      address: clip(at(row, 'address'), 300),
      product: clip(at(row, 'product'), 200),
      quantity: parseQuantity(at(row, 'quantity')),
      price: parseAmount(at(row, 'price')),
      delivery_type: parseDeliveryType(at(row, 'delivery_type')),
      note: clip(at(row, 'note'), 300),
      ordered_at: parseDate(at(row, 'ordered_at')),
    });
  }
  return { columns, drafts, skipped, missing };
}

/** ID d'un Google Sheet depuis son lien de partage (ou l'ID seul). */
export function sheetIdFromUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  const m =
    s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{10,100})/) ?? s.match(/^([A-Za-z0-9_-]{25,100})$/);
  return m ? m[1] : null;
}
