// AUDIT CSRF + CLICKJACKING — tests de CONSTAT (runtime inchangé).
//
// Ce que ces tests figent (statique + comportements isolés) :
//   1. l'inventaire des méthodes de chaque route et la classe d'authentification ;
//   2. la liste EXACTE des GET mutatifs (tout nouveau GET qui écrit fait échouer
//      le test et doit être audité) ;
//   3. que l'autorisation est faite DANS chaque route (le middleware laisse
//      passer /api/ : le contournement CVE-2025-29927 ne franchit aucune barrière
//      d'API) ;
//   4. que le Content-Type ne protège pas (req.json() accepte un corps text/plain,
//      que tout formulaire HTML peut produire) — la protection CSRF repose donc
//      sur SameSite=Lax du cookie Supabase ;
//   5. qu'aucune vérification Origin / Referer / Sec-Fetch n'existe.
// La matrice navigateur (cookie Lax envoyé ou non, iframe, formulaires, fetch)
// est PROUVÉE LOCALEMENT dans Chromium : voir .claude/mission/csrf-clickjacking-audit.md.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'src', 'app', 'api');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name === 'route.ts') out.push(p);
  }
  return out;
}

const ROUTES = walk(API)
  .map((f) => ({
    rel: path.relative(API, path.dirname(f)).replace(/\\/g, '/'),
    text: fs.readFileSync(f, 'utf8'),
  }))
  .sort((a, b) => a.rel.localeCompare(b.rel));

function methods(text: string): string[] {
  return [
    ...new Set(
      [
        ...text.matchAll(
          /export (?:async function|const) (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g
        ),
      ].map((m) => m[1])
    ),
  ].sort();
}

// Corps du handler GET (jusqu'au prochain export de haut niveau).
function getBody(text: string): string {
  const i = text.search(/export (?:async function|const) GET\b/);
  if (i < 0) return '';
  const rest = text.slice(i + 10);
  const j = rest.search(/\nexport /);
  return j < 0 ? rest : rest.slice(0, j);
}

const WRITE =
  /\.(insert|update|upsert|delete|rpc)\(|sendWhatsApp\(|method:\s*'(POST|PUT|PATCH|DELETE)'/;

// Listes relevées sur main ae4428c. Les correctifs non mergés (fusion d'essai)
// ne peuvent que les RÉDUIRE : chaque assertion vérifie « ⊆ liste main ».
const MAIN_NO_SESSION = [
  'ai-chatbot/facebook/callback', // state OAuth (PUB-1, correctif 78070c4)
  'ai-chatbot/relance', // CRON_SECRET (PUB-2 si absent)
  'ai-chatbot/webhook/facebook', // hub.verify_token (GET) / webhook Meta (POST)
  'ai-chatbot/webhook/whatsapp', // secret partagé WHATSAPP_WEBHOOK_SECRET
  'cron/tick', // CRON_TICK_SECRET
  'health', // public par conception
  'integrations/shopify/webhook', // HMAC Shopify
  'integrations/woocommerce/webhook', // signature WooCommerce
  'track/[tracking]', // public par conception (suivi)
  'voice-calls/gather', // signature Twilio
  'voice-calls/status', // signature Twilio
  'voice-calls/twiml', // signature Twilio
];
const MAIN_OPTIONAL_SESSION = [
  'autoswap/diagnostic', // lecture ZR avec la clé fournie par l'appelant (p3-autoswap-auth-tests)
  'autoswap/preview', // idem
  'sync-zrexpress', // P1-12 connu : écriture anonyme, correctif d2c9d56 / cca0b0a non mergé
];
const MAIN_GET_MUTATIVE = [
  'ai-chatbot/facebook/callback', // échange OAuth + enregistre la page (state, PUB-1)
  'ai-chatbot/relance', // envoi WhatsApp + update relance_sent (secret machine, PUB-2)
  'ai-chatbot/whatsapp/qr', // Evolution : webhook/set, connect, create ; update connected (SESSION → CSRF-1)
  'ai-chatbot/whatsapp/status', // update connected selon Evolution (SESSION → CSRF-1)
];
// 65 routes sur main ; toute route ajoutée doit vérifier la session.
const MAIN_ROUTE_COUNT = 65;

describe('CSRF-A — inventaire des routes et de leur authentification', () => {
  it('65 routes API sur main ; toute route supplémentaire vérifie la session', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(MAIN_ROUTE_COUNT);
    const noSession = ROUTES.filter((r) => !/auth\.getUser\(\)/.test(r.text)).map((r) => r.rel);
    for (const rel of noSession) expect(MAIN_NO_SESSION, rel).toContain(rel);
  });

  it('les routes sans session sont uniquement des secrets machine, HMAC, Twilio, state OAuth ou public par conception (⊆ liste main)', () => {
    const noSession = ROUTES.filter((r) => !/auth\.getUser\(\)/.test(r.text)).map((r) => r.rel);
    expect(noSession.every((r) => MAIN_NO_SESSION.includes(r))).toBe(true);
    // les webhooks et le cron restent sans session (preuve machine, pas de cookie)
    for (const r of ['ai-chatbot/webhook/whatsapp', 'cron/tick', 'voice-calls/twiml'])
      expect(noSession).toContain(r);
  });

  it('chaque route mutative à session refuse (401) sans session DANS le handler — sauf routes à session OPTIONNELLE (⊆ 3 de main)', () => {
    const optional: string[] = [];
    for (const r of ROUTES) {
      const m = methods(r.text);
      if (!m.some((x) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(x))) continue;
      if (!/auth\.getUser\(\)/.test(r.text)) continue;
      if (!/status:\s*401/.test(r.text)) optional.push(r.rel);
    }
    expect(optional.every((r) => MAIN_OPTIONAL_SESSION.includes(r))).toBe(true);
  });
});

describe('CSRF-B — GET mutatifs (liste figée)', () => {
  it('les handlers GET qui écrivent ⊆ 4 de main ; qr et status (CSRF-1) toujours présents', () => {
    const getMut = ROUTES.filter((r) => methods(r.text).includes('GET'))
      .filter((r) => WRITE.test(getBody(r.text)))
      .map((r) => r.rel);
    expect(getMut.every((r) => MAIN_GET_MUTATIVE.includes(r))).toBe(true);
    expect(getMut).toContain('ai-chatbot/whatsapp/qr');
    expect(getMut).toContain('ai-chatbot/whatsapp/status');
  });

  it('sur main : exactement les 4 GET mutatifs listés (constat)', () => {
    const getMut = ROUTES.filter((r) => methods(r.text).includes('GET'))
      .filter((r) => WRITE.test(getBody(r.text)))
      .map((r) => r.rel);
    // si facebook/callback ou relance vérifient la session, le correctif est présent
    const fixed = ['ai-chatbot/facebook/callback', 'ai-chatbot/relance'].filter((rel) =>
      /auth\.getUser\(\)/.test(ROUTES.find((r) => r.rel === rel)!.text)
    );
    if (fixed.length === 0) expect(getMut).toEqual(MAIN_GET_MUTATIVE);
  });

  it('CSRF-1 : qr et status s’appuient sur la session cookie seule (atteignables par navigation GET de premier niveau)', () => {
    for (const rel of ['ai-chatbot/whatsapp/qr', 'ai-chatbot/whatsapp/status']) {
      const body = getBody(ROUTES.find((r) => r.rel === rel)!.text);
      expect(body).toMatch(/auth\.getUser\(\)/);
      expect(body).not.toMatch(/origin|referer|sec-fetch/i);
    }
  });

  it('cron/tick GET est une sonde sans effet ; webhook WhatsApp GET est statique', () => {
    const tick = ROUTES.find((r) => r.rel === 'cron/tick')!;
    expect(getBody(tick.text)).not.toMatch(WRITE);
    const wa = ROUTES.find((r) => r.rel === 'ai-chatbot/webhook/whatsapp')!;
    expect(getBody(wa.text)).not.toMatch(WRITE);
  });
});

describe('CSRF-C — Origin / Referer / Content-Type', () => {
  it('aucune vérification Origin, Referer ni Sec-Fetch-* dans src/', () => {
    const all = walkSrc(path.join(ROOT, 'src'));
    const hits = all.filter((f) =>
      /headers\.get\(\s*['"](origin|referer|sec-fetch-site|sec-fetch-mode|sec-fetch-dest)['"]/i.test(
        fs.readFileSync(f, 'utf8')
      )
    );
    expect(hits).toEqual([]);
  });

  it('req.json() accepte un corps text/plain (format qu’un formulaire HTML peut produire) — le Content-Type ne protège pas', async () => {
    // corps exact produit par <form enctype="text/plain"> observé dans Chromium
    const req = new NextRequest('https://app.test/api/x', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{"page_id":"1","x":"="}\r\n',
    });
    await expect(req.json()).resolves.toEqual({ page_id: '1', x: '=' });
  });

  it('aucune route ne renvoie d’en-tête CORS (pas de lecture cross-origin avec credentials)', () => {
    expect(ROUTES.filter((r) => /Access-Control-Allow-/i.test(r.text)).map((r) => r.rel)).toEqual(
      []
    );
  });
});

describe('CSRF-D — cookie de session (SameSite) et clickjacking', () => {
  it('@supabase/ssr pose le cookie de session en SameSite=Lax, non HttpOnly, flux PKCE', async () => {
    const consts = await import('@supabase/ssr/dist/main/utils/constants.js');
    const d = (consts as unknown as { DEFAULT_COOKIE_OPTIONS: Record<string, unknown> })
      .DEFAULT_COOKIE_OPTIONS;
    expect(d.sameSite).toBe('lax');
    expect(d.httpOnly).toBe(false);
    const server = fs.readFileSync(
      path.join(ROOT, 'node_modules', '@supabase', 'ssr', 'dist', 'main', 'createServerClient.js'),
      'utf8'
    );
    expect(server).toMatch(/flowType:\s*"pkce"/);
  });

  it('aucune protection anti-iframe applicative (HDR-1) : pas de headers() ni de X-Frame-Options / frame-ancestors', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'next.config.mjs'), 'utf8');
    expect(cfg).not.toMatch(/headers\s*\(/);
    const all = walkSrc(path.join(ROOT, 'src'));
    expect(
      all.filter((f) => /X-Frame-Options|frame-ancestors/i.test(fs.readFileSync(f, 'utf8')))
    ).toEqual([]);
  });

  it('les suppressions côté UI passent par confirm() (bloqué par Chromium dans une iframe cross-origin)', () => {
    const confirmed = [
      'src/app/admin-dashboard/components/OrderDetailModal.tsx',
      'src/app/admin-dashboard/components/OrdersTable.tsx',
      'src/app/campagnes/page.tsx',
      'src/app/corbeille/page.tsx',
      'src/app/integrations/page.tsx',
      'src/app/parametres/api-keys/page.tsx',
    ];
    for (const f of confirmed) {
      expect(fs.readFileSync(path.join(ROOT, f), 'utf8'), f).toMatch(/confirm\(/);
    }
  });
});

describe('CSRF-E — CVE-2025-29927 : le middleware n’est pas une barrière d’API', () => {
  it('le middleware laisse passer tout /api/ (préfixe public) : le contourner ne change rien aux API', () => {
    const mw = fs.readFileSync(path.join(ROOT, 'src', 'middleware.ts'), 'utf8');
    expect(mw).toMatch(/publicRoutes = \[[^\]]*'\/api\/'[^\]]*\]/);
  });

  it('le middleware ne vérifie que la PRÉSENCE d’un cookie (aucune donnée servie par lui)', () => {
    const mw = fs.readFileSync(path.join(ROOT, 'src', 'middleware.ts'), 'utf8');
    expect(mw).toMatch(/c\.name\.startsWith\('sb-'\) && c\.name\.includes\('auth-token'\)/);
    // code seul (les commentaires mentionnent l'ancien appel getUser)
    const code = mw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/getUser|supabase\.from/);
  });
});

function walkSrc(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkSrc(p));
    else if (/\.(tsx?|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}
