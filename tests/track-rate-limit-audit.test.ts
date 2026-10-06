// P4 — AUDIT (constat, aucun code modifié) : limitation de débit de /api/track/[tracking].
//
// Code audité (src/app/api/track/[tracking]/route.ts, main local ae4428c) :
//   RATE_WINDOW_MS = 60_000, RATE_MAX_REQ = 10, `hits` = Map au niveau MODULE,
//   clé = 1er élément de x-forwarded-for || x-real-ip || 'unknown',
//   fenêtre FIXE (windowStart posé à la 1re requête, réinitialisée si
//   now - windowStart > 60 000), compteur incrémenté AVANT la validation et la
//   recherche, 429 + Retry-After quand count > 10.
// Ces tests DÉCRIVENT le comportement actuel, faiblesses comprises (CONSTAT).
// Temps : Date.now() simulé (vi.useFakeTimers, Date seulement) — déterministe.
// « Nouvelle instance » : vi.resetModules() recharge le module → Map vide.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ROWS = [
  {
    tracking_number: 'ZR-100200',
    customer_name: 'Client Alpha',
    wilaya: 'Oran',
    delivery_status: 'livre',
    attempts: 1,
    last_update: null,
    product_name: 'Montre',
  },
];
let queries = 0;
let throwOnQuery: Error | null = null;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((filters[c] = v), q),
        limit: () => q,
        maybeSingle: async () => {
          queries++;
          if (throwOnQuery) throw throwOnQuery;
          return {
            data: ROWS.find((r) => r.tracking_number === filters.tracking_number) ?? null,
            error: null,
          };
        },
      };
      return q;
    },
  }),
}));

type Route = {
  GET: (r: NextRequest, c: { params: Promise<{ tracking: string }> }) => Promise<Response>;
};
async function load(): Promise<Route> {
  return (await import('@/app/api/track/[tracking]/route')) as Route;
}

function req(headers: Record<string, string>) {
  return new NextRequest('https://app.test/api/track/x', { headers });
}
async function call(
  mod: Route,
  tracking: string,
  headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.1' }
) {
  const res = await mod.GET(req(headers), { params: Promise.resolve({ tracking }) });
  return { status: res.status, retryAfter: res.headers.get('retry-after'), body: await res.json() };
}
async function burst(
  mod: Route,
  n: number,
  tracking = 'ZR-000000',
  headers?: Record<string, string>
) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await call(mod, tracking, headers)).status);
  return out;
}

const T0 = new Date('2026-10-06T10:00:00.000Z').getTime();

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  queries = 0;
  throwOnQuery = null;
});
afterEach(() => vi.useRealTimers());

describe('A — limite exacte (même IP, même instance)', () => {
  it('10 requêtes acceptées, la 11e et les suivantes → 429 avec Retry-After', async () => {
    const mod = await load();
    const statuses = await burst(mod, 12);
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true); // dernière acceptée : 10e
    expect(statuses.slice(10)).toEqual([429, 429]); // première rejetée : 11e
    const r = await call(mod, 'ZR-000000');
    expect(r.status).toBe(429);
    expect(r.retryAfter).toBe('60');
    expect(r.body).toEqual({ error: 'Trop de requêtes. Réessayez dans un instant.' });
  });

  it('une requête 429 ne touche pas la base (contrôle avant la recherche)', async () => {
    const mod = await load();
    await burst(mod, 10);
    const before = queries;
    await call(mod, 'ZR-100200');
    expect(queries).toBe(before);
  });
});

describe('B — fenêtre FIXE de 60 s', () => {
  it('à +60 000 ms exactement : encore bloqué ; à +60 001 ms : quota neuf (compteur remis à 1)', async () => {
    const mod = await load();
    await burst(mod, 11);
    vi.setSystemTime(T0 + 60_000);
    expect((await call(mod, 'ZR-000000')).status).toBe(429);
    vi.setSystemTime(T0 + 60_001);
    expect(await burst(mod, 11)).toEqual([...Array(10).fill(404), 429]);
  });

  it('Retry-After décroît avec le temps restant de la fenêtre', async () => {
    const mod = await load();
    await burst(mod, 10);
    vi.setSystemTime(T0 + 45_500);
    expect((await call(mod, 'ZR-000000')).retryAfter).toBe('15');
  });

  it('CONSTAT : les 429 n’allongent pas la fenêtre (pas de pénalité)', async () => {
    const mod = await load();
    await burst(mod, 50); // 40 rejets
    vi.setSystemTime(T0 + 60_001);
    expect((await call(mod, 'ZR-000000')).status).toBe(404);
  });

  it('CONSTAT : effet de bord de fenêtre — 20 requêtes acceptées en ~2 ms', async () => {
    const mod = await load();
    await call(mod, 'ZR-000000'); // ouvre la fenêtre à T0
    vi.setSystemTime(T0 + 59_999);
    const late = await burst(mod, 9); // fin de fenêtre : 9 de plus (10 au total)
    vi.setSystemTime(T0 + 60_001);
    const early = await burst(mod, 10); // nouvelle fenêtre : 10
    expect([...late, ...early].filter((s) => s !== 429)).toHaveLength(19);
    // 9 + 10 acceptées entre T0+59 999 et T0+60 001 (+1 à T0) : 20 en 60,001 s,
    // dont 19 en 2 ms.
  });
});

describe('C/D — clé IP et confiance dans les en-têtes', () => {
  it('C — deux IP différentes : compteurs indépendants', async () => {
    const mod = await load();
    await burst(mod, 11, 'ZR-000000', { 'x-forwarded-for': '203.0.113.1' });
    expect(await burst(mod, 10, 'ZR-000000', { 'x-forwarded-for': '203.0.113.2' })).toEqual(
      Array(10).fill(404)
    );
  });

  it('D — CONSTAT : la clé est le 1er élément de x-forwarded-for tel que REÇU par l’application', async () => {
    const mod = await load();
    // L'IP « réelle » (fin de chaîne) est saturée…
    await burst(mod, 11, 'ZR-000000', { 'x-forwarded-for': '198.51.100.9' });
    // …mais chaque valeur de tête différente ouvre un quota neuf.
    let accepted = 0;
    for (let i = 0; i < 30; i++) {
      const r = await call(mod, 'ZR-000000', { 'x-forwarded-for': `10.0.${i}.1, 198.51.100.9` });
      if (r.status !== 429) accepted++;
    }
    expect(accepted).toBe(30);
  });

  it('D — sans x-forwarded-for : x-real-ip ; sans les deux : seau partagé « unknown »', async () => {
    const mod = await load();
    expect(await burst(mod, 11, 'ZR-000000', { 'x-real-ip': '192.0.2.5' })).toEqual([
      ...Array(10).fill(404),
      429,
    ]);
    expect(await burst(mod, 11, 'ZR-000000', {})).toEqual([...Array(10).fill(404), 429]);
    // Le seau « unknown » est commun à tous les clients sans en-tête.
    expect((await call(mod, 'ZR-000000', {})).status).toBe(429);
  });

  it('CONSTAT : aucune borne globale — 200 IP distinctes × 10 = 2 000 requêtes acceptées par une instance', async () => {
    const mod = await load();
    let accepted = 0;
    for (let ip = 0; ip < 200; ip++) {
      for (let i = 0; i < 10; i++) {
        const r = await call(mod, `ZR-${String(ip * 10 + i).padStart(6, '0')}`, {
          'x-forwarded-for': `10.1.${ip}.1`,
        });
        if (r.status !== 429) accepted++;
      }
    }
    expect(accepted).toBe(2000);
  });
});

describe('E/F — consommation du budget selon le résultat', () => {
  it('E — numéro existant (200) et inexistant (404) consomment le budget de la même façon', async () => {
    const mod = await load();
    const s = [];
    for (let i = 0; i < 10; i++)
      s.push((await call(mod, i % 2 ? 'ZR-100200' : 'ZR-999999')).status);
    expect(s.filter((x) => x === 200)).toHaveLength(5);
    expect(s.filter((x) => x === 404)).toHaveLength(5);
    expect((await call(mod, 'ZR-100200')).status).toBe(429);
  });

  it('F — saisie vide (400) consomme AUSSI le budget (contrôle avant validation)', async () => {
    const mod = await load();
    expect(await burst(mod, 10, '   ')).toEqual(Array(10).fill(400));
    expect((await call(mod, 'ZR-100200')).status).toBe(429);
  });
});

describe('G — concurrence', () => {
  it('même instance : 15 requêtes simultanées → exactement 10 acceptées (compteur synchrone, atomique par instance)', async () => {
    const mod = await load();
    const results = await Promise.all(Array.from({ length: 15 }, () => call(mod, 'ZR-000000')));
    expect(results.filter((r) => r.status !== 429)).toHaveLength(10);
  });
});

describe('Multi-instance (simulé par rechargement du module)', () => {
  it('CONSTAT : démarrage à froid → compteur à zéro', async () => {
    const A = await load();
    await burst(A, 11);
    vi.resetModules();
    const B = await load();
    expect((await call(B, 'ZR-000000')).status).toBe(404);
  });

  it('CONSTAT : deux instances vivantes → chacune accorde son propre quota (20 pour une IP)', async () => {
    const A = await load();
    vi.resetModules();
    const B = await load();
    const a = await burst(A, 11);
    const b = await burst(B, 11);
    expect([...a, ...b].filter((s) => s !== 429)).toHaveLength(20);
  });
});

describe('Oracle — statuts, corps, nombre de lectures', () => {
  it('200 / 404 / 400 / 429 se distinguent par le statut (voulu pour 200/404 : route de suivi publique)', async () => {
    const mod = await load();
    expect((await call(mod, 'ZR-100200')).status).toBe(200);
    expect((await call(mod, 'ZR-999999')).body).toEqual({ error: 'Commande introuvable' });
    expect((await call(mod, '  ')).body).toEqual({ error: 'Tracking requis' });
  });

  it('nombre de lectures : trouvé en 1 lecture, absent en 2 ou 3 selon la casse — écart de temps possible, sans info au-delà du statut', async () => {
    const mod = await load();
    queries = 0;
    await call(mod, 'ZR-100200');
    expect(queries).toBe(1);
    queries = 0;
    await call(mod, 'Zr-999999'); // casse mixte : saisie, MAJUSCULES, minuscules
    expect(queries).toBe(3);
    queries = 0;
    await call(mod, 'zr-999999'); // minuscules : la forme minuscule = la saisie
    expect(queries).toBe(2);
    queries = 0;
    await call(mod, 'ZR-999999');
    expect(queries).toBe(2); // saisie déjà en majuscules : 2 variantes distinctes
  });

  it('CONSTAT annexe : exception → message BRUT sur main / générique avec 12j (500)', async () => {
    const mod = await load();
    throwOnQuery = new Error('connect ECONNREFUSED db.internal.test:5432');
    const r = await call(mod, 'ZR-100200');
    expect(r.status).toBe(500);
    // DEUX ÉTATS : main → message brut (constat) ; avec p3-safe-errors (12j)
    // → message générique, aucun détail interne.
    if (String(r.body.error).includes('db.internal.test')) {
      expect(r.body.error).toContain('ECONNREFUSED');
    } else {
      expect(JSON.stringify(r.body)).not.toContain('db.internal.test');
      expect(JSON.stringify(r.body)).not.toContain('ECONNREFUSED');
    }
  });
});
