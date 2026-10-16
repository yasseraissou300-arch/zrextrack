// URL de média téléchargée par Evolution : jamais une adresse interne.

import { describe, it, expect } from 'vitest';
import { mediaUrlError } from '@/lib/security/media-url';
import type { LookupFn } from '@/lib/security/safe-outbound';

const dns =
  (address: string): LookupFn =>
  async () => [{ address, family: address.includes(':') ? 6 : 4 }];
const failing: LookupFn = async () => {
  throw new Error('ENOTFOUND');
};

describe('mediaUrlError', () => {
  it('vide → accepté', async () => {
    expect(await mediaUrlError('')).toBeNull();
    expect(await mediaUrlError(undefined)).toBeNull();
  });

  it('Supabase Storage public (upload de campagne) → accepté', async () => {
    const url =
      'https://abcdefghijklmnop.supabase.co/storage/v1/object/public/campaign-media/u/1.jpg';
    expect(await mediaUrlError(url, dns('104.18.38.10'))).toBeNull();
  });

  it.each([
    ['http://redis.railway.internal:6379/', 'locale ou privée'],
    ['http://localhost:5432/', 'locale ou privée'],
    ['http://169.254.169.254/latest/meta-data/', 'locale ou privée'],
    ['http://[::1]/', 'locale ou privée'],
  ])('%s → refusé (statique, sans DNS)', async (url, msg) => {
    expect(await mediaUrlError(url, failing)).toContain(msg);
  });

  it('nom public qui résout vers une IP privée → refusé', async () => {
    expect(await mediaUrlError('https://cdn.attacker.example/a.jpg', dns('10.0.0.8'))).toContain(
      'locale ou privée'
    );
  });

  it('nom introuvable → refusé avec un message clair', async () => {
    expect(await mediaUrlError('https://nx.example/a.jpg', failing)).toContain('introuvable');
  });

  it('protocole non web / type invalide → refusé', async () => {
    expect(await mediaUrlError('file:///etc/passwd')).toContain('invalide');
    expect(await mediaUrlError(42)).toContain('invalide');
  });
});
