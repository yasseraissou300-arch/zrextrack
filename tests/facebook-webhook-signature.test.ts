// P0 — signature Meta du webhook Facebook Messenger.
//
// Avant : POST /api/ai-chatbot/webhook/facebook acceptait n'importe quel corps.
// Un attaquant connaissant un page_id (public) pouvait consommer les clés Gemini
// du tenant, fabriquer des commandes et les pousser vers son Google Sheet.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { verifyMetaSignature } from '@/lib/security/webhook-auth';

const SECRET = 'test-app-secret';
const sign = (body: string, secret = SECRET) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

describe('verifyMetaSignature', () => {
  const body = JSON.stringify({ object: 'page', entry: [] });

  it('accepte une signature valide', () => {
    expect(verifyMetaSignature(body, sign(body), SECRET)).toEqual({ ok: true, mode: 'verified' });
  });

  it('refuse sans en-tête (401)', () => {
    expect(verifyMetaSignature(body, null, SECRET)).toMatchObject({ ok: false, status: 401 });
  });

  it('refuse une signature calculée avec un autre secret (403)', () => {
    expect(verifyMetaSignature(body, sign(body, 'autre'), SECRET)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('refuse un corps modifié après signature (403)', () => {
    expect(verifyMetaSignature(body + ' ', sign(body), SECRET)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('refuse un algorithme autre que sha256 et un en-tête mal formé', () => {
    const hex = sign(body).split('=')[1];
    expect(verifyMetaSignature(body, 'sha1=' + hex, SECRET)).toMatchObject({ ok: false });
    expect(verifyMetaSignature(body, 'garbage', SECRET)).toMatchObject({ ok: false });
  });

  it('accepte une signature en majuscules (hex insensible à la casse)', () => {
    const upper = 'sha256=' + sign(body).split('=')[1].toUpperCase();
    expect(verifyMetaSignature(body, upper, SECRET)).toMatchObject({ ok: true });
  });

  it('déploiement progressif : sans secret configuré, non appliqué', () => {
    expect(verifyMetaSignature(body, null, '')).toEqual({ ok: true, mode: 'unenforced' });
  });
});

// ─── Route réelle ────────────────────────────────────────────────────────────
// Le client Supabase est simulé : si la route va jusqu'à la base, le test le voit.
const fromSpy = vi.fn(() => ({
  select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }),
}));
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: fromSpy }) }));
vi.mock('@/lib/user-creds', () => ({ resolveGeminiKeys: vi.fn(async () => []) }));

describe('POST /api/ai-chatbot/webhook/facebook', () => {
  const body = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE', messaging: [] }] });
  const req = (headers: Record<string, string> = {}) =>
    new NextRequest('https://x.test/api/ai-chatbot/webhook/facebook', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', ...headers },
    });

  beforeEach(() => {
    fromSpy.mockClear();
    vi.stubEnv('FACEBOOK_APP_SECRET', SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejette un POST non signé AVANT tout accès base', async () => {
    const { POST } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('rejette une signature invalide AVANT tout accès base', async () => {
    const { POST } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
    const res = await POST(req({ 'x-hub-signature-256': sign(body, 'faux') }));
    expect(res.status).toBe(403);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('traite un POST correctement signé', async () => {
    const { POST } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
    const res = await POST(req({ 'x-hub-signature-256': sign(body) }));
    expect(res.status).toBe(200);
    expect(fromSpy).toHaveBeenCalledWith('facebook_connections');
  });
});
