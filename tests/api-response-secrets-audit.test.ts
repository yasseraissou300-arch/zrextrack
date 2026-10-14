// P4 — AUDIT (constat, aucun code modifié) : secrets renvoyés au navigateur.
//
// Base : main local (ae4428c). Valeurs FACTICES identifiables (TEST_*_A / _B).
// Chaque test suit DB → résultat Supabase → NextResponse.json et regarde ce
// qui arrive RÉELLEMENT dans le corps HTTP. Les expositions déjà corrigées sur
// une branche non mergée sont testées en DEUX ÉTATS (constat sur main / valeur
// absente quand le correctif est présent) pour rester vertes en fusion d'essai.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
let currentUser = '';
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser ? { id: currentUser } : null } }) },
    from: (t: string) => db.from(t),
  }),
}));
vi.mock('@/lib/user-creds', async (orig) => ({
  ...(await orig<typeof import('@/lib/user-creds')>()),
  resolveEvolutionCreds: async () => ({ url: 'https://evolution.test', key: 'TEST_EVOLUTION_KEY' }),
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  db = new FakeSupabase();
  currentUser = A;
  vi.resetModules();
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  db.seed('public', 'integrations', [
    {
      id: 'i-a',
      user_id: A,
      platform: 'shopify',
      identifier: 'a.myshopify.com',
      secret_key: 'TEST_SHOPIFY_SECRET_A',
      active: true,
      created_at: '2026-01-01',
    },
    {
      id: 'i-b',
      user_id: B,
      platform: 'shopify',
      identifier: 'b.myshopify.com',
      secret_key: 'TEST_SHOPIFY_SECRET_B',
      active: true,
      created_at: '2026-01-01',
    },
  ]);
  db.seed('public', 'user_sync_settings', [
    {
      user_id: A,
      zrexpress_token: 'TEST_ZR_TOKEN_A',
      zrexpress_tenant_id: 'tenant-a',
      templates: {},
      notify_enabled: {},
    },
    {
      user_id: B,
      zrexpress_token: 'TEST_ZR_TOKEN_B',
      zrexpress_tenant_id: 'tenant-b',
      templates: {},
      notify_enabled: {},
    },
  ]);
  db.seed('public', 'facebook_connections', [
    {
      user_id: A,
      page_id: '',
      page_name: '',
      page_picture: '',
      verify_token: 'TEST_VERIFY_TOKEN_A',
      connected: false,
      page_access_token: '',
      pending_pages: JSON.stringify([
        { id: 'p1', name: 'Page A', access_token: 'TEST_PAGE_TOKEN_A', picture: '' },
      ]),
    },
    {
      user_id: B,
      page_id: 'pb',
      page_name: 'Page B',
      verify_token: 'TEST_VERIFY_TOKEN_B',
      connected: true,
      page_access_token: 'TEST_PAGE_TOKEN_B',
      pending_pages: null,
    },
  ]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const body = async (res: Response) => JSON.stringify(await res.json());

// ─── 1. /api/integrations — secret HMAC Shopify/WooCommerce ─────────────────
//
// 1a. Constat en DEUX ÉTATS : sur main (ae4428c) le secret part en clair ;
//     avec claude/p4-integrations-no-secrets il ne part plus.
// 1b. Spécification CIBLE (stricte) : échoue sur main, passe avec le correctif.

describe('/api/integrations — constat (deux états)', () => {
  it('GET (A) : secret de A en clair sur main / absent après correctif ; jamais celui de B', async () => {
    const { GET } = await import('@/app/api/integrations/route');
    const res = await body(await GET());
    expect(res).not.toContain('TEST_SHOPIFY_SECRET_B');
    expect(res).not.toContain('b.myshopify.com');
    if (res.includes('TEST_SHOPIFY_SECRET_A')) {
      expect(JSON.parse(res).data[0].secret_key).toBe('TEST_SHOPIFY_SECRET_A'); // S3 sur main
    } else {
      expect(res).not.toContain('secret_key');
    }
  });

  it('POST (A) : ligne renvoyée avec le secret sur main / sans le secret après correctif', async () => {
    const { POST } = await import('@/app/api/integrations/route');
    const res = await body(
      await POST(
        new NextRequest('https://app.test/api/integrations', {
          method: 'POST',
          body: JSON.stringify({
            platform: 'woocommerce',
            identifier: 'a.shop',
            secret_key: 'TEST_WOO_SECRET_A',
          }),
        })
      )
    );
    if (res.includes('TEST_WOO_SECRET_A')) {
      expect(JSON.parse(res).data.secret_key).toBe('TEST_WOO_SECRET_A'); // S3 sur main
    } else {
      expect(res).not.toContain('secret_key');
    }
  });
});

describe('/api/integrations — spécification cible (aucun secret au navigateur)', () => {
  const SECRETS = ['TEST_SHOPIFY_SECRET_A', 'TEST_WOOCOMMERCE_SECRET_A', 'TEST_SHOPIFY_SECRET_B'];
  const PUBLIC_KEYS = [
    'active',
    'created_at',
    'id',
    'identifier',
    'last_sync',
    'orders_synced',
    'platform',
    'secret_configured',
    'updated_at',
  ];

  beforeEach(() => {
    db.seed('public', 'integrations', [
      {
        id: 'i-a2',
        user_id: A,
        platform: 'woocommerce',
        identifier: 'https://a.shop',
        secret_key: 'TEST_WOOCOMMERCE_SECRET_A',
        active: true,
        orders_synced: 3,
        last_sync: null,
        created_at: '2026-01-02',
        updated_at: '2026-01-02',
      },
      {
        id: 'i-a3',
        user_id: A,
        platform: 'google_sheets',
        identifier: 'sheet-id',
        secret_key: '',
        active: true,
        orders_synced: 0,
        last_sync: null,
        created_at: '2026-01-03',
        updated_at: '2026-01-03',
      },
    ]);
  });

  it('GET : secret_configured correct, aucun secret (A ni B), uniquement des champs publics', async () => {
    const { GET } = await import('@/app/api/integrations/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    const text = JSON.stringify(json);
    for (const sct of SECRETS) expect(text).not.toContain(sct);
    expect(text).not.toContain('secret_key');
    const byPlatform = Object.fromEntries(
      (json.data as Array<Record<string, unknown>>).map((r) => [r.platform, r])
    );
    expect(Object.keys(byPlatform).sort()).toEqual(['google_sheets', 'shopify', 'woocommerce']); // A seulement
    expect(byPlatform.shopify.secret_configured).toBe(true);
    expect(byPlatform.woocommerce.secret_configured).toBe(true);
    expect(byPlatform.google_sheets.secret_configured).toBe(false);
    for (const row of json.data as Array<Record<string, unknown>>) {
      expect(Object.keys(row).every((k) => PUBLIC_KEYS.includes(k))).toBe(true);
    }
    // Champs utilisés par l'interface (src/app/integrations/page.tsx) toujours présents.
    expect(byPlatform.woocommerce).toMatchObject({
      id: 'i-a2',
      identifier: 'https://a.shop',
      active: true,
      orders_synced: 3,
    });
  });

  it('POST : enregistrement fonctionnel (secret STOCKÉ en base), réponse sans secret, secret_configured=true', async () => {
    const { POST } = await import('@/app/api/integrations/route');
    const res = await POST(
      new NextRequest('https://app.test/api/integrations', {
        method: 'POST',
        body: JSON.stringify({
          platform: 'shopify',
          identifier: 'a2.myshopify.com',
          secret_key: 'TEST_SHOPIFY_SECRET_A2',
        }),
      })
    );
    expect(res.status).toBe(200);
    const text = await body(res);
    expect(text).not.toContain('TEST_SHOPIFY_SECRET_A2');
    expect(text).not.toContain('secret_key');
    const json = JSON.parse(text);
    expect(json.data).toMatchObject({
      platform: 'shopify',
      identifier: 'a2.myshopify.com',
      active: true,
      secret_configured: true,
    });
    const stored = db
      .all('public', 'integrations')
      .find((r) => r.user_id === A && r.platform === 'shopify');
    expect(stored?.secret_key).toBe('TEST_SHOPIFY_SECRET_A2'); // le serveur garde le secret
    expect(db.all('public', 'integrations').find((r) => r.user_id === B)?.secret_key).toBe(
      'TEST_SHOPIFY_SECRET_B'
    );
  });

  it('POST sans secret : secret_configured=false (comportement de stockage inchangé)', async () => {
    const { POST } = await import('@/app/api/integrations/route');
    const json = await (
      await POST(
        new NextRequest('https://app.test/api/integrations', {
          method: 'POST',
          body: JSON.stringify({ platform: 'woocommerce', identifier: 'https://a.shop' }),
        })
      )
    ).json();
    expect(json.data.secret_configured).toBe(false);
  });

  it('POST en erreur base : message GÉNÉRIQUE, ni secret, ni message PostgREST/SQL', async () => {
    db.failNext('public', 'integrations', 'upsert', {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "integrations_user_id_platform_key" secret=TEST_SHOPIFY_SECRET_A3',
    });
    const { POST } = await import('@/app/api/integrations/route');
    const res = await POST(
      new NextRequest('https://app.test/api/integrations', {
        method: 'POST',
        body: JSON.stringify({
          platform: 'shopify',
          identifier: 'x',
          secret_key: 'TEST_SHOPIFY_SECRET_A3',
        }),
      })
    );
    expect(res.status).toBe(500);
    const text = await body(res);
    for (const forbidden of [
      'TEST_SHOPIFY_SECRET_A3',
      'duplicate key',
      'constraint',
      'integrations_',
      '23505',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    // Les journaux serveur gardent le code d'erreur, jamais le secret.
    const logs = (['log', 'info', 'warn', 'error'] as const)
      .flatMap((m) =>
        (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
          c.map(String).join(' ')
        )
      )
      .join('\n');
    expect(logs).not.toContain('TEST_SHOPIFY_SECRET_A3');
  });
});

// ─── 2. /api/sync-settings — jeton ZRExpress (corrigé : p2-zr-token-server-side) ─

describe('/api/sync-settings GET — jeton ZRExpress', () => {
  it('main : jeton de A en clair (constat) / après correctif : absent ; jamais celui de B', async () => {
    const { GET } = await import('@/app/api/sync-settings/route');
    const res = await body(await GET());
    expect(res).not.toContain('TEST_ZR_TOKEN_B');
    if (res.includes('TEST_ZR_TOKEN_A')) {
      expect(JSON.parse(res).settings.zrexpress_token).toBe('TEST_ZR_TOKEN_A'); // S3 sur main
    } else {
      expect(res).not.toContain('TEST_ZR_TOKEN'); // correctif présent
    }
  });
});

// ─── 3. /api/ai-chatbot/facebook GET — jetons des pages en attente ───────────
//        (corrigé : p2-facebook-tokens / p2-facebook-tokens-sealed)

describe('/api/ai-chatbot/facebook GET — pending_pages', () => {
  it('main : access_token de chaque page renvoyé (constat) / après correctif : absent ; jamais B', async () => {
    const { GET } = await import('@/app/api/ai-chatbot/facebook/route');
    const res = await body(await GET());
    expect(res).not.toContain('TEST_PAGE_TOKEN_B');
    expect(res).not.toContain('TEST_VERIFY_TOKEN_B');
    if (res.includes('TEST_PAGE_TOKEN_A')) {
      expect(JSON.parse(res).pending_pages[0].access_token).toBe('TEST_PAGE_TOKEN_A'); // S3 sur main
    } else {
      // correctif présent : aucune page renvoyée ne porte de jeton. (La base
      // simulée ignore la liste de colonnes du select : on ne juge donc que
      // pending_pages et les valeurs, pas la présence d'une clé vide.)
      const pages = JSON.parse(res).pending_pages as Array<Record<string, unknown>>;
      expect(pages.every((p) => !('access_token' in p))).toBe(true);
      expect(res).not.toContain('TEST_PAGE_TOKEN');
    }
    // verify_token de A : nécessaire à la configuration manuelle du webhook Meta (S1).
    expect(res).toContain('TEST_VERIFY_TOKEN_A');
  });
});

// ─── 4. webhook-reset — secret GLOBAL du webhook WhatsApp ────────────────────
//        (corrigé : p1-webhook-reset-no-secret 12e)

describe('POST /api/ai-chatbot/whatsapp/webhook-reset — secret plateforme', () => {
  it('main : WHATSAPP_WEBHOOK_SECRET renvoyé à TOUT marchand (S4, latent) / après correctif : masqué', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_SECRET', 'TEST_GLOBAL_WEBHOOK_SECRET');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test');
    db.seed('public', 'whatsapp_instances', [
      {
        user_id: A,
        instance_name: 'zrex_a_auto',
        service_type: 'auto_confirmation',
        connected: true,
      },
    ]);
    let registered = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/webhook/set/')) {
          const b = JSON.parse(String(init?.body));
          registered = b.url ?? b.webhook?.url ?? '';
          return new Response(JSON.stringify({ url: registered }), { status: 200 });
        }
        if (url.includes('/webhook/find/')) {
          return Response.json({
            url: registered,
            events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
          });
        }
        return new Response('{}');
      })
    );
    const { POST } = await import('@/app/api/ai-chatbot/whatsapp/webhook-reset/route');
    const res = await body(
      await POST(
        new NextRequest('https://app.test/api/ai-chatbot/whatsapp/webhook-reset', {
          method: 'POST',
        })
      )
    );
    // Le secret est bien enregistré chez Evolution (comportement voulu)…
    expect(registered).toContain('TEST_GLOBAL_WEBHOOK_SECRET');
    if (res.includes('TEST_GLOBAL_WEBHOOK_SECRET')) {
      // …mais sur main il revient aussi au NAVIGATEUR du marchand.
      expect(JSON.parse(res).webhook_url_sent).toContain('token=TEST_GLOBAL_WEBHOOK_SECRET');
    } else {
      expect(res).not.toContain('TEST_GLOBAL_WEBHOOK_SECRET');
    }
  });
});

// ─── 5. Témoins : routes qui masquent déjà ──────────────────────────────────

describe('témoins — masquage déjà en place sur main', () => {
  it('/api/voice-calls/settings GET : auth_token masqué (4 derniers caractères seulement)', async () => {
    db.seed('public', 'voice_call_settings', [
      { user_id: A, account_sid: 'ACtest', auth_token: 'TEST_TWILIO_TOKEN_A_9876' },
    ]);
    const { GET } = await import('@/app/api/voice-calls/settings/route');
    const res = await body(await GET());
    expect(res).not.toContain('TEST_TWILIO_TOKEN_A');
    expect(res).toContain('9876');
  });

  it('/api/user-credentials GET : clé API jamais en clair, api_secret jamais renvoyé', async () => {
    db.seed('public', 'user_api_credentials', [
      {
        user_id: A,
        service: 'gemini',
        api_key: 'TEST_GEMINI_KEY_A_123456',
        api_url: null,
        api_secret: 'TEST_API_SECRET_A',
        is_active: true,
      },
      {
        user_id: B,
        service: 'gemini',
        api_key: 'TEST_GEMINI_KEY_B_654321',
        api_url: null,
        api_secret: 'TEST_API_SECRET_B',
        is_active: true,
      },
    ]);
    const { GET } = await import('@/app/api/user-credentials/route');
    const res = await body(await GET());
    for (const s of [
      'TEST_GEMINI_KEY_A_123456',
      'TEST_API_SECRET_A',
      'TEST_GEMINI_KEY_B',
      'TEST_API_SECRET_B',
    ]) {
      expect(res).not.toContain(s);
    }
  });
});
