// LOG-1 / LOG-3 — les corps d'erreur des fournisseurs ne sont jamais recopiés.
//
// Evolution : le corps peut contenir le numéro / JID complet du destinataire,
// l'hôte Evolution (page d'erreur du proxy), une erreur interne. Il partait
// dans autotim.jobs.last_error, messages.error_message, les réponses HTTP et
// les journaux.
// Gemini (refine-prompt) : le corps d'erreur Google peut citer l'URL appelée
// (donc ?key=) et le prompt du marchand ; il était écrit par console.error.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { classifyEvolutionError, evolutionErrorMessage } from '@/lib/whatsapp/evolution-error';
import type { Job } from '@/lib/queue/types';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PHONE_JID = '213550123456@s.whatsapp.net';
const HOST = 'evolution-internal-host.up.railway.app';
const EVO_BODY = `{"status":500,"error":"Internal","response":{"message":["jid ${PHONE_JID} at https://${HOST}/message"]}}`;
const GEMINI_KEY = 'AIzaSyTEST-KEY-0123456789';

let db: FakeSupabase;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () =>
    Object.assign(Object.create(db), {
      from: db.from.bind(db),
      auth: { getUser: async () => ({ data: { user: { id: TENANT } } }) },
    }),
}));
vi.mock('@/lib/user-creds', () => ({
  resolveEvolutionCreds: async () => ({ url: 'https://evolution.test', key: 'k' }),
  resolveGeminiKey: async () => GEMINI_KEY,
  missingCredentialsResponse: () => ({ error: 'missing' }),
}));

function consoleText(): string {
  return (['log', 'info', 'warn', 'error'] as const)
    .flatMap((m) => (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls)
    .map((c) => c.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    .join(' | ');
}
const leaks = (s: string) =>
  [PHONE_JID, '550123456', HOST, GEMINI_KEY].filter((x) => s.includes(x));

beforeEach(() => {
  db = new FakeSupabase();
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('classifyEvolutionError', () => {
  it.each([
    [500, 'Connection Closed', 'session_closed'],
    [400, '{"exists":false}', 'number_not_on_whatsapp'],
    [401, '', 'unauthorized'],
    [404, '', 'instance_not_found'],
    [429, '', 'rate_limited'],
    [400, 'bad', 'rejected'],
    [502, '<html>proxy</html>', 'server_error'],
  ])('%s %s → %s', (status, body, kind) => {
    expect(classifyEvolutionError(status as number, body as string)).toBe(kind);
  });

  it('message sûr : code + libellé + réf, jamais le corps', () => {
    const msg = evolutionErrorMessage('test', 500, EVO_BODY);
    expect(msg).toMatch(/^Evolution HTTP 500 — .+ \(réf E-[0-9a-f]{8}\)$/);
    expect(leaks(msg + consoleText())).toEqual([]);
  });
});

describe('file whatsapp.send — last_error et journaux', () => {
  it('échec Evolution : ni numéro, ni JID, ni hôte dans le job ni dans les journaux', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(EVO_BODY, { status: 500 }))
    );
    db.seed('public', 'whatsapp_instances', [
      {
        user_id: TENANT,
        instance_name: 'inst',
        service_type: 'auto_confirmation',
        connected: true,
      },
    ]);
    const { handleWhatsAppSend } = await import('@/lib/queue/handlers/whatsapp-send');
    const r = await handleWhatsAppSend({
      id: 'j1',
      tenant_id: TENANT,
      type: 'whatsapp.send',
      payload: { phone: '0550123456', message: 'Salam' },
      status: 'running',
      run_after: new Date().toISOString(),
      attempts: 1,
      max_attempts: 1,
      locked_at: new Date().toISOString(),
      locked_by: 'w',
      last_error: null,
      idempotency_key: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Job);
    expect(r.outcome).toBe('failed');
    const err = (r as { error?: string }).error ?? '';
    expect(err).toMatch(/^Evolution HTTP 500 — /);
    expect(leaks(err + consoleText())).toEqual([]);
  });
});

describe('refine-prompt — corps d’erreur Gemini', () => {
  it('erreur Gemini : la clé (?key=) et le corps ne sont jamais journalisés', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            `{"error":{"message":"API key not valid. url=https://generativelanguage.googleapis.com/v1beta/models/x?key=${GEMINI_KEY}"}}`,
            { status: 400 }
          )
      )
    );
    const { POST } = await import('@/app/api/ai-chatbot/refine-prompt/route');
    const res = await POST(
      new NextRequest('https://app.test/api/ai-chatbot/refine-prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'Mon prompt secret de marchand' }),
      })
    );
    expect(res.status).toBe(502);
    const all = (await res.text()) + consoleText();
    expect(leaks(all)).toEqual([]);
    expect(all).not.toContain('Mon prompt secret');
  });
});
