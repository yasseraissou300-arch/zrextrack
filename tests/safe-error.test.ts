// P3 — Aucun détail interne (message PostgREST/PostgreSQL, exception réseau,
// hôte, jeton) ne part au client. Le détail reste côté serveur, assaini, relié
// au client par une référence courte.
//
// Données synthétiques uniquement : les « secrets » ci-dessous sont factices.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const FAKE_JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoiZmFrZSJ9.ZmFrZS1zaWduYXR1cmUtdGVzdA';
const SQL_LEAK =
  'permission denied for table orders_old_backup_2026 (column "zrexpress_token" of relation "user_sync_settings")';
const NET_LEAK = `connect ECONNREFUSED 10.0.0.5:5432 https://evo-internal.up.railway.app/x?apikey=S3CRETS3CRET ${FAKE_JWT}`;

// ── Mocks : client Supabase configurable par test ────────────────────────────
const state: {
  user: { id: string } | null;
  result: { data: unknown; error: unknown; count?: number | null };
  throwOnCreate: Error | null;
} = { user: { id: 'u-1' }, result: { data: null, error: null }, throwOnCreate: null };

function chain(): unknown {
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: (v: unknown) => unknown) => Promise.resolve(state.result).then(res);
      }
      return () => proxy;
    },
  });
  return proxy;
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => {
    if (state.throwOnCreate) throw state.throwOnCreate;
    return { from: () => chain(), schema: () => ({ from: () => chain() }) };
  },
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: () => chain(),
  }),
}));

import {
  internalError,
  redactForLog,
  errorCode,
  GENERIC_ERROR,
  UPSTREAM_ERROR,
} from '@/lib/security/safe-error';

let logs: string[];
beforeEach(() => {
  logs = [];
  state.user = { id: 'u-1' };
  state.result = { data: null, error: null };
  state.throwOnCreate = null;
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
});
afterEach(() => vi.restoreAllMocks());

function expectNoLeak(text: string) {
  for (const needle of [
    'permission denied',
    'orders_old_backup',
    'zrexpress_token',
    'user_sync_settings',
    'ECONNREFUSED',
    '10.0.0.5',
    'railway',
    'S3CRETS3CRET',
    FAKE_JWT,
  ]) {
    expect(text).not.toContain(needle);
  }
}

// ─── Module ──────────────────────────────────────────────────────────────────

describe('internalError', () => {
  it('client : message générique + référence ; serveur : même référence, code, détail assaini', async () => {
    const res = internalError('api.test', { code: '42501', message: `${SQL_LEAK} ${NET_LEAK}` });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: GENERIC_ERROR, ref: expect.stringMatching(/^E-[0-9a-f]{8}$/) });
    expectNoLeak(JSON.stringify(body));

    expect(logs).toHaveLength(1);
    const log = JSON.parse(logs[0]);
    expect(log).toMatchObject({ scope: 'api.test', error_code: '42501', ref: body.ref });
    expect(log.reason).toContain('permission denied'); // le détail utile reste côté serveur
    expect(log.reason).not.toContain(FAKE_JWT);
    expect(log.reason).not.toContain('S3CRETS3CRET');
  });

  it('502 → message « service externe »', async () => {
    const body = await internalError('api.test', new Error(NET_LEAK), 502).json();
    expect(body.error).toBe(UPSTREAM_ERROR);
  });
});

describe('redactForLog', () => {
  it.each([
    ['JWT', `token ${FAKE_JWT}`, FAKE_JWT],
    ['Bearer', 'Authorization: Bearer abcdefghijklmnop', 'abcdefghijklmnop'],
    ['clé en paramètre', 'GET /x?apikey=S3CRETS3CRET&b=1', 'S3CRETS3CRET'],
    ['identifiants dans l’URL', 'postgres://user:pa55word@db.host/x', 'pa55word'],
    ['clé Gemini', 'key AIzaSyA1234567890abcdefghijklmnop', 'AIzaSyA1234567890abcdefghijklmnop'],
    ['secret-box', 'value enc:v1:k1:aaaa:bbbb', 'enc:v1:k1:aaaa:bbbb'],
    ['téléphone', 'send to 213 555 12 34 56 failed', '555 12 34'],
    ['email', 'user jean.dupont@example.com', 'jean.dupont@example.com'],
  ])('%s masqué', (_label, input, secret) => {
    expect(redactForLog(input)).not.toContain(secret);
  });

  it('tronque à 300 caractères', () => {
    expect(redactForLog('x '.repeat(500)).length).toBeLessThanOrEqual(300);
  });
});

describe('errorCode', () => {
  it('code PostgREST / PostgreSQL, code système en cause, nom de classe', () => {
    expect(errorCode({ code: 'PGRST116', message: 'x' })).toBe('PGRST116');
    expect(
      errorCode(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
    ).toBe('ECONNREFUSED');
    expect(errorCode(new TypeError('boom'))).toBe('TypeError');
    expect(errorCode('texte')).toBe('unknown');
  });

  it('un « code » qui n’a pas la forme d’un code n’est pas recopié', () => {
    expect(errorCode({ code: SQL_LEAK })).toBe('unknown');
  });
});

// ─── Routes : ancien code = fuite, nouveau code = message sûr ────────────────

describe('routes publiques', () => {
  it('GET /api/health : base en erreur → 503 sans détail PostgREST', async () => {
    state.result = { data: null, error: { code: '42501', message: SQL_LEAK } };
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'error', db: 'down' });
    expect(body).not.toHaveProperty('detail');
    expectNoLeak(JSON.stringify(body));
    expect(logs.join('\n')).toContain('42501');
  });

  it('GET /api/track/[tracking] : exception → 500 générique', async () => {
    state.throwOnCreate = new Error(NET_LEAK);
    const { GET } = await import('@/app/api/track/[tracking]/route');
    const req = new Request('https://app.test/api/track/X', {
      headers: { 'x-forwarded-for': '198.51.100.7' },
    });
    const res = await GET(req as never, { params: Promise.resolve({ tracking: 'X' }) } as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe(GENERIC_ERROR);
    expectNoLeak(JSON.stringify(body));
  });
});

describe('routes authentifiées', () => {
  it('GET /api/jobs : erreur PostgREST → 500 générique', async () => {
    state.result = { data: null, error: { code: '42501', message: SQL_LEAK } };
    const { GET } = await import('@/app/api/jobs/route');
    const res = await GET(new NextRequest('https://app.test/api/jobs'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe(GENERIC_ERROR);
    expectNoLeak(JSON.stringify(body));
  });

  it('GET /api/orders : exception → 500 générique', async () => {
    state.throwOnCreate = new Error(NET_LEAK);
    const { GET } = await import('@/app/api/orders/route');
    const res = await GET(new NextRequest('https://app.test/api/orders?page=1'));
    expect(res.status).toBe(500);
    expectNoLeak(JSON.stringify(await res.json()));
  });
});

// ─── Verrou statique sur TOUTES les routes ───────────────────────────────────

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return name === 'route.ts' ? [p] : [];
  });
}

/** Contenu de chaque appel `NextResponse.json(...)`, parenthèses équilibrées. */
function jsonCalls(src: string): string[] {
  const out: string[] = [];
  let i = src.indexOf('NextResponse.json(');
  while (i >= 0) {
    let depth = 0;
    let j = i + 'NextResponse.json'.length;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) break;
    }
    out.push(src.slice(i, j + 1));
    i = src.indexOf('NextResponse.json(', j);
  }
  return out;
}

describe('verrou statique — src/app/api/**/route.ts', () => {
  const API = path.resolve(__dirname, '../src/app/api');
  const files = routeFiles(API);

  it('aucune réponse JSON ne contient un `.message` d’erreur', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const call of jsonCalls(readFileSync(f, 'utf8'))) {
        if (/\b\w+\??\.message\b/.test(call)) {
          offenders.push(`${path.relative(API, f)}: ${call.slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('aucun fragment de EVOLUTION_URL renvoyé au client', () => {
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), path.relative(API, f)).not.toMatch(
        /EVOLUTION_URL\.(substring|slice|substr)\(/
      );
    }
  });
});
