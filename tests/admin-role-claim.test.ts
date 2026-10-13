// HUMAN-RLS-ROLE-001 — le Super Admin ne dépend plus de profiles.role.
//
// profiles.role est une colonne de la ligne de l'utilisateur lui-même : selon
// les policies RLS de production (non observables d'ici), il pourrait la
// passer à 'admin' avec la clé anon. Désormais seule app_metadata.role du jeton
// Supabase Auth (modifiable uniquement par la clé service-role) compte.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

let db: FakeSupabase;
let sessionUser: Record<string, unknown> | null;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser } }) },
  }),
}));

import { GET as usersGET, PATCH as usersPATCH } from '@/app/api/admin/users/route';
import { GET as meGET } from '@/app/api/auth/me/route';
import { PUT as prefsPUT } from '@/app/api/sync/preferences/route';

const selfPromoted = {
  id: ME,
  email: 'me@test',
  app_metadata: {},
  user_metadata: { role: 'admin' },
};
const realAdmin = { id: ME, email: 'me@test', app_metadata: { role: 'admin' }, user_metadata: {} };

beforeEach(() => {
  db = new FakeSupabase();
  // Le profil porte role='admin' — comme après un UPDATE fait par l'utilisateur.
  db.seed('public', 'profiles', [
    { id: ME, role: 'admin', plan_id: 'basic', status: 'active', created_at: '2026-01-01' },
    { id: OTHER, role: 'user', plan_id: 'basic', status: 'active', created_at: '2026-01-02' },
  ]);
  sessionUser = selfPromoted;
});

const patch = (body: unknown) =>
  usersPATCH(
    new NextRequest('https://app.test/api/admin/users', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  );

describe('isPlatformAdmin', () => {
  it('app_metadata.role = admin → vrai ; user_metadata ou absent → faux', () => {
    expect(isPlatformAdmin(realAdmin)).toBe(true);
    expect(isPlatformAdmin(selfPromoted)).toBe(false);
    expect(isPlatformAdmin({ app_metadata: { role: 'user' } })).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
  });
});

describe('/api/admin/users — escalade via profiles.role fermée', () => {
  it('profiles.role = admin SANS claim → 403 (lecture de tous les marchands refusée)', async () => {
    expect((await usersGET()).status).toBe(403);
  });

  it('profiles.role = admin SANS claim → 403 sur PATCH ; l’autre marchand est intact', async () => {
    const res = await patch({ userId: OTHER, status: 'blocked' });
    expect(res.status).toBe(403);
    expect(db.all('public', 'profiles').find((p) => p.id === OTHER)!.status).toBe('active');
  });

  it('claim app_metadata.role = admin → accès', async () => {
    sessionUser = realAdmin;
    const res = await usersGET();
    expect(res.status).toBe(200);
    expect((await res.json()).users).toHaveLength(2);
  });

  it('non connecté → 401', async () => {
    sessionUser = null;
    expect((await usersGET()).status).toBe(401);
  });
});

describe('/api/admin/users PATCH — entrées validées (admin réel)', () => {
  beforeEach(() => {
    sessionUser = realAdmin;
  });

  it.each([
    [{ userId: 'pas-un-uuid', status: 'blocked' }, 'userId'],
    [{ userId: OTHER, status: 'superuser' }, 'status'],
    [{ userId: OTHER, plan_id: 'platinum' }, 'plan_id'],
    [{ userId: OTHER, plan_id: 'constructor' }, 'plan_id'],
  ])('%o → 400', async (body) => {
    expect((await patch(body)).status).toBe(400);
  });

  it('valeurs valides → appliquées', async () => {
    const res = await patch({ userId: OTHER, status: 'blocked', plan_id: 'pro' });
    expect(res.status).toBe(200);
    expect(db.all('public', 'profiles').find((p) => p.id === OTHER)).toMatchObject({
      status: 'blocked',
      plan_id: 'pro',
    });
  });
});

describe('/api/auth/me — badge Super Admin', () => {
  it('profiles.role = admin sans claim → rôle exposé « user » (pas de badge ni de lien Admin)', async () => {
    expect((await (await meGET()).json()).role).toBe('user');
  });

  it('claim → rôle « admin »', async () => {
    sessionUser = realAdmin;
    expect((await (await meGET()).json()).role).toBe('admin');
  });
});

describe('/api/sync/preferences — bascule sync_source réservée à l’admin', () => {
  const put = (body: unknown) =>
    prefsPUT(
      new NextRequest('https://app.test/api/sync/preferences', {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    );

  it('profiles.role = admin sans claim → 403', async () => {
    expect((await put({ sync_source: 'server' })).status).toBe(403);
  });

  it('claim → accepté', async () => {
    sessionUser = realAdmin;
    expect((await put({ sync_source: 'both' })).status).toBe(200);
  });
});
