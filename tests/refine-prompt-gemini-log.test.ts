// P4 — /api/ai-chatbot/refine-prompt : le corps BRUT de l'erreur Gemini partait
// dans les journaux (`console.error('[refine-prompt][Gemini]', status, errText)`).
// Un corps d'erreur Google peut citer l'URL appelée (donc `?key=`), le projet
// et le prompt du marchand. Correction : même journal sûr que le chatbot
// (ai.gemini, catégorie énumérée, ref) ; réponses HTTP au navigateur INCHANGÉES
// (502 « Erreur Gemini », 500 « Erreur serveur »).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const T = '11111111-1111-4111-8111-111111111111';
const KEY = 'AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUvW';
const PROMPT = 'Nta agent dyal Boutique Amine, jme3 smiya w 0550000001';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: T } } }) } }),
}));
vi.mock('@/lib/user-creds', () => ({
  resolveGeminiKey: async () => KEY,
  missingCredentialsResponse: () => ({ error: 'missing' }),
}));

let outcome: { status: number; body: string } | 'network' = { status: 200, body: '' };
const fetchMock = vi.fn(async (input: string) => {
  const url = String(input);
  if (outcome === 'network') throw new TypeError(`fetch failed: ${url}`);
  return new Response(outcome.body, { status: outcome.status });
});

async function refine() {
  const { POST } = await import('@/app/api/ai-chatbot/refine-prompt/route');
  const res = await POST(
    new NextRequest('https://app.test/api/ai-chatbot/refine-prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt: PROMPT, template_type: 'sav', shop_name: 'Boutique Amine' }),
    })
  );
  return { status: res.status, body: await res.json() };
}

function logLines(): string[] {
  return (['log', 'info', 'warn', 'error'] as const).flatMap((m) =>
    (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      c.map(String).join(' ')
    )
  );
}
const failures = () =>
  logLines()
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.scope === 'ai.gemini' && l.status === 'failed');

const googleError = JSON.stringify({
  error: {
    code: 400,
    message: `Request https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=${KEY} failed for prompt "${PROMPT}"`,
    status: 'INVALID_ARGUMENT',
    details: [{ reason: 'API_KEY_INVALID', metadata: { consumer: 'projects/123456789' } }],
  },
});

beforeEach(() => {
  outcome = { status: 200, body: '' };
  vi.stubGlobal('fetch', fetchMock);
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('refine-prompt — erreur Gemini', () => {
  it('succès → prompt affiné, aucune trace', async () => {
    outcome = {
      status: 200,
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Prompt affiné' }] } }] }),
    };
    expect(await refine()).toEqual({ status: 200, body: { refined: 'Prompt affiné' } });
    expect(failures()).toHaveLength(0);
  });

  it('400 clé invalide → 502 inchangé, trace sûre (invalid_key), corps jamais journalisé', async () => {
    outcome = { status: 400, body: googleError };
    expect(await refine()).toEqual({ status: 502, body: { error: 'Erreur Gemini' } });
    expect(failures()).toEqual([
      expect.objectContaining({
        level: 'warn',
        tenant_id: T,
        channel: 'dashboard',
        flow: 'refine_prompt',
        http_status: 400,
        error_code: 'invalid_key',
        ref: expect.stringMatching(/^E-[0-9a-f]{8}$/),
      }),
    ]);
  });

  it('exception réseau → 500 inchangé, trace network_error', async () => {
    outcome = 'network';
    expect(await refine()).toEqual({ status: 500, body: { error: 'Erreur serveur' } });
    expect(failures()).toEqual([expect.objectContaining({ error_code: 'network_error' })]);
  });

  it.each([{ status: 400, body: googleError }, 'network' as const])(
    'aucune clé, URL, corps, projet ni prompt dans les journaux (%#)',
    async (o) => {
      outcome = o;
      await refine();
      const all = logLines().join('\n');
      for (const forbidden of [
        KEY,
        'AIza',
        'key=',
        'generativelanguage',
        'projects/123456789',
        'Request https',
        'Amine',
        '0550000001',
        'Nta agent',
      ]) {
        expect(all).not.toContain(forbidden);
      }
    }
  );
});
