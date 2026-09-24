// Facebook : jetons d'accès des pages et jeton de vérification du webhook.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { OAUTH_STATE_COOKIE } from '@/lib/security/oauth-state';

let db: FakeSupabase;
const USER = '11111111-1111-4111-8111-111111111111';
const PAGE_TOKEN = 'EAAG-page-access-token-SECRET';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () =>
    Object.assign(Object.create(db), {
      from: db.from.bind(db),
      auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    }),
}));

beforeEach(() => {
  db = new FakeSupabase();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/ai-chatbot/facebook — pages en attente', () => {
  it('ne renvoie jamais le jeton d’accès des pages au navigateur', async () => {
    db.seed('public', 'facebook_connections', [
      {
        user_id: USER,
        page_id: '',
        verify_token: 'zrex_fb_x',
        connected: false,
        pending_pages: JSON.stringify([
          { id: 'p1', name: 'Boutique', access_token: PAGE_TOKEN, picture: 'u' },
        ]),
      },
    ]);
    const { GET } = await import('@/app/api/ai-chatbot/facebook/route');
    const body = await (await GET()).text();
    expect(body).not.toContain(PAGE_TOKEN);
    expect(JSON.parse(body).pending_pages).toEqual([{ id: 'p1', name: 'Boutique', picture: 'u' }]);
  });
});

describe('callback OAuth — jeton de vérification', () => {
  function stubGraph() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/oauth/access_token')) return Response.json({ access_token: 'user-tok' });
        if (url.includes('/me/accounts'))
          return Response.json({
            data: [{ id: 'p1', name: 'Boutique', access_token: PAGE_TOKEN }],
          });
        return Response.json({});
      })
    );
    vi.stubEnv('FACEBOOK_APP_ID', 'app');
    vi.stubEnv('FACEBOOK_APP_SECRET', 'secret');
  }
  const callback = async () => {
    const { GET } = await import('@/app/api/ai-chatbot/facebook/callback/route');
    // Nonce OAuth (P0-2) : state de l'URL = cookie httpOnly posé par /oauth.
    const state = 'nonce-test-0123456789abcdef';
    return GET(
      new NextRequest(`https://app.test/api/ai-chatbot/facebook/callback?code=c&state=${state}`, {
        headers: { cookie: `${OAUTH_STATE_COOKIE}=${state}` },
      })
    );
  };

  it('nouveau jeton : aléatoire, non déductible de l’UUID', async () => {
    stubGraph();
    await callback();
    const token: string = db.all('public', 'facebook_connections')[0].verify_token;
    expect(token).not.toBe(`zrex_fb_${USER.slice(0, 8)}`);
    expect(token).not.toContain(USER.slice(0, 8));
    expect(token.length).toBeGreaterThanOrEqual(30);
  });

  it('reconnexion : le jeton existant est conservé (webhook déjà vérifié chez Meta)', async () => {
    stubGraph();
    db.seed('public', 'facebook_connections', [
      { user_id: USER, page_id: 'p1', verify_token: 'zrex_fb_existant' },
    ]);
    await callback();
    expect(db.all('public', 'facebook_connections')[0].verify_token).toBe('zrex_fb_existant');
  });
});

describe('GET webhook — poignée de main Meta', () => {
  const verify = async (token: string | null) => {
    const { GET } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
    const q = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.challenge': 'CH' });
    if (token !== null) q.set('hub.verify_token', token);
    return GET(new NextRequest(`https://app.test/api/ai-chatbot/webhook/facebook?${q}`));
  };

  it('jeton vide refusé même si une ligne a un jeton vide', async () => {
    db.seed('public', 'facebook_connections', [{ user_id: USER, verify_token: '' }]);
    expect((await verify('')).status).toBe(400);
    expect((await verify(null)).status).toBe(400);
  });

  it('jeton d’une connexion marchand accepté, faux jeton refusé', async () => {
    db.seed('public', 'facebook_connections', [{ user_id: USER, verify_token: 'zrex_fb_abc' }]);
    const ok = await verify('zrex_fb_abc');
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('CH');
    expect((await verify('zrex_fb_nope')).status).toBe(403);
  });

  it('jeton plateforme (FACEBOOK_VERIFY_TOKEN) accepté', async () => {
    vi.stubEnv('FACEBOOK_VERIFY_TOKEN', 'platform-verify');
    expect((await verify('platform-verify')).status).toBe(200);
  });
});
