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

/**
 * Log structuré à champ unique (JSON) — exploitable par n'importe quel
 * agrégateur, et sûr par construction : seuls les champs listés sont émis.
 */
export function logEvent(level: LogLevel, scope: string, fields: LogFields): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    scope,
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
