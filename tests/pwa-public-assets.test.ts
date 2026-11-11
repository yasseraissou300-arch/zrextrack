import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import manifest from '@/app/manifest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const anon = (path: string) => middleware(new NextRequest(`https://autotim.vercel.app${path}`));

// Le navigateur télécharge le manifeste et les icônes SANS cookie de session.
describe('PWA — fichiers publics', () => {
  it('manifeste et icônes servis sans session (pas de redirection /login)', () => {
    for (const p of ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png'])
      expect(anon(p).headers.get('location'), p).toBeNull();
  });

  it('l’espace connecté reste protégé — aucun préfixe voisin ouvert', () => {
    for (const p of [
      '/admin-dashboard',
      '/clients',
      '/icons',
      '/iconsX/a',
      '/manifest.webmanifestX',
    ])
      expect(new URL(anon(p).headers.get('location')!).pathname, p).toBe('/login');
  });

  it('chaque icône du manifeste existe dans public/', () => {
    const m = manifest();
    expect(m.icons!.length).toBeGreaterThanOrEqual(3);
    for (const icon of m.icons!)
      expect(existsSync(join(process.cwd(), 'public', icon.src)), icon.src).toBe(true);
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/admin-dashboard');
  });
});
