// Erreurs génériques — routes restantes (MEGA TASK 3, phase 6).
// 1. Inventaire statique : aucune route n'envoie un `.message` brut au client.
// 2. Négatifs à l'exécution : la réponse ne contient ni le message, ni l'hôte,
//    ni le secret de l'exception ; le journal ne reçoit que le code + ref.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const LEAK = 'connect ECONNREFUSED 10.0.0.12:5432 password=TEST_DB_SECRET';

const logEvent = vi.fn((..._args: unknown[]) => undefined);
vi.mock('@/lib/security/safe-log', () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
  maskPhone: (p: string) => p,
}));

let throwOnFrom = true;
const fakeClient = {
  auth: { getUser: async () => ({ data: { user: { id: 'tenant-a', app_metadata: {} } } }) },
  from: () => {
    if (throwOnFrom) throw Object.assign(new Error(LEAK), { code: 'ECONNREFUSED' });
    return {};
  },
};
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => fakeClient,
  createServiceClient: () => fakeClient,
}));

beforeEach(() => {
  logEvent.mockClear();
  throwOnFrom = true;
});

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? routeFiles(p) : e.name === 'route.ts' ? [p] : [];
  });
}

// Lignes qui lisent `.message` sans l'envoyer au client.
const SAFE_LINE =
  /logEvent|event\.message|msgData\.message|\br\.message\b|error_message|err = e\?\.message/;
// Routes couvertes par CETTE PR. Les autres routes sont corrigées par leurs
// propres PR (#104, #110, #111, #117, #118, #120, #124 ; resolve et
// orders/deleted : commit ajouté sur #104 et #110) ; restant connu, documenté :
// aucun (campaigns/[id]/send corrigé ici).
const COVERED = new Set(
  [
    'admin/users',
    'ai-chatbot/diagnostic',
    'ai-chatbot/facebook',
    'ai-chatbot/reclamations/lookup',
    'ai-chatbot/whatsapp/instance',
    'autoswap/diagnostic',
    'autoswap/execute',
    'autoswap/preview',
    'autoswap/swapped-stats',
    'campaigns/[id]/send',
    'campaigns/delivered-customers',
    'stats',
    'sync-zrexpress',
    'track/[tracking]',
    'whatsapp/send',
  ].map((r) => `src/app/api/${r}/route.ts`)
);

describe('inventaire statique des routes API', () => {
  it("aucun `.message` d'exception dans une réponse (routes de cette PR)", () => {
    const root = path.join(process.cwd(), 'src', 'app', 'api');
    const offenders: string[] = [];
    for (const file of routeFiles(root)) {
      const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
      if (!COVERED.has(rel)) continue;
      fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (
            /\b(e|err|error|upErr|insErr|updateErr|instErr)\??\.message\b/.test(line) &&
            !SAFE_LINE.test(line)
          )
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
    expect([...COVERED].every((f) => fs.existsSync(path.join(process.cwd(), f)))).toBe(true);
  });
});

async function expectGeneric(res: Response) {
  expect(res.status).toBe(500);
  const text = await res.text();
  for (const leak of ['ECONNREFUSED', '10.0.0.12', 'TEST_DB_SECRET', 'password'])
    expect(text).not.toContain(leak);
  const body = JSON.parse(text);
  expect(body.error).toMatch(/Erreur interne/);
  expect(body.ref).toMatch(/^[0-9a-f]{8}$/);
  const logged = JSON.stringify(logEvent.mock.calls);
  expect(logged).toContain(body.ref);
  expect(logged).not.toContain('TEST_DB_SECRET');
}

describe('négatifs à l’exécution', () => {
  it('GET /api/track/<n> (PUBLIC) : exception base → message générique + ref', async () => {
    const { GET } = await import('@/app/api/track/[tracking]/route');
    const res = await GET(
      new NextRequest('http://localhost/api/track/TEST_TRACKING_A', {
        headers: { 'x-forwarded-for': '203.0.113.9' },
      }),
      { params: Promise.resolve({ tracking: 'TEST_TRACKING_A' }) }
    );
    await expectGeneric(res);
  });

  it('GET /api/stats (session) : exception base → message générique + ref', async () => {
    const { GET } = await import('@/app/api/stats/route');
    const res = await (GET as unknown as (r: NextRequest) => Promise<Response>)(
      new NextRequest('http://localhost/api/stats')
    );
    await expectGeneric(res);
  });
});
