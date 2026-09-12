// Phase 0 — Tests de sécurité des webhooks (P0-1 et P0-3).
//
// Scénarios exigés : VALID / INVALID / REPLAY / MALFORMED.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { verifyWebhookSecret, isReplay, webhookTokenQuery } from '@/lib/security/webhook-auth';
import {
  validateTwilioRequest,
  computeTwilioSignature,
  publicUrlFromRequest,
} from '@/lib/security/twilio-signature';
import { maskPhone, shortHash } from '@/lib/security/safe-log';

const ENV = 'TEST_WEBHOOK_SECRET';
const req = (url: string, headers: Record<string, string> = {}) =>
  ({ url, headers: new Headers(headers) }) as unknown as Parameters<typeof verifyWebhookSecret>[0];

describe('P0-1 — secret partagé du webhook WhatsApp', () => {
  beforeEach(() => {
    delete process.env[ENV];
  });
  afterEach(() => {
    delete process.env[ENV];
  });

  it('VALID — token correct en query → accepté', () => {
    process.env[ENV] = 'secret-abc';
    const r = verifyWebhookSecret(req('https://x.app/api/wh?token=secret-abc'), ENV);
    expect(r).toEqual({ ok: true, mode: 'verified' });
  });

  it('VALID — token correct en en-tête → accepté', () => {
    process.env[ENV] = 'secret-abc';
    const r = verifyWebhookSecret(
      req('https://x.app/api/wh', { 'x-webhook-token': 'secret-abc' }),
      ENV
    );
    expect(r).toEqual({ ok: true, mode: 'verified' });
  });

  it('INVALID — mauvais token → 403', () => {
    process.env[ENV] = 'secret-abc';
    const r = verifyWebhookSecret(req('https://x.app/api/wh?token=faux'), ENV);
    expect(r).toMatchObject({ ok: false, reason: 'bad_token', status: 403 });
  });

  it("INVALID — token absent alors qu'un secret est configuré → 401", () => {
    process.env[ENV] = 'secret-abc';
    const r = verifyWebhookSecret(req('https://x.app/api/wh'), ENV);
    expect(r).toMatchObject({ ok: false, reason: 'missing_token', status: 401 });
  });

  it("DÉPLOIEMENT PROGRESSIF — sans secret configuré, on n'applique pas encore", () => {
    // Garantit qu\'activer ce code ne casse pas les instances déjà connectées.
    const r = verifyWebhookSecret(req('https://x.app/api/wh'), ENV);
    expect(r).toEqual({ ok: true, mode: 'unenforced' });
  });

  it('un préfixe du secret ne passe pas (comparaison stricte)', () => {
    process.env[ENV] = 'secret-abcdef';
    expect(verifyWebhookSecret(req('https://x.app/api/wh?token=secret'), ENV).ok).toBe(false);
  });

  it("webhookTokenQuery n'ajoute rien tant qu'aucun secret n'existe", () => {
    expect(webhookTokenQuery(ENV)).toBe('');
    process.env[ENV] = 'a b&c';
    expect(webhookTokenQuery(ENV)).toBe('?token=a%20b%26c');
  });
});

describe('REPLAY — idempotence', () => {
  it('le premier passage est accepté, le second rejeté', () => {
    const id = 'msg-' + crypto.randomUUID();
    expect(isReplay(id)).toBe(false);
    expect(isReplay(id)).toBe(true);
    expect(isReplay(id)).toBe(true);
  });

  it('des identifiants différents ne se bloquent pas entre eux', () => {
    expect(isReplay('a-' + crypto.randomUUID())).toBe(false);
    expect(isReplay('b-' + crypto.randomUUID())).toBe(false);
  });

  it('un identifiant vide ne bloque jamais (pas de faux positif)', () => {
    expect(isReplay('')).toBe(false);
    expect(isReplay('')).toBe(false);
  });
});

describe('P0-3 — signature Twilio', () => {
  const TOKEN = 'auth-token-twilio';
  const URL_ = 'https://autotim.app/api/voice-calls/twiml?cid=abc-123';
  const PARAMS = { CallSid: 'CA123', From: '+213556172674', CallStatus: 'in-progress' };
  const SIG = computeTwilioSignature(TOKEN, URL_, PARAMS);

  it('VALID — signature correcte → accepté', () => {
    expect(
      validateTwilioRequest({ authToken: TOKEN, signature: SIG, url: URL_, params: PARAMS })
    ).toEqual({ ok: true, mode: 'verified' });
  });

  it('INVALID — signature forgée → 403', () => {
    expect(
      validateTwilioRequest({ authToken: TOKEN, signature: 'ZmFrZQ==', url: URL_, params: PARAMS })
    ).toMatchObject({ ok: false, reason: 'bad_signature', status: 403 });
  });

  it('INVALID — en-tête de signature absent → 401', () => {
    expect(
      validateTwilioRequest({ authToken: TOKEN, signature: null, url: URL_, params: PARAMS })
    ).toMatchObject({ ok: false, reason: 'missing_signature', status: 401 });
  });

  it('MALFORMED — paramètre altéré → rejeté', () => {
    expect(
      validateTwilioRequest({
        authToken: TOKEN,
        signature: SIG,
        url: URL_,
        params: { ...PARAMS, From: '+213999999999' },
      }).ok
    ).toBe(false);
  });

  it("MALFORMED — cid falsifié dans l'URL → rejeté", () => {
    expect(
      validateTwilioRequest({
        authToken: TOKEN,
        signature: SIG,
        url: 'https://autotim.app/api/voice-calls/twiml?cid=VICTIME',
        params: PARAMS,
      }).ok
    ).toBe(false);
  });

  it("l'ordre des paramètres n'a pas d'incidence", () => {
    const inverse = { CallStatus: 'in-progress', From: '+213556172674', CallSid: 'CA123' };
    expect(computeTwilioSignature(TOKEN, URL_, inverse)).toBe(SIG);
  });

  it('sans auth token → mode non appliqué (déploiement progressif)', () => {
    expect(
      validateTwilioRequest({ authToken: null, signature: null, url: URL_, params: {} })
    ).toEqual({ ok: true, mode: 'unenforced' });
  });

  it('publicUrlFromRequest respecte les en-têtes de proxy', () => {
    const r = new Request('http://interne.local/api/voice-calls/status?cid=1', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'autotim.app' },
    });
    expect(publicUrlFromRequest(r)).toBe('https://autotim.app/api/voice-calls/status?cid=1');
  });
});

describe('Journalisation sans données personnelles', () => {
  it('masque les numéros de téléphone', () => {
    expect(maskPhone('213556172674@s.whatsapp.net')).toBe('213***674');
    expect(maskPhone('213556172674')).not.toContain('556172');
  });

  it('tolère les entrées vides ou courtes', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone(null)).toBe('');
    expect(maskPhone('12345')).toBe('***');
  });

  it('shortHash est stable et ne révèle pas la valeur', () => {
    const v = 'donnee-sensible';
    expect(shortHash(v)).toBe(shortHash(v));
    expect(shortHash(v)).not.toContain('sensible');
    expect(shortHash('')).toBe('');
  });
});
