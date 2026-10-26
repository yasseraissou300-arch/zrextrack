// Phase E — aucune erreur brute (PostgREST, Storage, exception) renvoyée au
// navigateur par les routes corrigées : message générique + référence ; le
// journal porte la référence et le CODE seulement.

import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

const ME = '11111111-1111-4111-8111-111111111111';
const LEAK = 'Key (tracking_number)=(SHO-OTHER-TENANT-777) already exists — secret=whsec_TEST';
let db: FakeSupabase;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () =>
    Object.assign(Object.create(db), {
      from: db.from.bind(db),
      auth: { getUser: async () => ({ data: { user: { id: ME } } }) },
    }),
}));

const FIXED = [
  'ai-chatbot/config',
  'ai-chatbot/googlesheets',
  'ai-chatbot/sessions',
  'autoswap/equivalences',
  'campaigns/[id]',
  'campaigns/media/upload',
  'campaigns',
  'jobs',
  'kpis',
  'messages',
  'orders/clear-all',
  'orders/delete-permanent',
  'orders/delete',
  'orders/restore',
  'templates',
  'voice-calls/list',
  'voice-calls/start',
  'whatsapp/warmup',
];

beforeEach(() => {
  db = new FakeSupabase();
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => vi.restoreAllMocks());

describe('routes corrigées — aucune propagation de .message au navigateur', () => {
  it.each(FIXED)('%s', (route) => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'app', 'api', ...route.split('/'), 'route.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/NextResponse\.json\(\{[^}]*\.message/);
  });
});

describe('comportement', () => {
  function consoleText() {
    return (['log', 'info', 'warn', 'error'] as const)
      .flatMap((m) => (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls)
      .map((c) => c.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      .join(' | ');
  }

  it('orders/delete : erreur PostgREST citant une clé d’un autre tenant → message générique + ref', async () => {
    db.failNext('public', 'orders', 'update', { code: '23505', message: LEAK });
    const { POST } = await import('@/app/api/orders/delete/route');
    const res = await POST(
      new NextRequest('https://app.test/api/orders/delete', {
        method: 'POST',
        body: JSON.stringify({ ids: ['11111111-1111-4111-8111-111111111112'] }),
      })
    );
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('SHO-OTHER-TENANT');
    expect(JSON.stringify(body)).not.toContain('whsec_TEST');
    expect(body.ref).toMatch(/^[0-9a-f]{8}$/);
    const logs = consoleText();
    expect(logs).toContain(body.ref);
    expect(logs).toContain('23505');
    expect(logs).not.toContain('SHO-OTHER-TENANT');
  });

  it('messages : erreur de lecture → générique, sans le texte brut', async () => {
    db.failNext('public', 'messages', 'select', { code: 'PGRST100', message: LEAK });
    const { GET } = await import('@/app/api/messages/route');
    const res = await GET(new NextRequest('https://app.test/api/messages'));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('SHO-OTHER-TENANT');
  });
});
