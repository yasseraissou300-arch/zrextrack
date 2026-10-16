// P0 — flux OAuth Facebook : le `state` ne doit plus porter l'identité.
//
// Avant : state = base64({user_id}) non signé. Un attaquant forgeant le state
// avec l'UUID d'une victime rattachait SA page au compte de la victime.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { newOAuthState, oauthStateMatches, OAUTH_STATE_COOKIE } from '@/lib/security/oauth-state';

describe('oauth-state', () => {
  it('produit des nonces aléatoires, non décodables en identité', () => {
    const a = newOAuthState();
    const b = newOAuthState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(() => JSON.parse(Buffer.from(a, 'base64').toString())).toThrow();
  });

  it('compare cookie et query en temps constant', () => {
    const s = newOAuthState();
    expect(oauthStateMatches(s, s)).toBe(true);
    expect(oauthStateMatches(s, newOAuthState())).toBe(false);
    expect(oauthStateMatches(s, null)).toBe(false);
    expect(oauthStateMatches(null, s)).toBe(false);
    expect(oauthStateMatches('', '')).toBe(false);
  });
});

// ─── Routes réelles (Supabase et Graph API simulés) ─────────────────────────
let sessionUser: { id: string } | null = null;
const upserts: any[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
  createServiceClient: () => ({
    from: () => ({
      upsert: async (row: any) => {
        upserts.push(row);
        return { error: null };
      },
      // Lecture du verify_token existant (P2-2) : aucune connexion préalable.
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  }),
}));

const fetchMock = vi.fn(async (url: string) => {
  if (url.includes('/me/accounts'))
    return new Response(
      JSON.stringify({ data: [{ id: 'PAGE-ATTACKER', name: 'P', access_token: 't' }] })
    );
  return new Response(JSON.stringify({ access_token: 'tok' }));
});

beforeEach(() => {
  sessionUser = null;
  upserts.length = 0;
  vi.stubEnv('FACEBOOK_APP_ID', 'app');
  vi.stubEnv('FACEBOOK_APP_SECRET', 'secret');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test');
  vi.stubGlobal('fetch', fetchMock);
});

const callback = (state: string | null, cookie?: string) => {
  const u = new URL('https://app.test/api/ai-chatbot/facebook/callback');
  u.searchParams.set('code', 'CODE');
  if (state !== null) u.searchParams.set('state', state);
  return new NextRequest(u, {
    headers: cookie ? { cookie: `${OAUTH_STATE_COOKIE}=${cookie}` } : {},
  });
};

describe('GET /api/ai-chatbot/facebook/oauth', () => {
  it('pose un cookie httpOnly identique au state envoyé à Facebook', async () => {
    sessionUser = { id: 'user-A' };
    const { GET } = await import('@/app/api/ai-chatbot/facebook/oauth/route');
    const res = await GET();
    const location = new URL(res.headers.get('location')!);
    const state = location.searchParams.get('state')!;
    const cookie = res.cookies.get(OAUTH_STATE_COOKIE);
    expect(cookie?.value).toBe(state);
    expect(cookie?.httpOnly).toBe(true);
    expect(state).not.toContain('user-A');
    expect(Buffer.from(state, 'base64').toString()).not.toContain('user-A');
  });
});

describe('GET /api/ai-chatbot/facebook/callback', () => {
  it('ATTAQUE : state forgé avec l’UUID d’une victime → refusé, rien écrit', async () => {
    const forged = Buffer.from(JSON.stringify({ user_id: 'victim' })).toString('base64');
    const { GET } = await import('@/app/api/ai-chatbot/facebook/callback/route');
    const res = await GET(callback(forged));
    expect(res.headers.get('location')).toContain('error=invalid_state');
    expect(upserts).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('oauth/access_token'));
  });

  it('state différent du cookie → refusé', async () => {
    sessionUser = { id: 'user-A' };
    const { GET } = await import('@/app/api/ai-chatbot/facebook/callback/route');
    const res = await GET(callback(newOAuthState(), newOAuthState()));
    expect(res.headers.get('location')).toContain('error=invalid_state');
    expect(upserts).toHaveLength(0);
  });

  it('state valide mais aucune session → /login, rien écrit', async () => {
    const s = newOAuthState();
    const { GET } = await import('@/app/api/ai-chatbot/facebook/callback/route');
    const res = await GET(callback(s, s));
    expect(res.headers.get('location')).toContain('/login');
    expect(upserts).toHaveLength(0);
  });

  it('flux légitime : la connexion est enregistrée pour l’utilisateur de la SESSION', async () => {
    sessionUser = { id: 'user-A' };
    const s = newOAuthState();
    const { GET } = await import('@/app/api/ai-chatbot/facebook/callback/route');
    const res = await GET(callback(s, s));
    expect(res.headers.get('location')).toContain('success=connected');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].user_id).toBe('user-A');
    // Nonce à usage unique : effacé après usage.
    expect(res.cookies.get(OAUTH_STATE_COOKIE)?.value).toBe('');
  });
});
