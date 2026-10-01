// Banc d'essai générique pour l'audit d'authentification des routes d'API.
//
// Charge chaque src/app/api/**/route.ts, appelle chaque méthode exportée avec un
// état d'authentification et un corps choisis, et ENREGISTRE : statut HTTP,
// appels réseau sortants (URL + en-têtes + corps), écritures en base (FakeSupabase).
// Aucun réseau réel : `fetch` est remplacé ; aucune base réelle.

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import type { FakeSupabase } from './fake-supabase';

export const API_DIR = path.resolve(__dirname, '../../src/app/api');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type Method = (typeof METHODS)[number];

export function routeFiles(dir = API_DIR): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? routeFiles(p) : n === 'route.ts' ? [p] : [];
  });
}

/** `campaigns/[id]/send` (chemin relatif à src/app/api, sans /route.ts). */
export const routeName = (file: string) =>
  path.relative(API_DIR, path.dirname(file)).replace(/\\/g, '/');

export interface Outgoing {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface CallResult {
  status: number | 'throw';
  text: string;
  outgoing: Outgoing[];
  writes: Array<{ table: string; op: string; rows: Record<string, unknown>[] }>;
}

export function makeFetchRecorder() {
  const outgoing: Outgoing[] = [];
  const fn = async (input: unknown, init?: RequestInit) => {
    const h: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (h[k] = v));
    outgoing.push({ url: String(input), headers: h, body: String(init?.body ?? '') });
    // Réponse neutre : aucune donnée réelle, aucune page supplémentaire.
    return Response.json({ items: [], data: [], totalPages: 1, hasNext: false });
  };
  return { outgoing, fn };
}

export async function callRoute(
  file: string,
  method: Method,
  opts: {
    db: FakeSupabase;
    outgoing: Outgoing[];
    body?: Record<string, unknown>;
    query?: Record<string, string>;
    headers?: Record<string, string>;
  }
): Promise<CallResult | null> {
  const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
  const handler = mod[method] as
    | ((req: NextRequest, ctx: unknown) => Promise<Response>)
    | undefined;
  if (typeof handler !== 'function') return null;
  const url = new URL(`https://app.test/api/${routeName(file).replace(/\[(\w+)\]/g, 'x')}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const hasBody = method !== 'GET';
  const req = new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    ...(hasBody ? { body: JSON.stringify(opts.body ?? {}) } : {}),
  });
  const writesBefore = opts.db.writes.length;
  const outBefore = opts.outgoing.length;
  const ctx = { params: Promise.resolve({ id: 'x', tracking: 'x' }) };
  let status: number | 'throw';
  let text = '';
  try {
    const res = await handler(req, ctx);
    status = res.status;
    text = await res.text().catch(() => '');
  } catch {
    status = 'throw';
  }
  return {
    status,
    text,
    outgoing: opts.outgoing.slice(outBefore),
    writes: opts.db.writes
      .slice(writesBefore)
      .map((w) => ({ table: w.table, op: w.op, rows: w.rows as Record<string, unknown>[] })),
  };
}

export const ALL_METHODS = METHODS;
