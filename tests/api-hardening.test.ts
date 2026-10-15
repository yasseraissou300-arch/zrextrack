// Phase F/G — durcissement API et garde côté navigateur.

import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const removed: string[][] = [];
let healthError: { code: string; message: string } | null = null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
  createServiceClient: () => ({
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        },
      }),
    },
    from: () => ({
      select: async () => ({ error: healthError }),
    }),
  }),
}));

beforeEach(() => {
  removed.length = 0;
  healthError = null;
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => vi.restoreAllMocks());

describe('DELETE /api/campaigns/media/upload — chemin strict', () => {
  async function del(p: string) {
    const { DELETE } = await import('@/app/api/campaigns/media/upload/route');
    return DELETE(
      new NextRequest(`https://app.test/api/campaigns/media/upload?path=${encodeURIComponent(p)}`, {
        method: 'DELETE',
      })
    );
  }

  it('média du user au format du POST → supprimé', async () => {
    const res = await del(`${ME}/1760000000000-ab12cd.png`);
    expect(res.status).toBe(200);
    expect(removed).toEqual([[`${ME}/1760000000000-ab12cd.png`]]);
  });

  it.each([
    `${ME}/../${OTHER}/1760000000000-ab12cd.png`,
    `${ME}/sub/1760000000000-ab12cd.png`,
    `${ME}/..`,
    `${ME}/%2e%2e/${OTHER}/x.png`,
    `${OTHER}/1760000000000-ab12cd.png`,
    `${ME}/`,
    `${ME}/x`,
  ])('« %s » → 403, aucune suppression', async (p) => {
    const res = await del(p);
    expect(res.status).toBe(403);
    expect(removed).toHaveLength(0);
  });
});

describe('/api/health — endpoint public', () => {
  it('base en erreur → 503 sans le message brut', async () => {
    healthError = {
      code: '57P01',
      message: 'connection to https://internal-host.supabase.co refused',
    };
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain('internal-host');
    expect(JSON.parse(text)).toEqual({ status: 'error', db: 'down' });
  });
});

describe('navigateur — aucun secret ni module serveur dans un composant client', () => {
  const SRC = path.resolve(__dirname, '..', 'src');
  const walk = (d: string): string[] =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const clientFiles = walk(SRC)
    .filter((f) => /\.(tsx?|jsx?)$/.test(f))
    .filter((f) => /^\s*['"]use client['"]/.test(fs.readFileSync(f, 'utf8')));

  it('au moins un composant client analysé', () => {
    expect(clientFiles.length).toBeGreaterThan(5);
  });

  it('aucun process.env hors NEXT_PUBLIC_ dans un composant client', () => {
    const offenders = clientFiles.filter((f) =>
      /process\.env\.(?!NEXT_PUBLIC_)[A-Z_]+/.test(fs.readFileSync(f, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });

  it('aucun import de module serveur (service-role, secrets, file, credentials)', () => {
    const SERVER =
      /from ['"]@\/lib\/(supabase\/server|security\/|user-creds|queue\/|zrexpress\/credentials)/;
    const offenders = clientFiles.filter((f) => SERVER.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('les seules variables NEXT_PUBLIC_ sont publiques par conception', () => {
    const used = new Set<string>();
    for (const f of walk(SRC).filter((x) => /\.(tsx?|jsx?)$/.test(x))) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/NEXT_PUBLIC_[A-Z_]+/g)) used.add(m[0]);
    }
    const allowed = new Set([
      'NEXT_PUBLIC_APP_URL',
      'NEXT_PUBLIC_SITE_URL',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ]);
    expect([...used].filter((v) => !allowed.has(v))).toEqual([]);
  });
});
