// HUMAN-RLS-ROLE-001 (suite) — le quota illimité « admin » ne dépend plus de
// profiles.role (modifiable par l'utilisateur selon la RLS) mais du claim
// app_metadata.role du jeton Supabase Auth.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import { isPlatformAdminById } from '@/lib/auth/platform-admin';

const ME = '11111111-1111-4111-8111-111111111111';
let db: FakeSupabase;
let sessionUser: Record<string, unknown> | null;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}));

import { GET as quotaGET } from '@/app/api/quotas/state/route';

beforeEach(() => {
  db = new FakeSupabase();
  // Profil auto-promu : role='admin' posé par l'utilisateur, plan basic.
  db.seed('public', 'profiles', [{ id: ME, role: 'admin', plan_id: 'basic' }]);
  sessionUser = { id: ME, app_metadata: {}, user_metadata: { role: 'admin' } };
});

describe('/api/quotas/state', () => {
  it('profiles.role = admin SANS claim → quota du plan (200), pas illimité', async () => {
    const q = await (await quotaGET()).json();
    expect(q.quota).toBe(200);
    expect(q.planLabel).not.toBe('Admin');
  });

  it('claim app_metadata.role = admin → illimité', async () => {
    sessionUser = { id: ME, app_metadata: { role: 'admin' } };
    const q = await (await quotaGET()).json();
    expect(q.quota).toBeNull();
    expect(q.planLabel).toBe('Admin');
  });
});

describe('isPlatformAdminById (file de jobs, sans session)', () => {
  const svc = (user: unknown, fail = false) => ({
    auth: {
      admin: {
        getUserById: async () => {
          if (fail) throw new Error('auth down');
          return { data: { user } };
        },
      },
    },
  });

  it('claim présent → admin', async () => {
    expect(await isPlatformAdminById(svc({ app_metadata: { role: 'admin' } }), ME)).toBe(true);
  });
  it('rôle seulement dans user_metadata (modifiable par l’utilisateur) → pas admin', async () => {
    expect(await isPlatformAdminById(svc({ user_metadata: { role: 'admin' } }), ME)).toBe(false);
  });
  it('erreur Auth ou client sans auth.admin → pas admin (le plan s’applique)', async () => {
    expect(await isPlatformAdminById(svc(null, true), ME)).toBe(false);
    expect(await isPlatformAdminById({}, ME)).toBe(false);
  });
});
