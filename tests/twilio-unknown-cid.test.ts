// Garde Twilio : un `cid` inconnu ne doit jamais ouvrir le mode « non appliqué ».

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let fake: FakeSupabase;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => fake,
  createClient: async () => {
    throw new Error('pas de session sur un webhook Twilio');
  },
}));

import { guardTwilioRequest } from '@/lib/security/twilio-guard';
import { POST as statusPOST } from '@/app/api/voice-calls/status/route';

const A = '11111111-1111-4111-8111-111111111111';
const CALL = '33333333-3333-4333-8333-333333333333';

function req(cid: string, params: Record<string, string>) {
  return new NextRequest(`https://app.test/api/voice-calls/status?cid=${encodeURIComponent(cid)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

beforeEach(() => {
  fake = new FakeSupabase();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.test');
  fake.seed('public', 'voice_calls', [
    { id: CALL, user_id: A, status: 'initiated', outcome: null },
  ]);
});

describe('guardTwilioRequest — cid inconnu', () => {
  it('cid absent de voice_calls → 404 unknown_cid, même sans signature', async () => {
    const r = await guardTwilioRequest(
      req('44444444-4444-4444-8444-444444444444', { CallSid: 'CA1' }),
      't'
    );
    expect(r).toEqual({ ok: false, status: 404, reason: 'unknown_cid' });
  });

  it('cid forgé façon filtre PostgREST → 404, aucune écriture', async () => {
    const res = await statusPOST(
      req(`${CALL},user_id.neq.x`, { CallSid: 'CA2', CallStatus: 'no-answer' })
    );
    expect(res.status).toBe(404);
    expect(fake.all('public', 'voice_calls')[0]).toMatchObject({
      status: 'initiated',
      outcome: null,
    });
  });

  it('cid connu (tenant sans jeton) → comportement inchangé', async () => {
    const r = await guardTwilioRequest(req(CALL, { CallSid: 'CA3' }), 't');
    expect(r).toMatchObject({ ok: true, callId: CALL, userId: A, mode: 'unenforced' });
  });
});

describe('POST /api/voice-calls/status — mise à jour par id exact', () => {
  it('no-answer → outcome no_answer sur la seule ligne visée', async () => {
    fake.seed('public', 'voice_calls', [
      { id: 'other', user_id: 'B', status: 'initiated', outcome: null },
    ]);
    const res = await statusPOST(req(CALL, { CallSid: 'CA4', CallStatus: 'no-answer' }));
    expect(res.status).toBe(200);
    const rows = fake.all('public', 'voice_calls');
    expect(rows.find((r) => r.id === CALL)).toMatchObject({
      status: 'no-answer',
      outcome: 'no_answer',
    });
    expect(rows.find((r) => r.id === 'other')).toMatchObject({
      status: 'initiated',
      outcome: null,
    });
  });
});
