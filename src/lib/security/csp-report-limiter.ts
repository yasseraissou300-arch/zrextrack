// Limiteur en mémoire de /api/csp-report (par instance serverless).
//   - 20 requêtes / minute / IP ;
//   - même couple directive + origine journalisé une fois par minute ;
//   - plafond global de 300 lignes / minute (rotation d'IP).
// Mémoire bornée : tout est vidé à chaque nouvelle fenêtre, 5 000 clés max.

const WINDOW_MS = 60_000;
export const PER_IP = 20;
export const GLOBAL_LINES = 300;
const MAX_TRACKED = 5_000;

let windowStart = 0;
let lines = 0;
const perIp = new Map<string, number>();
const seen = new Set<string>();

function roll(now: number) {
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    lines = 0;
    perIp.clear();
    seen.clear();
  }
}

/** false = requête au-delà du quota de cette IP pour la fenêtre courante. */
export function allowRequest(ip: string, now = Date.now()): boolean {
  roll(now);
  const hits = (perIp.get(ip) ?? 0) + 1;
  if (perIp.size < MAX_TRACKED || perIp.has(ip)) perIp.set(ip, hits);
  return hits <= PER_IP;
}

/** true = cette ligne doit être journalisée (nouvelle et sous le plafond). */
export function allowLine(reason: string): boolean {
  if (seen.has(reason) || lines >= GLOBAL_LINES) return false;
  if (seen.size < MAX_TRACKED) seen.add(reason);
  lines++;
  return true;
}

/** Réservé aux tests. */
export function resetCspReportLimiter(): void {
  windowStart = 0;
  lines = 0;
  perIp.clear();
  seen.clear();
}
