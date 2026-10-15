// P4 — /api/track/[tracking] : le numéro est une valeur LITTÉRALE.
//
// AVANT : .ilike('tracking_number', saisie) — « % » et « _ » (et « * », que
// PostgREST convertit en %) étaient des jokers : « % » renvoyait une commande
// quelconque de la plateforme, « ZR-1% » parcourait les numéros sans les
// connaître. Données synthétiques, base en mémoire, aucun réseau.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => db,
}));

/**
 * Le fake n'implémentait pas ILIKE : on l'ajoute pour la contre-épreuve avec la
 * sémantique PostgreSQL (% = n caractères, _ = 1, insensible à la casse ;
 * PostgREST convertit * en %).
 */
function likeToRegExp(pattern: string): RegExp {
  let re = '';
  for (const ch of pattern.replace(/\*/g, '%')) {
    if (ch === '%') re += '.*';
    else if (ch === '_') re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'is');
}

let ip = 0;
async function track(tracking: string) {
  const { GET } = await import('@/app/api/track/[tracking]/route');
  const res = await GET(
    new NextRequest(`https://app.test/api/track/${encodeURIComponent(tracking)}`, {
      headers: { 'x-forwarded-for': `198.51.100.${++ip % 250}` },
    }),
    { params: Promise.resolve({ tracking }) }
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  db = new FakeSupabase();
  // ilike pour la contre-épreuve (ancien code) ; le nouveau code ne l'appelle pas.
  const proto = Object.getPrototypeOf(db.from('orders'));
  if (!proto.ilike) {
    proto.ilike = function (this: { filters: unknown[] }, col: string, pattern: string) {
      const re = likeToRegExp(pattern);
      // filtre « in » détourné : on matérialise les valeurs correspondantes.
      const values = db
        .all('public', 'orders')
        .map((r) => String(r[col] ?? ''))
        .filter((v) => re.test(v));
      return (this as unknown as { in: (c: string, v: string[]) => unknown }).in(col, values);
    };
  }
  db.seed('public', 'orders', [
    {
      user_id: 'tenant-a',
      tracking_number: 'ZR-100200',
      customer_name: 'Amine Benali',
      wilaya: 'Oran',
      delivery_status: 'en_transit',
      attempts: 0,
      product_name: 'Montre',
    },
    {
      user_id: 'tenant-b',
      tracking_number: 'ZR-100201',
      customer_name: 'Sara K',
      wilaya: 'Alger',
      delivery_status: 'livre',
      attempts: 1,
      product_name: 'Sac',
    },
    {
      user_id: 'tenant-b',
      tracking_number: 'SHO-12_34',
      customer_name: 'Yacine M',
      wilaya: 'Blida',
      delivery_status: 'en_preparation',
      attempts: 0,
      product_name: 'Robe',
    },
    {
      user_id: 'tenant-c',
      tracking_number: 'WOO-50%OFF',
      customer_name: 'Lina T',
      wilaya: 'Setif',
      delivery_status: 'en_transit',
      attempts: 0,
      product_name: 'Parfum',
    },
  ]);
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => vi.restoreAllMocks());

describe('/api/track — recherche littérale', () => {
  it('numéro exact → la commande, nom masqué, aucun champ sensible', async () => {
    const r = await track('ZR-100200');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tracking: 'ZR-100200', client: 'Amine B.', wilaya: 'Oran' });
    expect(JSON.stringify(r.body)).not.toMatch(/tenant-a|user_id|phone|0550/);
  });

  it('casse différente (saisie en minuscules) → trouvé, comme avant', async () => {
    expect((await track('zr-100200')).status).toBe(200);
  });

  it('espaces autour → trouvé (comportement existant conservé)', async () => {
    expect((await track('  ZR-100201 ')).body.tracking).toBe('ZR-100201');
  });

  it('numéro inexistant → 404', async () => {
    expect((await track('ZR-999999')).status).toBe(404);
  });

  it.each([
    ['%', 'n’importe quelle commande'],
    ['_%', 'idem'],
    ['%_', 'idem'],
    ['*', 'joker PostgREST'],
    ['ZR-1%', 'préfixe'],
    ['ZR-10020_', 'un caractère'],
    ['zr-______', 'six caractères'],
    ['\\', 'caractère d’échappement'],
    ['%\\%', 'échappement + jokers'],
  ])('« %s » (%s) → 404, jamais une commande', async (pattern) => {
    const r = await track(pattern);
    expect(r.status).toBe(404);
    expect(r.body.tracking).toBeUndefined();
  });

  it('un « _ » LÉGITIME dans le numéro : correspondance exacte seulement', async () => {
    expect((await track('SHO-12_34')).body.tracking).toBe('SHO-12_34');
    expect((await track('SHO-12X34')).status).toBe(404); // « _ » n'est pas un joker
  });

  it('un « % » LÉGITIME dans le numéro : correspondance exacte seulement', async () => {
    expect((await track('WOO-50%OFF')).body.tracking).toBe('WOO-50%OFF');
    expect((await track('WOO-50%')).status).toBe(404);
  });

  it.each([[''], ['   ']])('saisie vide ou blanche (%j) → 400, aucune requête base', async (v) => {
    const r = await track(v);
    expect(r.status).toBe(400);
  });

  it('le numéro n’est ni tronqué ni nettoyé : un caractère en plus → 404', async () => {
    expect((await track('ZR-100200-')).status).toBe(404);
    expect((await track('ZR-1002000')).status).toBe(404);
  });
});

describe('/api/track — aucune liste de valeurs interprétée', () => {
  it('virgules et guillemets dans la saisie : jamais plusieurs numéros en une requête', async () => {
    expect((await track('x",ZR-100200,"y')).status).toBe(404);
    expect((await track('ZR-100200,ZR-100201')).status).toBe(404);
    expect((await track('(ZR-100200)')).status).toBe(404);
  });
});
