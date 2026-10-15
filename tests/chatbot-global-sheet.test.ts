// /api/chatbot : la feuille Google GLOBALE (GOOGLE_SHEETS_WEBHOOK_URL) ne reçoit
// jamais les données d'un tenant — seulement celles du Super Admin.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

let currentUser: { id: string; app_metadata: Record<string, unknown> } | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }),
}));
vi.mock('@/lib/user-creds', () => ({ resolveGeminiKeys: async () => [] }));

import { POST } from '@/app/api/chatbot/route';

const SHEET = 'https://sheet.test/TEST_HOOK';
let fetchMock: ReturnType<typeof vi.fn>;

function complaint() {
  return POST(
    new NextRequest('http://localhost/api/chatbot', {
      method: 'POST',
      body: JSON.stringify({
        message: 'Le colis est arrivé cassé, je veux un remboursement',
        sessionState: {
          intent: 'complaint',
          step: 'collect_complaint',
          data: { name: 'Client Test', type: 'forged', source: 'forged' },
        },
        history: [],
        channel: 'web',
      }),
    })
  );
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_SHEETS_WEBHOOK_URL', SHEET);
  fetchMock = vi.fn(async () => new Response('ok'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sheetCalls = () => fetchMock.mock.calls.filter(([u]) => String(u) === SHEET);

describe('feuille globale de la plateforme', () => {
  it('tenant ordinaire → aucune donnée envoyée à la feuille globale', async () => {
    currentUser = { id: 'tenant-a', app_metadata: {} };
    expect((await complaint()).status).toBe(200);
    expect(sheetCalls()).toHaveLength(0);
  });

  it('profiles.role ne compte pas : seul le claim app_metadata', async () => {
    currentUser = { id: 'tenant-b', app_metadata: { provider: 'email' } };
    await complaint();
    expect(sheetCalls()).toHaveLength(0);
  });

  it('Super Admin → envoyé, champs fixes non écrasables par le client', async () => {
    currentUser = { id: 'admin', app_metadata: { role: 'admin' } };
    expect((await complaint()).status).toBe(200);
    expect(sheetCalls()).toHaveLength(1);
    const body = JSON.parse(String(sheetCalls()[0][1].body));
    expect(body).toMatchObject({ type: 'complaint', source: 'chatbot', name: 'Client Test' });
  });

  it('non connecté → 401, rien envoyé', async () => {
    currentUser = null;
    expect((await complaint()).status).toBe(401);
    expect(sheetCalls()).toHaveLength(0);
  });
});
