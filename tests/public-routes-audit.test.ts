// P4 — AUDIT (constat, aucun code modifié) : surfaces HTTP joignables sans session.
//
// Base : main local ae4428c. L'inventaire exhaustif et le balayage anonyme de
// toutes les routes sont faits par tests/api-auth-audit.test.ts (branche
// claude/p4-api-auth-audit, rejoué sur ae4428c : exceptions publiques =
// health + track ; écarts connus inchangés). Ce fichier couvre ce que ce
// balayage ne prouvait pas : le contenu de /api/health, le callback OAuth
// Facebook (state non signé) et la vérification GET du webhook Meta.
// Valeurs FACTICES (TEST_*). Tests en DEUX ÉTATS là où un correctif existe sur
// une branche non mergée (constat sur main / état corrigé).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
let sessionUser: string | null = null;
let planError: { code: string; message: string } | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () =>
    planError
      ? {
          from: () => ({
            select: async () => ({ data: null, count: null, error: planError }),
          }),
        }
      : db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser ? { id: sessionUser } : null } }) },
    from: (t: string) => db.from(t),
  }),
}));

const VICTIM = 'aaaaaaaa-1111-4111-8111-111111111111';
const ATTACKER = 'bbbbbbbb-2222-4222-8222-222222222222';

beforeEach(() => {
  db = new FakeSupabase();
  sessionUser = null;
  planError = null;
  vi.resetModules();
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── /api/health — public par conception (sonde de disponibilité) ────────────

describe('GET /api/health (anonyme)', () => {
  it('base joignable → 200 { status, db, time } uniquement, aucune donnée métier', async () => {
    db.seed('public', 'plans', [{ id: 'free' }, { id: 'pro' }]);
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(['db', 'status', 'time']);
  });

  it('erreur base : message PostgREST brut au PUBLIC sur main (constat) / générique avec 12j', async () => {
    planError = {
      code: 'PGRST301',
      message: 'TEST_INTERNAL relation "public.plans" host db.internal.test',
    };
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    if (text.includes('TEST_INTERNAL')) {
      expect(text).toContain('db.internal.test'); // main : détail interne public
    } else {
      expect(text).not.toContain('db.internal.test');
    }
  });
});

// ─── /api/ai-chatbot/facebook/callback — retour OAuth, SANS session sur main ──

describe('GET /api/ai-chatbot/facebook/callback — state', () => {
  const forgedState = Buffer.from(JSON.stringify({ user_id: VICTIM })).toString('base64');
  const graph = vi.fn(async (input: string) => {
    const url = String(input);
    if (url.includes('/oauth/access_token'))
      return Response.json({ access_token: 'TEST_ATTACKER_USER_TOKEN' });
    if (url.includes('/me/accounts')) {
      return Response.json({
        data: [
          { id: 'attacker-page', name: 'Page attaquant', access_token: 'TEST_ATTACKER_PAGE_TOKEN' },
        ],
      });
    }
    return new Response('{}');
  });
  const call = async () => {
    const { GET } = await import('@/app/api/ai-chatbot/facebook/callback/route');
    const res = await GET(
      new NextRequest(
        `https://app.test/api/ai-chatbot/facebook/callback?code=TEST_ATTACKER_CODE&state=${encodeURIComponent(forgedState)}`
      )
    );
    return { status: res.status, location: res.headers.get('location') ?? '' };
  };

  it('configuration de production (FACEBOOK_APP_ID/SECRET absents) : redirection no_app_id, aucune écriture', async () => {
    vi.stubEnv('FACEBOOK_APP_ID', '');
    vi.stubEnv('FACEBOOK_APP_SECRET', '');
    vi.stubGlobal('fetch', graph);
    sessionUser = ATTACKER;
    const r = await call();
    expect(r.location).toMatch(/error=(no_app_id|invalid_state)/);
    expect(db.all('public', 'facebook_connections')).toHaveLength(0);
  });

  it('Meta configuré : state forgé « user_id = victime » → page de l’ATTAQUANT liée au compte VICTIME sur main (constat P0-2, latent) / rejeté avec le correctif', async () => {
    vi.stubEnv('FACEBOOK_APP_ID', 'TEST_APP_ID');
    vi.stubEnv('FACEBOOK_APP_SECRET', 'TEST_APP_SECRET');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test');
    vi.stubGlobal('fetch', graph);
    sessionUser = ATTACKER; // l'attaquant est connecté à SON compte (ou à aucun : main ne lit pas la session)
    const r = await call();
    const rows = db.all('public', 'facebook_connections');
    if (r.location.includes('invalid_state')) {
      expect(rows).toHaveLength(0); // correctif présent (78070c4)
    } else {
      expect(r.location).toContain('success=connected');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        user_id: VICTIM,
        page_id: 'attacker-page',
        page_access_token: 'TEST_ATTACKER_PAGE_TOKEN',
        verify_token: `zrex_fb_${VICTIM.slice(0, 8)}`,
      });
    }
  });
});

// ─── /api/ai-chatbot/webhook/facebook GET — vérification Meta (public) ───────

describe('GET /api/ai-chatbot/webhook/facebook — hub.verify_token', () => {
  const verify = async (token: string, challenge = 'TEST_CHALLENGE_123') => {
    const { GET } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
    const res = await GET(
      new NextRequest(
        `https://app.test/api/ai-chatbot/webhook/facebook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${encodeURIComponent(challenge)}`
      )
    );
    return {
      status: res.status,
      type: res.headers.get('content-type') ?? '',
      body: await res.text(),
    };
  };

  beforeEach(() => {
    db.seed('public', 'facebook_connections', [
      { user_id: VICTIM, verify_token: `zrex_fb_${VICTIM.slice(0, 8)}` },
    ]);
  });

  it('CONSTAT : jeton DÉRIVÉ de l’id du marchand (zrex_fb_<8 premiers caractères>) → 200 et écho du challenge ; autre jeton → 403', async () => {
    expect((await verify(`zrex_fb_${VICTIM.slice(0, 8)}`)).status).toBe(200);
    expect((await verify('zrex_fb_00000000')).status).toBe(403);
  });

  it('écho du challenge en text/plain (pas de HTML interprété)', async () => {
    const r = await verify(`zrex_fb_${VICTIM.slice(0, 8)}`, '<script>TEST</script>');
    expect(r.body).toBe('<script>TEST</script>');
    expect(r.type).not.toContain('text/html');
  });
});
