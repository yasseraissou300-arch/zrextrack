// Réception des rapports CSP (Content-Security-Policy-Report-Only).
//
// Endpoint PUBLIC (le navigateur l'appelle sans session) : on ne journalise
// que la directive violée et l'ORIGINE de la ressource bloquée — jamais
// l'URL complète (chemins, paramètres pouvant contenir des données), jamais le
// corps. Réponse 204 dans tous les cas (rien à apprendre pour un attaquant).
//
// Anti-flood (n'importe qui peut POSTer ici) : corps lu en flux et coupé à
// 8 Ko (jamais chargé en entier) + limiteur (lib/security/csp-report-limiter).

import { NextRequest, NextResponse } from 'next/server';
import { logEvent } from '@/lib/security/safe-log';
import { allowLine, allowRequest } from '@/lib/security/csp-report-limiter';

const MAX_BODY = 8_192;

function clientIp(req: NextRequest): string {
  // x-real-ip est posé par la plateforme (Vercel) ; x-forwarded-for en secours.
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  ).slice(0, 64);
}

/** Lit au plus MAX_BODY octets du flux, sans jamais charger le corps entier. */
async function readBounded(req: NextRequest): Promise<string> {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY * 8) return '';
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_BODY) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    return '';
  } finally {
    reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(Math.min(size, MAX_BODY));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.byteLength, buf.byteLength - off));
    buf.set(part, off);
    off += part.byteLength;
    if (off >= buf.byteLength) break;
  }
  return new TextDecoder().decode(buf);
}

function originOf(uri: unknown): string {
  if (typeof uri !== 'string' || !uri) return 'unknown';
  if (/^(inline|eval|data|blob|self)$/i.test(uri)) return uri.toLowerCase();
  try {
    return new URL(uri).origin;
  } catch {
    return uri.split(/[/?#]/)[0].slice(0, 40) || 'unknown';
  }
}

const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  if (!allowRequest(clientIp(req))) return noContent();

  const text = await readBounded(req);
  try {
    const json = JSON.parse(text);
    // Format historique { "csp-report": {...} } ou Reporting API [{ body: {...} }]
    const reports: Array<Record<string, unknown>> = Array.isArray(json)
      ? json.map((r) => (r?.body ?? {}) as Record<string, unknown>)
      : [(json?.['csp-report'] ?? {}) as Record<string, unknown>];
    for (const r of reports.slice(0, 10)) {
      const directive = String(
        r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'] ?? 'unknown'
      ).slice(0, 40);
      const blocked = originOf(r['blocked-uri'] ?? r.blockedURL);
      const reason = `${directive} ${blocked}`;
      if (!allowLine(reason)) continue;
      logEvent('warn', 'csp.report', { event: 'violation', reason });
    }
  } catch {
    // corps illisible ou tronqué : ignoré
  }
  return noContent();
}
