// P4 — AUDIT (constat, aucun code modifié) : en-têtes HTTP et cookies.
//
// Base : main local ae4428c. Ces tests documentent le comportement ACTUEL au
// niveau APPLICATION (handlers, middleware, configuration, bibliothèques). Les
// en-têtes ajoutés par Next.js en production locale (`next start`) ont été
// relevés à part (voir .claude/mission/http-security-headers-audit.md) ; ceux
// ajoutés par Vercel ne sont PAS observables ici.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
let sessionUser: string | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser ? { id: sessionUser } : null } }) },
    from: (t: string) => db.from(t),
  }),
}));

const A = '11111111-1111-4111-8111-111111111111';
const SECURITY_HEADERS = [
  'content-security-policy',
  'x-frame-options',
  'strict-transport-security',
  'referrer-policy',
  'x-content-type-options',
  'permissions-policy',
];

beforeEach(() => {
  db = new FakeSupabase();
  sessionUser = null;
  vi.resetModules();
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => vi.restoreAllMocks());

function headerNames(res: Response) {
  return [...res.headers.keys()].map((k) => k.toLowerCase());
}

describe('configuration — sources d’en-têtes', () => {
  it('next.config.mjs : aucune fonction headers() ; productionBrowserSourceMaps = true', () => {
    const cfg = readFileSync('next.config.mjs', 'utf8');
    expect(cfg).not.toMatch(/headers\s*\(/);
    expect(cfg).toMatch(/productionBrowserSourceMaps:\s*true/);
  });

  it('aucun vercel.json ; aucun en-tête de sécurité ni CORS posé dans src/', () => {
    expect(existsSync('vercel.json')).toBe(false);
    const mw = readFileSync('src/middleware.ts', 'utf8');
    for (const h of [...SECURITY_HEADERS, 'access-control-allow-origin', 'cache-control']) {
      expect(mw.toLowerCase()).not.toContain(h);
    }
  });
});

describe('réponses API — en-têtes posés par les handlers', () => {
  it('/api/track (public) : JSON, AUCUN Cache-Control, aucun CORS, aucun en-tête de sécurité, aucun cookie', async () => {
    db.seed('public', 'orders', [
      {
        tracking_number: 'TEST_TRACKING_A',
        customer_name: 'Client A',
        wilaya: 'Oran',
        delivery_status: 'livre',
      },
    ]);
    const { GET } = await import('@/app/api/track/[tracking]/route');
    const res = await GET(
      new NextRequest('https://app.test/api/track/x', {
        headers: { 'x-forwarded-for': '203.0.113.9' },
      }),
      {
        params: Promise.resolve({ tracking: 'TEST_TRACKING_A' }),
      }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const names = headerNames(res);
    expect(names).not.toContain('cache-control'); // données personnelles sans directive de cache
    expect(names.some((n) => n.startsWith('access-control-'))).toBe(false);
    expect(names.filter((n) => SECURITY_HEADERS.includes(n))).toEqual([]);
    expect(names).not.toContain('set-cookie');
  });

  it('/api/track 429 : JSON + Retry-After uniquement', async () => {
    const { GET } = await import('@/app/api/track/[tracking]/route');
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) {
      last = await GET(
        new NextRequest('https://app.test/api/track/x', {
          headers: { 'x-forwarded-for': '203.0.113.10' },
        }),
        {
          params: Promise.resolve({ tracking: 'TEST_TRACKING_Z' }),
        }
      );
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('content-type')).toContain('application/json');
    expect(last!.headers.get('retry-after')).toBeTruthy();
  });

  it('/api/integrations sans session : 401 JSON, aucun cookie, aucun CORS', async () => {
    const { GET } = await import('@/app/api/integrations/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(headerNames(res)).not.toContain('set-cookie');
    expect(headerNames(res).some((n) => n.startsWith('access-control-'))).toBe(false);
  });

  it('/api/integrations avec session : 200 JSON, AUCUN Cache-Control (réponse authentifiée)', async () => {
    sessionUser = A;
    const { GET } = await import('@/app/api/integrations/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(headerNames(res)).not.toContain('cache-control');
  });

  it('/api/health : JSON, aucun Cache-Control', async () => {
    db.seed('public', 'plans', [{ id: 'free' }]);
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(headerNames(res)).not.toContain('cache-control');
  });

  it('webhook Facebook GET : écho du challenge en text/plain (jamais text/html)', async () => {
    db.seed('public', 'facebook_connections', [{ user_id: A, verify_token: 'TEST_VERIFY' }]);
    const { GET } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
    const res = await GET(
      new NextRequest(
        'https://app.test/api/ai-chatbot/webhook/facebook?hub.mode=subscribe&hub.verify_token=TEST_VERIFY&hub.challenge=%3Cscript%3E'
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').not.toContain('html');
  });
});

describe('middleware — contrôle de présence de cookie', () => {
  const run = async (path: string, cookie?: string) => {
    const { middleware } = await import('@/middleware');
    const res = middleware(
      new NextRequest(`https://app.test${path}`, { headers: cookie ? { cookie } : {} })
    );
    return { status: res.status, location: res.headers.get('location') };
  };

  it('page protégée sans cookie → 307 /login ; avec un cookie sb-*-auth-token QUELCONQUE → laissée passer (coquille sans données)', async () => {
    expect(await run('/admin-dashboard')).toEqual({
      status: 307,
      location: 'https://app.test/login',
    });
    const forged = await run('/admin-dashboard', 'sb-x-auth-token=forged');
    expect(forged.status).toBe(200);
  });

  it('routes publiques par préfixe : /, /login*, /pricing*, /auth/callback*, /api/*, /track* sans cookie', async () => {
    for (const p of [
      '/',
      '/login',
      '/pricing',
      '/auth/callback',
      '/api/orders',
      '/track',
      '/track/TEST_TRACKING_A',
      '/trackX',
    ]) {
      expect((await run(p)).status).toBe(200);
    }
  });
});

describe('cookies de session Supabase (@supabase/ssr)', () => {
  it('options par défaut : httpOnly FALSE, sameSite lax, path /, 400 jours, secure non imposé', async () => {
    const { DEFAULT_COOKIE_OPTIONS } = await import('@supabase/ssr/dist/main/utils/constants.js');
    expect(DEFAULT_COOKIE_OPTIONS).toMatchObject({
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 400 * 24 * 60 * 60,
    });
    expect('secure' in DEFAULT_COOKIE_OPTIONS).toBe(false);
  });

  it('le code de l’application ne surcharge PAS ces options (createServerClient / createBrowserClient sans cookieOptions)', () => {
    for (const f of [
      'src/lib/supabase/server.ts',
      'src/lib/supabase/client.tsx',
      'src/app/auth/callback/route.ts',
    ]) {
      expect(readFileSync(f, 'utf8')).not.toContain('cookieOptions');
    }
  });
});
