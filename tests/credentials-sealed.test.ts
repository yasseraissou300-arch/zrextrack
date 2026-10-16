// P2-9 phase 1 — clés Gemini BYOK et handler de sync : lecture de valeurs
// chiffrées, masquage à 4 caractères, aucune clé dans les réponses.

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { seal, isSealed, secretContext } from '@/lib/security/secret-box';
import { zrTokenContext } from '@/lib/zrexpress/credentials';

let db: FakeSupabase;
const USER = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
  }),
}));

import { resolveGeminiKeys } from '@/lib/user-creds';
import { handleZrexpressSync } from '@/lib/queue/handlers/zrexpress-sync';
import type { Job } from '@/lib/queue/types';

const KEY_A = 'gemini-test-key-A-0000000000000000001111';
const KEY_B = 'gemini-test-key-B-0000000000000000002222';
const geminiCtx = secretContext('user_api_credentials', 'api_key', `${USER}:gemini`);

beforeEach(() => {
  db = new FakeSupabase();
  vi.stubEnv('SECRETS_KEYRING', `k1:${crypto.randomBytes(32).toString('base64')}`);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function storeGemini(value: string) {
  db.seed('public', 'user_api_credentials', [
    { user_id: USER, service: 'gemini', api_key: value, api_url: null, is_active: true },
  ]);
}

describe('Gemini BYOK', () => {
  it('pool chiffré : resolveGeminiKeys renvoie les clés en clair côté serveur', async () => {
    storeGemini(seal(`${KEY_A}\n${KEY_B}`, geminiCtx));
    expect(await resolveGeminiKeys(USER)).toEqual([KEY_A, KEY_B]);
  });

  it('pool historique en clair : toujours lisible', async () => {
    storeGemini(`${KEY_A},${KEY_B}`);
    expect(await resolveGeminiKeys(USER)).toEqual([KEY_A, KEY_B]);
  });

  it('valeur illisible → aucune clé (bot silencieux), pas d’exception', async () => {
    storeGemini(
      seal(KEY_A, geminiCtx, {
        SECRETS_KEYRING: `k1:${crypto.randomBytes(32).toString('base64')}`,
      } as unknown as NodeJS.ProcessEnv)
    );
    expect(await resolveGeminiKeys(USER)).toEqual([]);
  });

  it('GET /api/user-credentials : 4 derniers caractères au plus, jamais la clé', async () => {
    storeGemini(seal(`${KEY_A}\n${KEY_B}`, geminiCtx));
    const { GET } = await import('@/app/api/user-credentials/route');
    const text = await (await GET()).text();
    expect(text).not.toContain(KEY_A);
    expect(text).not.toContain(KEY_B);
    expect(text).not.toContain(KEY_A.slice(0, 8)); // l'ancien masque montrait le début
    const svc = JSON.parse(text).services[0];
    expect(svc.configured).toBe(true);
    expect(svc.key_count).toBe(2);
    expect(svc.keys_masked).toEqual(['••••1111', '••••2222']);
  });

  it('POST /api/user-credentials stocke la clé chiffrée', async () => {
    const { POST } = await import('@/app/api/user-credentials/route');
    const res = await POST(
      new NextRequest('https://app.test/api/user-credentials', {
        method: 'POST',
        body: JSON.stringify({ service: 'gemini', api_key: KEY_A }),
      })
    );
    expect(res.status).toBe(200);
    const stored = db.all('public', 'user_api_credentials')[0].api_key;
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain(KEY_A);
    expect(await resolveGeminiKeys(USER)).toEqual([KEY_A]);
  });
});

describe('handler de file zrexpress.sync', () => {
  it('lit une clé ZR chiffrée et appelle ZRExpress avec la clé en clair', async () => {
    const ZR = 'zr-stored-key-queue-0123456789';
    db.seed('public', 'user_sync_settings', [
      {
        user_id: USER,
        zrexpress_token: seal(ZR, zrTokenContext(USER)),
        zrexpress_tenant_id: 'zr-tenant',
        notify_enabled: {},
      },
    ]);
    db.seed('public', 'profiles', [{ id: USER, plan_id: 'pro', role: null }]);
    const keys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        keys.push(new Headers(init?.headers).get('x-api-key') ?? '');
        return Response.json({ items: [], totalPages: 1, hasNext: false });
      })
    );
    const job = { tenant_id: USER, type: 'zrexpress.sync', payload: {} } as unknown as Job;
    await handleZrexpressSync(job);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k === ZR)).toBe(true);
  });
});
