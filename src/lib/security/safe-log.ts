// Journalisation structurée sans données personnelles — Phase 0, point 8.
//
// AVANT : `console.log('[WEBHOOK IN]', body.event, body.instance, body.data?.key?.remoteJid)`
// → le numéro de téléphone complet du client atterrissait dans les logs Vercel.
//
// Règle : on journalise des IDENTIFIANTS et des STATUTS, jamais le contenu des
// messages, ni les numéros complets, ni les secrets.

/** « 213556172674 » → « 213***674 ». Assez pour corréler, pas pour identifier. */
export function maskPhone(raw: string | null | undefined): string {
  const s = String(raw ?? '').replace(/@.*$/, ''); // retire le suffixe JID
  if (!s) return '';
  if (s.length <= 6) return '***';
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

/** Hash court et stable — corréler sans exposer la valeur. */
export function shortHash(value: string | null | undefined): string {
  const s = String(value ?? '');
  if (!s) return '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 8);
}

type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  event?: string;
  tenant_id?: string;
  instance?: string;
  conversation_id?: string;
  message_id?: string;
  status?: string;
  error_code?: string;
  reason?: string;
  [k: string]: unknown;
}

// LOG-6 : liste BLANCHE des champs émis. Avant, le commentaire affirmait
// « seuls les champs listés sont émis » mais le type acceptait n'importe quelle
// clé (`[k: string]: unknown`) : un appelant passant `phone`, `email` ou un
// corps de réponse le journalisait tel quel. Liste établie à partir de toutes
// les clés réellement utilisées (main + PR ouvertes, 2026-10-14).
const ALLOWED_FIELDS = new Set([
  'event',
  'tenant_id',
  'instance',
  'conversation_id',
  'message_id',
  'status',
  'error_code',
  'reason',
  'contact',
  'worker',
  'elapsed_ms',
  'enqueued',
  'recovered',
  'scheduled',
  'total',
  'offset',
  'synced',
  'notifications',
  'count',
  'ref',
  'attempt',
  'http_status',
  'flow',
  'channel',
  'job_id',
  'job_type',
]);

/** Champs texte libres : bornés et assainis (LOG-2 : err.message brut). */
const FREE_TEXT_FIELDS = new Set(['reason', 'error_code', 'event', 'flow']);
const MAX_FREE_TEXT = 200;

/** Numéros (≥ 9 chiffres), emails, `key=` / `token=` d'URL → masqués. */
export function redactFreeText(value: string): string {
  return value
    .slice(0, MAX_FREE_TEXT)
    .replace(/([?&](?:key|token|apikey|access_token)=)[^&\s"']+/gi, '$1••••')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s.-]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[num]' : m));
}

function sanitizeFields(fields: LogFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (!ALLOWED_FIELDS.has(k)) {
      dropped.push(k);
      continue;
    }
    if (k === 'contact' && typeof v === 'string' && /\d{7,}/.test(v.replace(/\D/g, ''))) {
      // Contact jamais en clair, même si l'appelant a oublié maskPhone.
      out[k] = v.includes('***') ? v : maskPhone(v);
      continue;
    }
    out[k] = FREE_TEXT_FIELDS.has(k) && typeof v === 'string' ? redactFreeText(v) : v;
  }
  if (dropped.length) out.dropped_keys = dropped.sort();
  return out;
}

/**
 * Log structuré à champ unique (JSON) — exploitable par n'importe quel
 * agrégateur, et sûr par construction : seuls les champs de la liste blanche
 * sont émis (les autres sont signalés par leur NOM dans `dropped_keys`), les
 * champs texte libres sont bornés et assainis, `contact` est toujours masqué.
 */
export function logEvent(level: LogLevel, scope: string, fields: LogFields): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    scope,
    ...sanitizeFields(fields),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
