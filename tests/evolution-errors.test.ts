// P3 — Réponses d'Evolution : aucune valeur brute ne part au client, ni dans
// messages.error_message, ni dans autotim.jobs.last_error.
//
// Corps d'erreur réalistes, entièrement SYNTHÉTIQUES (hôtes, jetons, numéros
// inventés) :
//   - page du proxy qui nomme l'hôte Evolution (Railway / Cloudflare)
//   - erreur Prisma d'Evolution : chemin interne + requête
//   - réponse 400 qui répète le numéro / JID du destinataire
//   - réponse /instance/create : `hash` = jeton de l'instance
//   - réponse /webhook/set qui répète l'URL avec le secret GLOBAL, encodée

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const EVO = 'https://evo-secret-host-7f3a.up.railway.app';
const EVO_HOST = 'evo-secret-host-7f3a';
const INSTANCE_TOKEN = 'A1B2C3D4-SYNTH-INSTANCE-TOKEN-9Z8Y7X';
const WEBHOOK_SECRET = 'whsec_SYNTHETIC_global_secret_42';

const BODIES = {
  proxy: `<!DOCTYPE html><html><head><title>502</title></head><body>Application failed to respond — ${EVO_HOST}.up.railway.app request id 8f2c</body></html>`,
  prisma:
    '{"status":500,"error":"Internal Server Error","response":{"message":["PrismaClientKnownRequestError: \\nInvalid `this.prismaRepository.message.create()` invocation in\\n/evolution/dist/main.js:283:9921 Unique constraint failed on the fields: (`keyId`)"]}}',
  notOnWhatsapp:
    '{"status":400,"error":"Bad Request","response":{"message":[{"jid":"213555000111@s.whatsapp.net","exists":false,"number":"213555000111"}]}}',
  closed:
    '{"status":500,"error":"Internal Server Error","response":{"message":["Error: Connection Closed"]}}',
};
const LEAKS = [
  EVO_HOST,
  'railway',
  'prisma',
  '/evolution/dist',
  'main.js',
  'keyId',
  '213555000111',
  INSTANCE_TOKEN,
  WEBHOOK_SECRET,
];

function expectNoLeak(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const needle of LEAKS) expect(text.toLowerCase()).not.toContain(needle.toLowerCase());
}

let logs: string[];
beforeEach(() => {
  logs = [];
  for (const m of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logs.push(String(args[0]));
    });
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

// ─── Module ──────────────────────────────────────────────────────────────────

import {
  classifyEvolutionError,
  evolutionErrorMessage,
  describeEvolutionBody,
} from '@/lib/whatsapp/evolution-error';
import { qrToDataUrl } from '@/lib/whatsapp/qr-data-url';

describe('classifyEvolutionError', () => {
  it.each([
    [500, BODIES.closed, 'session_closed'],
    [400, BODIES.notOnWhatsapp, 'number_not_on_whatsapp'],
    [401, '{"response":{"message":"Unauthorized"}}', 'unauthorized'],
    [404, 'The "zrex_x_auto" instance does not exist', 'instance_not_found'],
    [429, '', 'rate_limited'],
    [400, '{"error":"Bad Request"}', 'rejected'],
    [500, BODIES.prisma, 'server_error'],
    [502, BODIES.proxy, 'server_error'],
  ])('HTTP %i → %s', (status, body, kind) => {
    expect(classifyEvolutionError(status, body)).toBe(kind);
  });
});

describe('evolutionErrorMessage', () => {
  it.each(Object.entries(BODIES))(
    '%s : message sûr, détail assaini côté serveur sous la même réf',
    (_k, body) => {
      const r = evolutionErrorMessage('test.scope', 502, body);
      expect(r.message).toMatch(/^Evolution HTTP 502 — .+ \(réf E-[0-9a-f]{8}\)$/);
      expectNoLeak(r.message);
      const log = logs.map((l) => JSON.parse(l)).find((l) => l.ref === r.ref);
      expect(log).toMatchObject({ scope: 'test.scope', http_status: 502, error_code: r.kind });
      expect(log.reason).not.toContain('213555000111'); // numéro masqué même en journal
    }
  );
});

describe('describeEvolutionBody', () => {
  it('réponse /instance/create : clés seulement, jamais le jeton', () => {
    const d = describeEvolutionBody({
      instance: { instanceName: 'zrex_x_auto', instanceId: 'uuid-x', status: 'created' },
      hash: INSTANCE_TOKEN,
      settings: { rejectCall: false },
    });
    expect(d).toEqual({ keys: ['instance', 'hash', 'settings'] });
    expectNoLeak(d);
  });
  it('état de connexion conservé (utile au diagnostic)', () => {
    expect(describeEvolutionBody({ instance: { state: 'close' } })).toEqual({
      keys: ['instance'],
      state: 'close',
    });
  });
});

describe('qrToDataUrl', () => {
  it('URL sur l’hôte Evolution : téléchargée côté serveur, clé envoyée, data URL rendue', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await qrToDataUrl(`${EVO}/qr/zrex.png`, EVO, { apikey: 'k' });
    expect(out).toBe('data:image/png;base64,iVBORw==');
    expect(fetchMock).toHaveBeenCalledWith(
      `${EVO}/qr/zrex.png`,
      expect.objectContaining({ headers: { apikey: 'k' } })
    );
  });
  it('URL d’un autre hôte : inchangée, AUCUN appel (la clé ne sort jamais)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await qrToDataUrl('https://cdn.example/qr.png', EVO, { apikey: 'k' })).toBe(
      'https://cdn.example/qr.png'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('réponse non-image : refusée', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }))
    );
    expect(await qrToDataUrl(`${EVO}/qr`, EVO, {})).toBeNull();
  });
  it('base64 brut et data URL : comportement inchangé', async () => {
    expect(await qrToDataUrl('data:image/png;base64,AAA', EVO, {})).toBe(
      'data:image/png;base64,AAA'
    );
    expect(await qrToDataUrl('AAA', EVO, {})).toBe('data:image/png;base64,AAA');
  });
});

// ─── Routes et file : ancien code = fuite, nouveau code = message sûr ────────

type Result = { data: unknown; error: unknown };
const db: { instances: unknown[]; single: unknown } = { instances: [], single: null };
function chain(result: () => Result): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then')
          return (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
        if (prop === 'single' || prop === 'maybeSingle') {
          return () => ({
            then: (res: (v: unknown) => unknown) =>
              Promise.resolve({ data: db.single, error: null }).then(res),
          });
        }
        return () => proxy;
      },
    }
  );
  return proxy;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    from: () => chain(() => ({ data: db.instances, error: null })),
  }),
  createServiceClient: () => ({ from: () => chain(() => ({ data: null, error: null })) }),
}));
vi.mock('@/lib/user-creds', async (orig) => ({
  ...((await orig()) as object),
  resolveEvolutionCreds: async () => ({ url: EVO, key: 'global-key' }),
}));

/** Evolution simulé : chemin → [statut, corps, type]. */
function evolution(routes: Record<string, [number, string, string?]>) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    const path = url.startsWith(EVO) ? url.slice(EVO.length).split('?')[0] : url;
    const hit = Object.entries(routes).find(([p]) => path.startsWith(p));
    if (!hit) return new Response('{}', { status: 404 });
    const [status, body, type = 'application/json'] = hit[1];
    return new Response(body, { status, headers: { 'content-type': type } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('GET /api/ai-chatbot/whatsapp/qr', () => {
  beforeEach(() => {
    db.single = { instance_name: 'zrex_x_auto', connected: false };
  });

  it('création OK sans QR exploitable : le debug ne contient PAS le jeton d’instance', async () => {
    evolution({
      '/instance/connectionState/': [200, '{"instance":{"state":"close"}}'],
      '/instance/connect/': [404, BODIES.proxy, 'text/html'],
      '/instance/create': [
        201,
        JSON.stringify({
          instance: { instanceName: 'zrex_x_auto' },
          hash: INSTANCE_TOKEN,
          qrcode: {},
        }),
      ],
    });
    const { GET } = await import('@/app/api/ai-chatbot/whatsapp/qr/route');
    const res = await GET(new NextRequest('https://app.test/api/ai-chatbot/whatsapp/qr'));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.debug.createJson).toEqual({ keys: ['instance', 'hash', 'qrcode'] });
    expectNoLeak(body);
  });

  it('création refusée : page du proxy classée, pas relayée', async () => {
    evolution({
      '/instance/connectionState/': [502, BODIES.proxy, 'text/html'],
      '/instance/connect/': [502, BODIES.proxy, 'text/html'],
      '/instance/create': [502, BODIES.proxy, 'text/html'],
    });
    const { GET } = await import('@/app/api/ai-chatbot/whatsapp/qr/route');
    const body = await (
      await GET(new NextRequest('https://app.test/api/ai-chatbot/whatsapp/qr'))
    ).json();
    expect(body.debug.createError).toMatch(/^Evolution HTTP 502 — /);
    expectNoLeak(body);
  });

  it('QR renvoyé sous forme d’URL Evolution : servi en data URL, hôte absent', async () => {
    evolution({
      '/instance/connectionState/': [200, '{"instance":{"state":"close"}}'],
      '/instance/connect/': [200, JSON.stringify({ base64: `${EVO}/qr/zrex_x_auto.png` })],
      '/qr/': [200, 'PNGDATA', 'image/png'],
    });
    const { GET } = await import('@/app/api/ai-chatbot/whatsapp/qr/route');
    const body = await (
      await GET(new NextRequest('https://app.test/api/ai-chatbot/whatsapp/qr'))
    ).json();
    expect(body.qr).toMatch(/^data:image\/png;base64,/);
    expectNoLeak(body);
  });
});

describe('POST /api/ai-chatbot/whatsapp/webhook-reset', () => {
  it('Evolution répète l’URL avec le secret GLOBAL (encodages variés) : jamais relayé', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_SECRET', WEBHOOK_SECRET);
    db.instances = [{ instance_name: 'zrex_x_auto', service_type: 'auto_confirmation' }];
    const echoed = `https://app.test/api/ai-chatbot/webhook/whatsapp?x=1\\u0026token=${WEBHOOK_SECRET}`;
    evolution({
      '/webhook/set/': [
        400,
        JSON.stringify({
          error: 'Bad Request',
          response: { message: [`invalid url ${echoed} %3Ftoken%3D${WEBHOOK_SECRET}`] },
        }),
      ],
      '/webhook/find/': [200, JSON.stringify({ url: null, events: null })],
    });
    const { POST } = await import('@/app/api/ai-chatbot/whatsapp/webhook-reset/route');
    const res = await POST(
      new NextRequest('https://app.test/api/ai-chatbot/whatsapp/webhook-reset', { method: 'POST' })
    );
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('Evolution HTTP 400');
    expectNoLeak(body);
  });

  it('succès : seules les clés de la réponse sortent (l’URL enregistrée contient le secret)', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_SECRET', WEBHOOK_SECRET);
    db.instances = [{ instance_name: 'zrex_x_auto', service_type: 'auto_confirmation' }];
    evolution({
      '/webhook/set/': [
        201,
        JSON.stringify({
          webhook: { url: `https://app.test/x?a=b\\u0026token=${WEBHOOK_SECRET}`, enabled: true },
        }),
      ],
      '/webhook/find/': [200, JSON.stringify({ url: null, events: null })],
    });
    const { POST } = await import('@/app/api/ai-chatbot/whatsapp/webhook-reset/route');
    const body = await (
      await POST(
        new NextRequest('https://app.test/api/ai-chatbot/whatsapp/webhook-reset', {
          method: 'POST',
        })
      )
    ).json();
    expectNoLeak(body);
  });
});

// ─── Verrou statique ─────────────────────────────────────────────────────────

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('verrou statique — src/**', () => {
  it('aucun corps de réponse Evolution concaténé dans un message (`Evolution HTTP ${…}: ${…}`)', () => {
    const SRC = path.resolve(__dirname, '../src');
    const offenders = files(SRC).filter((f) =>
      /Evolution HTTP \$\{[^}]+\}\s*:\s*\$\{/.test(readFileSync(f, 'utf8'))
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
