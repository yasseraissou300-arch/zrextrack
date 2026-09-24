// P2-9 phase 1b — jetons de page Facebook chiffrés au repos, jamais exposés.
// Valeurs factices ; trousseau généré à l'exécution.

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { isSealed } from '@/lib/security/secret-box';
import {
  openPageToken,
  openPendingPages,
  sealPageToken,
  sealPendingPages,
} from '@/lib/security/facebook-verify';
import { OAUTH_STATE_COOKIE } from '@/lib/security/oauth-state';

let db: FakeSupabase;
const USER = '11111111-1111-4111-8111-111111111111';
const TOKEN_1 = 'EAAG-page-token-ONE-0123456789';
const TOKEN_2 = 'EAAG-page-token-TWO-9876543210';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () =>
    Object.assign(Object.create(db), {
      from: db.from.bind(db),
      auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    }),
}));
vi.mock('@/lib/user-creds', () => ({
  resolveGeminiKeys: async () => ['gemini-test-key'],
}));

let graphPages: Array<{ id: string; name: string; access_token: string }> = [];
const graphSends: string[] = [];

beforeEach(() => {
  db = new FakeSupabase();
  graphSends.length = 0;
  vi.stubEnv('SECRETS_KEYRING', `k1:${crypto.randomBytes(32).toString('base64')}`);
  vi.stubEnv('FACEBOOK_APP_ID', 'app');
  vi.stubEnv('FACEBOOK_APP_SECRET', '');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/oauth/access_token')) return Response.json({ access_token: 'user-tok' });
      if (url.includes('/me/accounts')) return Response.json({ data: graphPages });
      if (url.startsWith('https://generativelanguage.googleapis.com')) {
        return Response.json({ candidates: [{ content: { parts: [{ text: 'Salam !' }] } }] });
      }
      if (url.includes('/me/messages')) {
        graphSends.push(new URL(url).searchParams.get('access_token') ?? '');
        return Response.json({});
      }
      return Response.json({});
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function callback() {
  // callback exige FACEBOOK_APP_SECRET : défini localement pour cet appel.
  vi.stubEnv('FACEBOOK_APP_SECRET', 'app-secret-test');
  const { GET } = await import('@/app/api/ai-chatbot/facebook/callback/route');
  const state = 'nonce-test-0123456789abcdef';
  await GET(
    new NextRequest(`https://app.test/api/ai-chatbot/facebook/callback?code=c&state=${state}`, {
      headers: { cookie: `${OAUTH_STATE_COOKIE}=${state}` },
    })
  );
  vi.stubEnv('FACEBOOK_APP_SECRET', '');
}

const row = () => db.all('public', 'facebook_connections')[0];

describe('stockage', () => {
  it('une page : jeton chiffré au repos, lisible côté serveur', async () => {
    graphPages = [{ id: 'p1', name: 'Boutique', access_token: TOKEN_1 }];
    await callback();
    expect(isSealed(row().page_access_token)).toBe(true);
    expect(row().page_access_token).not.toContain(TOKEN_1);
    expect(openPageToken(USER, row().page_access_token)).toBe(TOKEN_1);
  });

  it('plusieurs pages : pending_pages chiffré en bloc (aucun jeton en clair)', async () => {
    graphPages = [
      { id: 'p1', name: 'A', access_token: TOKEN_1 },
      { id: 'p2', name: 'B', access_token: TOKEN_2 },
    ];
    await callback();
    const stored: string = row().pending_pages;
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain(TOKEN_1);
    expect(stored).not.toContain(TOKEN_2);
  });
});

describe('non-exposition', () => {
  it('GET /api/ai-chatbot/facebook : pages listées, jetons absents', async () => {
    graphPages = [
      { id: 'p1', name: 'A', access_token: TOKEN_1 },
      { id: 'p2', name: 'B', access_token: TOKEN_2 },
    ];
    await callback();
    const { GET } = await import('@/app/api/ai-chatbot/facebook/route');
    const text = await (await GET()).text();
    expect(text).not.toContain(TOKEN_1);
    expect(text).not.toContain(TOKEN_2);
    expect(text).not.toContain('enc:v1');
    expect(JSON.parse(text).pending_pages.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2']);
  });

  it('POST sélection : le jeton choisi est stocké chiffré, la réponse ne le contient pas', async () => {
    graphPages = [
      { id: 'p1', name: 'A', access_token: TOKEN_1 },
      { id: 'p2', name: 'B', access_token: TOKEN_2 },
    ];
    await callback();
    const { POST } = await import('@/app/api/ai-chatbot/facebook/route');
    const res = await POST(
      new NextRequest('https://app.test/api/ai-chatbot/facebook', {
        method: 'POST',
        body: JSON.stringify({ page_id: 'p2' }),
      })
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(TOKEN_2);
    expect(isSealed(row().page_access_token)).toBe(true);
    expect(openPageToken(USER, row().page_access_token)).toBe(TOKEN_2);
  });
});

describe('webhook Messenger', () => {
  function seedConnection(token: string) {
    db.seed('public', 'facebook_connections', [
      { user_id: USER, page_id: 'page-1', page_access_token: token },
    ]);
    db.seed('public', 'ai_chat_sessions', [
      { user_id: USER, channel: 'facebook', contact_id: 'psid', conversation: [] },
    ]);
  }
  async function inbound() {
    const { POST } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
    await POST(
      new NextRequest('https://app.test/api/ai-chatbot/webhook/facebook', {
        method: 'POST',
        body: JSON.stringify({
          object: 'page',
          entry: [
            {
              id: 'page-1',
              messaging: [{ sender: { id: 'psid' }, message: { mid: 'm1', text: 'Salam' } }],
            },
          ],
        }),
      })
    );
  }

  it('jeton chiffré : la réponse part avec le jeton déchiffré', async () => {
    seedConnection(sealPageToken(USER, TOKEN_1));
    await inbound();
    expect(graphSends).toEqual([TOKEN_1]);
  });

  it('jeton historique en clair : toujours utilisable', async () => {
    seedConnection(TOKEN_1);
    await inbound();
    expect(graphSends).toEqual([TOKEN_1]);
  });

  it('jeton illisible (autre trousseau) : aucun envoi, pas d’exception', async () => {
    const other = { SECRETS_KEYRING: `k1:${crypto.randomBytes(32).toString('base64')}` };
    vi.stubEnv('SECRETS_KEYRING', other.SECRETS_KEYRING);
    const foreign = sealPageToken(USER, TOKEN_1);
    vi.stubEnv('SECRETS_KEYRING', `k1:${crypto.randomBytes(32).toString('base64')}`);
    seedConnection(foreign);
    await inbound();
    expect(graphSends).toHaveLength(0);
  });
});

describe('aides', () => {
  it('pending_pages : aller-retour', () => {
    const json = JSON.stringify([{ id: 'p1', access_token: TOKEN_1 }]);
    expect(openPendingPages(USER, sealPendingPages(USER, json))).toBe(json);
  });
  it('contexte lié à l’utilisateur : illisible pour un autre', () => {
    const sealed = sealPageToken(USER, TOKEN_1);
    expect(openPageToken('22222222-2222-4222-8222-222222222222', sealed)).toBeNull();
  });
});
