// Média WhatsApp : Evolution ne télécharge plus jamais une URL de tenant.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isOwnStorageUrl,
  prepareMediaForEvolution,
  MAX_MEDIA_BYTES,
} from '@/lib/whatsapp/media-delivery';
import type { LookupFn } from '@/lib/security/safe-outbound';

const SUPA = 'https://abcdefghijklmnop.supabase.co';
const OWN = `${SUPA}/storage/v1/object/public/campaign-media/t/a.jpg`;
const publicDns: LookupFn = async () => [{ address: '142.250.74.110', family: 4 }];
const dnsMap =
  (m: Record<string, string>): LookupFn =>
  async (h) => [{ address: m[h] ?? '142.250.74.110', family: 4 }];

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPA));
afterEach(() => vi.unstubAllEnvs());

describe('isOwnStorageUrl', () => {
  it('stockage public de la plateforme → oui', () => {
    expect(isOwnStorageUrl(OWN)).toBe(true);
  });
  it.each([
    'https://abcdefghijklmnop.supabase.co.evil.example/storage/v1/object/public/x.jpg',
    'https://evil.example/abcdefghijklmnop.supabase.co/storage/v1/object/public/x.jpg',
    'http://abcdefghijklmnop.supabase.co/storage/v1/object/public/x.jpg',
    'https://abcdefghijklmnop.supabase.co/rest/v1/orders',
    'https://abcdefghijklmnop.supabase.co/storage/v1/object/sign/x.jpg',
    'https://user:pass@abcdefghijklmnop.supabase.co/storage/v1/object/public/x.jpg',
    'https://abcdefghijklmnop.supabase.co:8443/storage/v1/object/public/x.jpg',
    'https://otherproject.supabase.co/storage/v1/object/public/x.jpg',
    'pas une url',
  ])('%s → non', (u) => expect(isOwnStorageUrl(u)).toBe(false));
  it('NEXT_PUBLIC_SUPABASE_URL absente → jamais « propre »', () => {
    expect(isOwnStorageUrl(OWN, '')).toBe(false);
  });
});

describe('prepareMediaForEvolution', () => {
  it('stockage propre → URL transmise, AUCUN téléchargement', async () => {
    const fetchImpl = vi.fn();
    expect(await prepareMediaForEvolution(OWN, { fetchImpl })).toEqual({
      ok: true,
      media: OWN,
      source: 'own_storage',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('URL externe → téléchargée ici, base64 + mimetype', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchImpl = vi.fn(
      async () => new Response(png, { headers: { 'content-type': 'image/png; charset=binary' } })
    ) as unknown as typeof fetch;
    expect(
      await prepareMediaForEvolution('https://cdn.example/a.png', { fetchImpl, lookup: publicDns })
    ).toEqual({
      ok: true,
      media: Buffer.from(png).toString('base64'),
      mimetype: 'image/png',
      source: 'proxied',
    });
  });

  it('DNS vers une IP privée → refus, aucun téléchargement', async () => {
    const fetchImpl = vi.fn();
    const r = await prepareMediaForEvolution('https://cdn.example/a.png', {
      fetchImpl,
      lookup: dnsMap({ 'cdn.example': '10.1.2.3' }),
    });
    expect(r).toEqual({ ok: false, reason: 'blocked' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('redirection vers les métadonnées → refus', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/' } })
    ) as unknown as typeof fetch;
    expect(
      await prepareMediaForEvolution('https://cdn.example/a.png', { fetchImpl, lookup: publicDns })
    ).toEqual({ ok: false, reason: 'blocked' });
  });

  it('type non média (HTML, SVG) → refus', async () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream']) {
      const fetchImpl = vi.fn(
        async () => new Response('x', { headers: { 'content-type': type } })
      ) as unknown as typeof fetch;
      expect(
        await prepareMediaForEvolution('https://cdn.example/a', { fetchImpl, lookup: publicDns })
      ).toEqual({ ok: false, reason: 'bad_type' });
    }
  });

  it('Content-Length > 16 Mo → refus sans lecture', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('x', {
          headers: { 'content-type': 'video/mp4', 'content-length': String(MAX_MEDIA_BYTES + 1) },
        })
    ) as unknown as typeof fetch;
    expect(
      await prepareMediaForEvolution('https://cdn.example/v.mp4', { fetchImpl, lookup: publicDns })
    ).toEqual({ ok: false, reason: 'too_large' });
  });

  it('flux > 16 Mo sans Content-Length → coupé, refus', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(chunk); // infini : la lecture doit s'arrêter d'elle-même
      },
    });
    const fetchImpl = vi.fn(
      async () => new Response(stream, { headers: { 'content-type': 'video/mp4' } })
    ) as unknown as typeof fetch;
    expect(
      await prepareMediaForEvolution('https://cdn.example/v.mp4', { fetchImpl, lookup: publicDns })
    ).toEqual({ ok: false, reason: 'too_large' });
  });

  it('erreur HTTP / réseau → download_failed', async () => {
    const http404 = vi.fn(
      async () => new Response('no', { status: 404 })
    ) as unknown as typeof fetch;
    expect(
      await prepareMediaForEvolution('https://cdn.example/a.png', {
        fetchImpl: http404,
        lookup: publicDns,
      })
    ).toEqual({ ok: false, reason: 'download_failed' });
  });

  it('vide / invalide → invalid_url', async () => {
    expect(await prepareMediaForEvolution('')).toEqual({ ok: false, reason: 'invalid_url' });
  });
});
