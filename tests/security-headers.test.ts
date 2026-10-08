// En-têtes de sécurité (audit HDR) : configuration next.config.mjs.
// La preuve HTTP réelle (next start) est dans .claude/mission ; ce test fige
// la configuration pour qu'une régression soit visible en CI.

import { describe, it, expect } from 'vitest';
import nextConfig from '../next.config.mjs';

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<HeaderRule[]> {
  const cfg = nextConfig as unknown as { headers: () => Promise<HeaderRule[]> };
  return cfg.headers();
}

// Même sémantique que le motif Next `/:path((?!track(?:/|$)).*)`.
const frameSource = /^\/(?!track(?:\/|$)).*$/;

describe('next.config — en-têtes de sécurité', () => {
  it('nosniff, Referrer-Policy et Permissions-Policy sur toutes les routes', async () => {
    const all = (await rules()).find((r) => r.source === '/:path*');
    expect(all).toBeDefined();
    const h = Object.fromEntries(all!.headers.map((x) => [x.key, x.value]));
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Permissions-Policy']).toContain('camera=()');
  });

  it('X-Frame-Options SAMEORIGIN partout sauf la page publique de suivi', async () => {
    const frame = (await rules()).find((r) => r.headers.some((x) => x.key === 'X-Frame-Options'));
    expect(frame?.source).toBe('/:path((?!track(?:/|$)).*)');
    expect(frame?.headers).toEqual([{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }]);
    for (const p of ['/', '/login', '/admin-dashboard', '/messages', '/api/orders', '/trackers'])
      expect(frameSource.test(p), p).toBe(true);
    for (const p of ['/track', '/track/', '/track/ZR123'])
      expect(frameSource.test(p), p).toBe(false);
  });

  it('source maps de production désactivées et X-Powered-By retiré', () => {
    const cfg = nextConfig as unknown as {
      productionBrowserSourceMaps: boolean;
      poweredByHeader: boolean;
    };
    expect(cfg.productionBrowserSourceMaps).toBe(false);
    expect(cfg.poweredByHeader).toBe(false);
  });
});
