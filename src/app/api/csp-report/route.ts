// Réception des rapports CSP (Content-Security-Policy-Report-Only).
//
// Endpoint PUBLIC (le navigateur l'appelle sans session) : on ne journalise
// que la directive violée et l'ORIGINE de la ressource bloquée — jamais
// l'URL complète (chemins, paramètres pouvant contenir des données), jamais le
// corps. Corps borné ; réponse 204 dans tous les cas.

import { NextRequest, NextResponse } from 'next/server';
import { logEvent } from '@/lib/security/safe-log';

const MAX_BODY = 8_192;

function originOf(uri: unknown): string {
  if (typeof uri !== 'string' || !uri) return 'unknown';
  if (/^(inline|eval|data|blob|self)$/i.test(uri)) return uri.toLowerCase();
  try {
    return new URL(uri).origin;
  } catch {
    return uri.split(/[/?#]/)[0].slice(0, 40) || 'unknown';
  }
}

export async function POST(req: NextRequest) {
  const text = (await req.text().catch(() => '')).slice(0, MAX_BODY);
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
      logEvent('warn', 'csp.report', { event: 'violation', reason: `${directive} ${blocked}` });
    }
  } catch {
    // corps illisible : ignoré
  }
  return new NextResponse(null, { status: 204 });
}
