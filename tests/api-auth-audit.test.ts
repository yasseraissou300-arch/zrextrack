// P4 — Audit global d'authentification des routes d'API.
//
// Le middleware classe TOUT /api/ en public : chaque route doit se protéger
// elle-même. Ce fichier :
//   1. impose une CLASSIFICATION explicite de chaque route (session, machine,
//      public) — une route nouvelle non classée fait échouer la suite ;
//   2. appelle RÉELLEMENT chaque méthode exportée (base en mémoire, réseau
//      simulé) : anonyme, cookie invalide, session d'un autre compte avec les
//      identifiants (user_id, tenant_id, clé ZR) d'une victime dans le corps,
//      et accès par id aux lignes de la victime (IDOR) ;
//   3. vérifie les routes machine (secret présent / absent / faux) et les deux
//      exceptions publiques.
//
// CLIQUET : les écarts CONNUS sur main (9c2b249) sont listés avec le commit
// qui les corrige. Un écart nouveau fait échouer ; un écart corrigé est accepté
// (la fusion d'essai avec les correctifs reste verte) — retirer alors l'entrée.
// Données entièrement synthétiques.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import {
  routeFiles,
  routeName,
  callRoute,
  makeFetchRecorder,
  ALL_METHODS,
  type Outgoing,
} from './helpers/api-sweep';

let db: FakeSupabase;
let session: { user: { id: string } | null; error: { message: string } | null } = {
  user: null,
  error: null,
};
const anyProxy = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, p) => (p === 'then' ? undefined : anyProxy()),
    apply: () => anyProxy(),
  });

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: session.user }, error: session.error }) },
    from: (t: string) => db.from(t),
    schema: (s: string) => db.schema(s),
    storage: anyProxy(),
  }),
  createServiceClient: () => Object.assign(Object.create(db), { storage: anyProxy() }),
}));

const VICTIM = '99999999-9999-4999-8999-999999999999';
const ATTACKER = '22222222-2222-4222-8222-222222222222';
const VICTIM_ZR_KEY = 'ZR-KEY-VICTIM-0001';
const VICTIM_ZR_TENANT = 'zr-tenant-victim';
const MARK = 'VICTIM-SECRET-DATA';
const INJECTED_BODY = {
  token: VICTIM_ZR_KEY,
  tenantId: VICTIM_ZR_TENANT,
  user_id: VICTIM,
  userId: VICTIM,
  tenant_id: VICTIM,
  id: 'victim-row',
  ids: ['victim-row'],
};
const INJECTED_QUERY = { user_id: VICTIM, tenant_id: VICTIM, tenantId: VICTIM_ZR_TENANT };

// ─── 1. Classification ───────────────────────────────────────────────────────

type Kind = 'session' | 'admin' | 'machine' | 'public';
const CLASSIFICATION: Record<string, { kind: Kind; why: string }> = {
  'admin/users': { kind: 'admin', why: 'session + requireAdmin' },
  'ai-chatbot/analytics': { kind: 'session', why: 'statistiques du tenant' },
  'ai-chatbot/config': { kind: 'session', why: 'configuration du bot' },
  'ai-chatbot/diagnostic': { kind: 'session', why: 'diagnostic Evolution du tenant' },
  'ai-chatbot/facebook': { kind: 'session', why: 'pages Facebook du tenant' },
  'ai-chatbot/facebook/oauth': {
    kind: 'session',
    why: 'démarrage OAuth (redirection /login sinon)',
  },
  'ai-chatbot/facebook/callback': {
    kind: 'machine',
    why: 'retour OAuth Meta : state signé (P0-2)',
  },
  'ai-chatbot/googlesheets': { kind: 'session', why: 'URL Sheets du tenant' },
  'ai-chatbot/googlesheets/test': { kind: 'session', why: 'test d’envoi Sheets' },
  'ai-chatbot/reclamations/lookup': { kind: 'session', why: 'lecture ZR du tenant' },
  'ai-chatbot/reclamations/resolve': { kind: 'session', why: 'résolution SAV + WhatsApp' },
  'ai-chatbot/refine-prompt': { kind: 'session', why: 'Gemini BYOK du tenant' },
  'ai-chatbot/relance': { kind: 'machine', why: 'CRON_SECRET (tous tenants) ou session (P1-8)' },
  'ai-chatbot/sessions': { kind: 'session', why: 'conversations du tenant' },
  'ai-chatbot/webhook/facebook': { kind: 'machine', why: 'Meta : verify_token + signature (P0-1)' },
  'ai-chatbot/webhook/whatsapp': { kind: 'machine', why: 'Evolution : secret partagé (HUMAN-005)' },
  'ai-chatbot/whatsapp/instance': { kind: 'session', why: 'instances WhatsApp du tenant' },
  'ai-chatbot/whatsapp/qr': { kind: 'session', why: 'QR de connexion' },
  'ai-chatbot/whatsapp/status': { kind: 'session', why: 'état de l’instance' },
  'ai-chatbot/whatsapp/webhook-reset': { kind: 'session', why: 'réenregistrement des webhooks' },
  'auth/me': { kind: 'session', why: 'profil' },
  'autoswap/diagnostic': { kind: 'session', why: 'lecture ZR du tenant' },
  'autoswap/equivalences': { kind: 'session', why: 'équivalences du tenant' },
  'autoswap/execute': { kind: 'session', why: 'swaps ZR (écriture externe)' },
  'autoswap/preview': { kind: 'session', why: 'lecture ZR du tenant' },
  'autoswap/swapped-stats': { kind: 'session', why: 'lecture ZR du tenant' },
  campaigns: { kind: 'session', why: 'campagnes du tenant' },
  'campaigns/[id]': { kind: 'session', why: 'campagne du tenant' },
  'campaigns/[id]/send': { kind: 'session', why: 'envoi de campagne' },
  'campaigns/delivered-customers': { kind: 'session', why: 'lecture ZR du tenant' },
  'campaigns/media/upload': { kind: 'session', why: 'stockage du tenant' },
  chatbot: { kind: 'session', why: 'assistant Gemini' },
  'cron/tick': { kind: 'machine', why: 'CRON_TICK_SECRET (cron-job.org)' },
  health: { kind: 'public', why: 'sonde de disponibilité (UptimeRobot)' },
  integrations: { kind: 'session', why: 'intégrations du tenant' },
  'integrations/shopify/webhook': { kind: 'machine', why: 'HMAC Shopify (secret par intégration)' },
  'integrations/woocommerce/webhook': {
    kind: 'machine',
    why: 'HMAC WooCommerce (secret par intégration)',
  },
  jobs: { kind: 'session', why: 'file du tenant' },
  kpis: { kind: 'session', why: 'indicateurs' },
  messages: { kind: 'session', why: 'journal d’envois' },
  'onboarding/state': { kind: 'session', why: 'état d’accueil' },
  orders: { kind: 'session', why: 'commandes' },
  'orders/view': { kind: 'session', why: 'vues de pages (ajoutée par p1-rls-pages-via-api)' },
  'orders/clear-all': { kind: 'session', why: 'corbeille' },
  'orders/delete': { kind: 'session', why: 'corbeille' },
  'orders/delete-permanent': { kind: 'session', why: 'suppression définitive' },
  'orders/deleted': { kind: 'session', why: 'corbeille' },
  'orders/reclassify': { kind: 'session', why: 'recalcul des statuts' },
  'orders/restore': { kind: 'session', why: 'corbeille' },
  'quotas/state': { kind: 'session', why: 'quotas' },
  stats: { kind: 'session', why: 'statistiques' },
  'sync-settings': { kind: 'session', why: 'clé ZR du tenant' },
  'sync-zrexpress': { kind: 'session', why: 'synchronisation ZR → orders' },
  'sync/preferences': { kind: 'session', why: 'source de synchronisation' },
  templates: { kind: 'session', why: 'modèles de messages' },
  'track/[tracking]': { kind: 'public', why: 'suivi pour l’acheteur final' },
  'user-credentials': { kind: 'session', why: 'clés BYOK' },
  'voice-calls/gather': { kind: 'machine', why: 'signature Twilio' },
  'voice-calls/list': { kind: 'session', why: 'appels du tenant' },
  'voice-calls/settings': { kind: 'session', why: 'identifiants Twilio' },
  'voice-calls/start': { kind: 'session', why: 'déclenche un appel' },
  'voice-calls/status': { kind: 'machine', why: 'signature Twilio' },
  'voice-calls/twiml': { kind: 'machine', why: 'signature Twilio' },
  'whatsapp/send': { kind: 'session', why: 'envoi manuel' },
  'whatsapp/status': { kind: 'session', why: 'état WhatsApp' },
  'whatsapp/warmup': { kind: 'session', why: 'warm-up' },
};

// ─── Écarts CONNUS sur main 9c2b249 (cliquet) ────────────────────────────────

/** Appel anonyme ou cookie invalide accepté sur une route « session ». */
const KNOWN_ANON_GAPS: Record<string, string> = {
  'POST autoswap/preview': 'cca0b0a (p2-zr-token-server-side)',
  'POST autoswap/diagnostic': 'cca0b0a (p2-zr-token-server-side)',
  'POST sync-zrexpress': 'd2c9d56 (p1-sync-requires-auth) + cca0b0a',
};

/** Identifiants d'un autre compte pris dans le corps (clé/tenant ZR). */
const KNOWN_BODY_TRUST: Record<string, string> = {
  'POST autoswap/preview': 'cca0b0a',
  'POST autoswap/diagnostic': 'cca0b0a',
  'POST autoswap/swapped-stats': 'cca0b0a',
  'POST campaigns/delivered-customers': 'cca0b0a',
  'POST sync-zrexpress': 'cca0b0a',
};

/** Routes machine / publiques : écarts connus. */
const KNOWN_MACHINE_GAPS: Record<string, string> = {
  'relance: CRON_SECRET absent → déclenchement anonyme': '261f209 (p1-relance-sav-hardening)',
  'shopify: secret_key vide → commande forgée acceptée': 'b90f515 (p4-shopify-woo-auth)',
  'woocommerce: secret_key vide → commande forgée acceptée': 'b90f515 (p4-shopify-woo-auth)',
  'track: jokers SQL (% _) transmis à ILIKE → énumération': 'ae4428c (p4-track-wildcard)',
  'health: message PostgREST renvoyé au public': '5b94c79 (p3-safe-errors)',
};

const stale = new Set<string>();
const validationBeforeAuth = new Set<string>();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

let rec: ReturnType<typeof makeFetchRecorder>;
beforeEach(() => {
  db = new FakeSupabase();
  session = { user: null, error: null };
  rec = makeFetchRecorder();
  vi.stubGlobal('fetch', rec.fn);
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  vi.stubEnv('EVOLUTION_API_URL', 'https://evolution.test');
  vi.stubEnv('EVOLUTION_API_KEY', 'evolution-global-test');
});

const FILES = routeFiles().sort();
const byKind = (k: Kind[]) => FILES.filter((f) => k.includes(CLASSIFICATION[routeName(f)]?.kind));
const touchesVictim = (out: Outgoing[]) =>
  out.some((o) => {
    const s = JSON.stringify(o);
    return s.includes(VICTIM_ZR_KEY) || s.includes(VICTIM_ZR_TENANT);
  });

describe('1 — classification', () => {
  it('chaque route d’API est classée explicitement (aucune route nouvelle sans décision)', () => {
    const missing = FILES.map(routeName).filter((r) => !CLASSIFICATION[r]);
    expect(missing).toEqual([]);
  });
  it('aucune classification orpheline', () => {
    const names = new Set(FILES.map(routeName));
    // Routes ajoutées par des branches non mergées : absentes de main, tolérées.
    const PENDING = new Set(['orders/view']);
    expect(Object.keys(CLASSIFICATION).filter((r) => !names.has(r) && !PENDING.has(r))).toEqual([]);
  });
  it('exceptions publiques limitées à track et health', () => {
    expect(
      Object.entries(CLASSIFICATION)
        .filter(([, c]) => c.kind === 'public')
        .map(([r]) => r)
        .sort()
    ).toEqual(['health', 'track/[tracking]']);
  });
});

// ─── 2. Routes « session » ───────────────────────────────────────────────────

const REFUSED = new Set([401, 403, 307]); // 307 = redirection /login (OAuth)

function ratchet(gaps: string[], known: Record<string, string>) {
  const unknown = gaps.filter((g) => !(g in known));
  for (const k of Object.keys(known)) if (!gaps.includes(k)) stale.add(k);
  expect(unknown, 'écart NOUVEAU (non listé)').toEqual([]);
}

describe('2 — routes « session »', () => {
  for (const [label, err] of [
    ['A — anonyme', null],
    ['B — cookie invalide', { message: 'invalid JWT' }],
  ] as const) {
    it(`${label} : refus AVANT tout appel externe ou écriture`, async () => {
      const gaps: string[] = [];
      for (const f of byKind(['session', 'admin'])) {
        for (const m of ALL_METHODS) {
          db = new FakeSupabase();
          session = { user: null, error: err };
          const r = await callRoute(f, m, {
            db,
            outgoing: rec.outgoing,
            body: INJECTED_BODY,
            query: INJECTED_QUERY,
          });
          if (!r) continue;
          // Écart = la requête produit quelque chose : succès, appel externe ou
          // écriture. Un 4xx sans effet (validation AVANT l'authentification,
          // ex. autoswap/execute → 400) n'expose rien : noté, pas compté.
          const ok = typeof r.status === 'number' && r.status >= 200 && r.status < 300;
          if (ok || r.outgoing.length || r.writes.length) gaps.push(`${m} ${routeName(f)}`);
          else if (typeof r.status === 'number' && !REFUSED.has(r.status)) {
            validationBeforeAuth.add(`${m} ${routeName(f)} → ${r.status}`);
          }
        }
      }
      ratchet(gaps, KNOWN_ANON_GAPS);
    }, 60_000);
  }

  it('C/D/E/F — session B + user_id, tenant_id et clé ZR de A dans le corps : rien de A n’est utilisé', async () => {
    const gaps: string[] = [];
    for (const f of byKind(['session', 'admin'])) {
      for (const m of ALL_METHODS) {
        db = new FakeSupabase();
        db.seed('public', 'user_sync_settings', [
          {
            user_id: ATTACKER,
            zrexpress_token: 'ZR-KEY-ATTACKER',
            zrexpress_tenant_id: 'zr-tenant-attacker',
            templates: {},
          },
        ]);
        db.seed('public', 'profiles', [{ id: ATTACKER, plan_id: 'pro', role: null }]);
        session = { user: { id: ATTACKER }, error: null };
        const r = await callRoute(f, m, {
          db,
          outgoing: rec.outgoing,
          body: INJECTED_BODY,
          query: INJECTED_QUERY,
        });
        if (!r) continue;
        const victimWrite = r.writes.some((w) =>
          w.rows.some((row) => Object.values(row).includes(VICTIM))
        );
        if (touchesVictim(r.outgoing) || victimWrite) gaps.push(`${m} ${routeName(f)}`);
      }
    }
    ratchet(gaps, KNOWN_BODY_TRUST);
  }, 60_000);

  it('IDOR — session B, ids des lignes de A : aucune lecture ni écriture des données de A', async () => {
    const gaps: string[] = [];
    const TABLES = [
      'orders',
      'campaigns',
      'campaign_recipients',
      'integrations',
      'ai_chat_sessions',
      'message_templates',
      'autoswap_size_equivalences',
      'voice_calls',
      'voice_call_settings',
      'messages',
      'pending_notifications',
      'whatsapp_instances',
      'whatsapp_settings',
      'chatbot_configs',
      'facebook_connections',
      'user_api_credentials',
    ];
    for (const f of byKind(['session', 'admin'])) {
      for (const m of ALL_METHODS) {
        db = new FakeSupabase();
        db.seed('public', 'profiles', [{ id: ATTACKER, plan_id: 'pro', role: null }]);
        for (const t of TABLES) {
          db.seed('public', t, [
            {
              id: 'victim-row',
              user_id: VICTIM,
              name: MARK,
              customer_name: MARK,
              tracking_number: MARK,
              message: MARK,
              contact_id: MARK,
              identifier: MARK,
              page_id: MARK,
              instance_name: MARK,
              product_key: MARK,
              status: 'en_cours',
              deleted_at: '2026-01-01T00:00:00Z',
              is_active: true,
              service_type: 'auto_confirmation',
              template_type: 'auto_confirmation',
              conversation: [{ role: 'user', content: MARK }],
            },
          ]);
        }
        session = { user: { id: ATTACKER }, error: null };
        const r = await callRoute(f, m, { db, outgoing: rec.outgoing, body: INJECTED_BODY });
        if (!r) continue;
        const victimWrite = r.writes.some((w) =>
          w.rows.some((row) => Object.values(row).includes(VICTIM))
        );
        if (r.text.includes(MARK) || victimWrite) gaps.push(`${m} ${routeName(f)}`);
      }
    }
    expect(gaps).toEqual([]); // aucun écart connu : aucune tolérance
  }, 60_000);
});

// ─── 3. Routes machine ───────────────────────────────────────────────────────

const file = (r: string) => FILES.find((f) => routeName(f) === r)!;

describe('3 — routes machine', () => {
  it('cron/tick : secret configuré → 401 sans jeton, 403 faux jeton, aucune écriture', async () => {
    vi.stubEnv('CRON_TICK_SECRET', 'tick-secret-test');
    for (const [headers, expected] of [
      [{}, 401],
      [{ 'x-webhook-token': 'faux' }, 403],
    ] as const) {
      const r = await callRoute(file('cron/tick'), 'POST', { db, outgoing: rec.outgoing, headers });
      expect(r!.status).toBe(expected);
      expect(r!.writes).toHaveLength(0);
    }
  });

  it('webhook WhatsApp : secret configuré → 401 sans jeton, rien traité', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_SECRET', 'wa-secret-test');
    const r = await callRoute(file('ai-chatbot/webhook/whatsapp'), 'POST', {
      db,
      outgoing: rec.outgoing,
      body: { event: 'messages.upsert', instance: 'i', data: {} },
    });
    expect(r!.status).toBe(401);
    expect(r!.outgoing).toHaveLength(0);
  });

  it('relance : CRON_SECRET absent (état de production) → l’appel anonyme doit être refusé', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const gaps: string[] = [];
    for (const m of ['GET', 'POST'] as const) {
      const r = await callRoute(file('ai-chatbot/relance'), m, { db, outgoing: rec.outgoing });
      if (r && !(typeof r.status === 'number' && REFUSED.has(r.status))) {
        gaps.push('relance: CRON_SECRET absent → déclenchement anonyme');
      }
    }
    ratchet([...new Set(gaps)], KNOWN_MACHINE_GAPS);
  });

  for (const [platform, headers] of [
    [
      'shopify',
      {
        'x-shopify-shop-domain': 'shop.test',
        'x-shopify-topic': 'orders/create',
        'x-shopify-hmac-sha256': 'faux',
      },
    ],
    [
      'woocommerce',
      {
        'x-wc-webhook-source': 'shop.test',
        'x-wc-webhook-topic': 'order.created',
        'x-wc-webhook-signature': 'faux',
      },
    ],
  ] as const) {
    it(`${platform} : signature fausse → refus, même si l’intégration n’a pas de secret`, async () => {
      for (const secret of ['s3cret', '']) {
        db = new FakeSupabase();
        db.seed('public', 'integrations', [
          { user_id: VICTIM, platform, identifier: 'shop.test', secret_key: secret, active: true },
        ]);
        const r = await callRoute(file(`integrations/${platform}/webhook`), 'POST', {
          db,
          outgoing: rec.outgoing,
          headers,
          body: { id: 1, name: '#1', number: 1, status: 'processing', total_price: '10' },
        });
        const accepted = r!.writes.some((w) => w.table === 'public.orders');
        if (secret) expect(accepted).toBe(false);
        else if (accepted)
          ratchet([`${platform}: secret_key vide → commande forgée acceptée`], KNOWN_MACHINE_GAPS);
      }
    });
  }
});

// ─── 4. Exceptions publiques ─────────────────────────────────────────────────

describe('4 — exceptions publiques', () => {
  it('track : un joker SQL dans le numéro ne doit jamais atteindre ILIKE tel quel', async () => {
    const patterns: string[] = [];
    const chain: Record<string, unknown> = {};
    for (const k of ['from', 'select', 'eq', 'limit', 'order']) chain[k] = () => chain;
    chain.ilike = (_c: string, p: string) => {
      patterns.push(p);
      return chain;
    };
    chain.single = async () => ({ data: null, error: { code: 'PGRST116' } });
    chain.maybeSingle = chain.single;
    const server = await import('@/lib/supabase/server');
    vi.spyOn(server, 'createServiceClient').mockReturnValue(chain as never);
    const mod = await import('@/app/api/track/[tracking]/route');
    const { NextRequest } = await import('next/server');
    await mod.GET(
      new NextRequest('https://app.test/api/track/%25', {
        headers: { 'x-forwarded-for': '203.0.113.9' },
      }),
      { params: Promise.resolve({ tracking: '%' }) } as never
    );
    const raw = patterns.some((p) => /(^|[^\\])[%_]/.test(p));
    if (raw)
      ratchet(['track: jokers SQL (% _) transmis à ILIKE → énumération'], KNOWN_MACHINE_GAPS);
    // Correctif ae4428c : plus aucun ILIKE (égalité stricte) → aucun motif capturé,
    // écart accepté par le cliquet comme corrigé.
  });

  it('health : aucun détail interne dans la réponse publique en cas d’erreur base', async () => {
    db.failNext('public', 'plans', 'select', {
      code: '42501',
      message: 'permission denied for table plans',
    });
    const r = await callRoute(file('health'), 'GET', { db, outgoing: rec.outgoing });
    expect(r!.status).toBe(503);
    if (r!.text.includes('permission denied')) {
      ratchet(['health: message PostgREST renvoyé au public'], KNOWN_MACHINE_GAPS);
    }
  });

  it('cliquet — les écarts listés et déjà corrigés sont signalés (à retirer)', () => {
    // Informatif : un écart corrigé ne fait pas échouer la suite.
    if (stale.size) console.warn(`écarts corrigés à retirer : ${[...stale].join(' | ')}`);
    if (validationBeforeAuth.size) {
      console.warn(
        `4xx sans effet avant authentification : ${[...validationBeforeAuth].join(' | ')}`
      );
    }
    expect(true).toBe(true);
  });
});
