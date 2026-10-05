// P4 — AUDIT service-role / multi-tenant (constat, aucun code modifié).
//
// createServiceClient() contourne la RLS : l'isolation entre marchands repose
// sur le scope APPLICATIF de chaque requête. Ces tests vérifient, avec deux
// marchands A et B (données synthétiques, base en mémoire), que les points
// d'entrée où un identifiant vient de l'extérieur gardent ce scope.
// Voir .claude/mission/service-role-tenant-audit.md.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import type { Job } from '@/lib/queue/types';

let db: FakeSupabase;
let currentUser: string | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser ? { id: currentUser } : null } }) },
    from: (t: string) => db.from(t),
  }),
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CAMP_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORDER_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

beforeEach(() => {
  db = new FakeSupabase();
  currentUser = A;
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  db.seed('public', 'profiles', [
    { id: A, email: 'a@test.local', role: 'user', plan_id: 'free', status: 'active' },
    { id: B, email: 'b@test.local', role: 'user', plan_id: 'pro', status: 'active' },
  ]);
  db.seed('public', 'campaigns', [
    {
      id: CAMP_B,
      user_id: B,
      name: 'Campagne B',
      status: 'brouillon',
      message_template: 'Salam {client}',
      audience_type: 'all',
    },
  ]);
  db.seed('public', 'campaign_recipients', [
    {
      id: 'r1',
      campaign_id: CAMP_B,
      client: 'Client de B',
      phone: '213550000099',
      status: 'envoye',
      created_at: new Date().toISOString(),
    },
  ]);
  db.seed('public', 'orders', [
    {
      id: ORDER_B,
      user_id: B,
      tracking_number: 'ZR-B-1',
      customer_name: 'Client de B',
      deleted_at: null,
    },
  ]);
});
afterEach(() => vi.restoreAllMocks());

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });

describe('routes utilisateur — identifiant externe d’un autre marchand', () => {
  it('GET /api/campaigns/[id] : A demande la campagne de B → 404, destinataires de B jamais lus', async () => {
    const reads: string[] = [];
    const from = db.from.bind(db);
    vi.spyOn(db, 'from').mockImplementation((t: string) => (reads.push(t), from(t)));
    const { GET } = await import('@/app/api/campaigns/[id]/route');
    const res = await GET(json(`https://app.test/api/campaigns/${CAMP_B}`, 'GET'), {
      params: Promise.resolve({ id: CAMP_B }),
    });
    expect(res.status).toBe(404);
    expect(reads).not.toContain('campaign_recipients');
  });

  it('DELETE /api/campaigns/[id] : A supprime la campagne de B → requête bornée à id ET user_id=A', async () => {
    // FakeSupabase (main) n'implémente pas delete() : vrai client supabase-js,
    // transport capturé — on vérifie les filtres réellement envoyés.
    const { createClient: realClient } = await import('@supabase/supabase-js');
    const sent: URL[] = [];
    const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new URL(String(input)));
      expect(init?.method).toBe('DELETE');
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    db = realClient('http://pg.test', 'k', {
      global: { fetch: transport as unknown as typeof fetch },
      auth: { persistSession: false },
    }) as unknown as FakeSupabase;
    const { DELETE } = await import('@/app/api/campaigns/[id]/route');
    await DELETE(json(`https://app.test/api/campaigns/${CAMP_B}`, 'DELETE'), {
      params: Promise.resolve({ id: CAMP_B }),
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].searchParams.get('id')).toBe(`eq.${CAMP_B}`);
    expect(sent[0].searchParams.getAll('user_id')).toEqual([`eq.${A}`]);
  });

  it.each([
    ['delete', 'deleted_at'],
    ['restore', 'deleted_at'],
  ])('POST /api/orders/%s : A cible la commande de B → ligne de B intacte', async (route) => {
    const before = { ...db.all('public', 'orders')[0] };
    const { POST } = await import(`@/app/api/orders/${route}/route`);
    await POST(json(`https://app.test/api/orders/${route}`, 'POST', { ids: [ORDER_B] }));
    expect(db.all('public', 'orders')[0]).toEqual(before);
  });

  it('POST /api/orders/delete-permanent : A cible la commande de B (même en corbeille) → non supprimée', async () => {
    db.all('public', 'orders')[0].deleted_at = new Date().toISOString();
    const { POST } = await import('@/app/api/orders/delete-permanent/route');
    await POST(json('https://app.test/api/orders/delete-permanent', 'POST', { ids: [ORDER_B] }));
    expect(db.all('public', 'orders')).toHaveLength(1);
  });
});

describe('file autotim — un job ne change jamais de marchand', () => {
  const job = (tenant: string, payload: Record<string, unknown>): Job => {
    const now = new Date().toISOString();
    return {
      id: 'job-1',
      tenant_id: tenant,
      type: 'campaign.dispatch',
      payload,
      status: 'running',
      run_after: now,
      attempts: 1,
      max_attempts: 3,
      locked_at: now,
      locked_by: 'w',
      last_error: null,
      idempotency_key: null,
      created_at: now,
      updated_at: now,
    } as Job;
  };

  it('job de A portant la campagne de B → échec « introuvable pour ce tenant », rien d’enfilé', async () => {
    const { handleCampaignDispatch } = await import('@/lib/queue/handlers/campaign-dispatch');
    const r = await handleCampaignDispatch(job(A, { campaign_id: CAMP_B, offset: 0 }));
    expect(r).toEqual({ outcome: 'failed', error: 'campagne introuvable pour ce tenant' });
    expect(db.all('autotim', 'jobs')).toHaveLength(0);
    expect(db.all('public', 'campaigns')[0].status).toBe('brouillon');
  });
});

describe('garde Super Admin — dépend UNIQUEMENT de profiles.role', () => {
  it('utilisateur normal → 403 sur la liste et la modification des profils', async () => {
    const { GET, PATCH } = await import('@/app/api/admin/users/route');
    expect((await GET()).status).toBe(403);
    const res = await PATCH(
      json('https://app.test/api/admin/users', 'PATCH', { userId: B, plan_id: 'free' })
    );
    expect(res.status).toBe(403);
    expect(db.all('public', 'profiles').find((p) => p.id === B)?.plan_id).toBe('pro');
  });

  it('CONSTAT : si profiles.role de A vaut « admin », A lit TOUS les profils et modifie ceux de B', async () => {
    // Le passage à « admin » est simulé directement en base : sa faisabilité
    // par l'utilisateur lui-même dépend des politiques RLS de production
    // (HUMAN-RLS-ROLE-001), non observées.
    db.all('public', 'profiles').find((p) => p.id === A)!.role = 'admin';
    const { GET, PATCH } = await import('@/app/api/admin/users/route');
    const list = await (await GET()).json();
    expect(list.users.map((u: { email: string }) => u.email).sort()).toEqual([
      'a@test.local',
      'b@test.local',
    ]);
    await PATCH(
      json('https://app.test/api/admin/users', 'PATCH', { userId: B, status: 'suspended' })
    );
    expect(db.all('public', 'profiles').find((p) => p.id === B)?.status).toBe('suspended');
  });
});
