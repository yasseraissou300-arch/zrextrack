// P4 — Domaine des liens de suivi envoyés aux clients.
//
// AVANT : NEXT_PUBLIC_SITE_URL absent en Production → lien vers l'ancien
// hébergement « zrextrack6753.builtwithrocket.new », silencieusement.
// Domaines de test SYNTHÉTIQUES : aucun domaine réel n'est choisi ici.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeBaseUrl,
  resolvePublicBaseUrl,
  trackingUrl,
  LEGACY_PUBLIC_URL,
  __resetPublicUrlWarnings,
} from '@/lib/public-url';
import { buildMessage, DARIJA_DEFAULTS } from '@/lib/whatsapp/message-builder';

const ORDER = {
  customer_name: 'Amine',
  tracking_number: 'ZR-123456',
  wilaya: 'Oran',
  product_name: 'Montre',
  cod: 2500,
};

let warnings: string[];
beforeEach(() => {
  __resetPublicUrlWarnings();
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((l: unknown) => {
    warnings.push(String(l));
  });
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('normalizeBaseUrl', () => {
  it.each([
    ['https://suivi.example.com', 'https://suivi.example.com'],
    ['https://suivi.example.com/', 'https://suivi.example.com'], // slash final retiré
    ['https://suivi.example.com///', 'https://suivi.example.com'],
    ['  https://suivi.example.com  ', 'https://suivi.example.com'],
    ['suivi.example.com', 'https://suivi.example.com'], // forme VERCEL_PROJECT_PRODUCTION_URL
    ['https://example.com/app/', 'https://example.com/app'], // préfixe de chemin conservé
    ['http://localhost:4028', 'http://localhost:4028'], // http seulement en local
  ])('%s → %s', (raw, expected) => {
    expect(normalizeBaseUrl(raw)).toBe(expected);
  });

  it.each([
    ['', 'vide'],
    ['   ', 'blanc'],
    ['http://suivi.example.com', 'http hors local (HTTPS conservé, jamais rétrogradé)'],
    ['ftp://suivi.example.com', 'schéma non web'],
    ['https://user:pass@suivi.example.com', 'identifiants dans l’URL'],
    ['https://suivi.example.com/?token=x', 'requête (aucun jeton dans le lien)'],
    ['https://suivi.example.com/#x', 'fragment'],
    ['pas une url', 'malformée'],
    ['https://intranet', 'hôte sans domaine'],
  ])('%s refusée (%s)', (raw) => {
    expect(normalizeBaseUrl(raw)).toBeNull();
  });
});

describe('resolvePublicBaseUrl — ordre des sources', () => {
  it('Production : NEXT_PUBLIC_SITE_URL configurée → utilisée, jamais l’ancien domaine', () => {
    const env = {
      NEXT_PUBLIC_SITE_URL: 'https://suivi.example.com/',
      VERCEL_PROJECT_PRODUCTION_URL: 'prod.example.app',
    };
    expect(resolvePublicBaseUrl(env)).toEqual({
      url: 'https://suivi.example.com',
      source: 'NEXT_PUBLIC_SITE_URL',
    });
    expect(trackingUrl('ZR-1', env)).not.toContain('builtwithrocket');
  });

  it('Production sans NEXT_PUBLIC_SITE_URL (état constaté) : domaine de production Vercel', () => {
    expect(resolvePublicBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'prod.example.app' })).toEqual({
      url: 'https://prod.example.app',
      source: 'VERCEL_PROJECT_PRODUCTION_URL',
    });
  });

  it('Preview : liens vers le domaine de PRODUCTION, jamais vers l’URL de déploiement', () => {
    const env = {
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'autotim-git-branche-xyz.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'prod.example.app',
    };
    expect(trackingUrl('ZR-1', env)).toBe('https://prod.example.app/track/ZR-1');
  });

  it('variable vide : ignorée, source suivante', () => {
    expect(
      resolvePublicBaseUrl({
        NEXT_PUBLIC_SITE_URL: '  ',
        VERCEL_PROJECT_PRODUCTION_URL: 'p.example.app',
      }).source
    ).toBe('VERCEL_PROJECT_PRODUCTION_URL');
  });

  it('variable invalide : ignorée ET journalisée, source suivante', () => {
    const r = resolvePublicBaseUrl({
      NEXT_PUBLIC_SITE_URL: 'http://suivi.example.com',
      VERCEL_PROJECT_PRODUCTION_URL: 'p.example.app',
    });
    expect(r.source).toBe('VERCEL_PROJECT_PRODUCTION_URL');
    expect(warnings.join('\n')).toContain('invalid_value_ignored');
  });

  it('rien de configuré (local) : ancien domaine, repli EXPLICITE et journalisé une fois', () => {
    expect(resolvePublicBaseUrl({})).toEqual({ url: LEGACY_PUBLIC_URL, source: 'legacy_fallback' });
    resolvePublicBaseUrl({});
    expect(warnings.filter((w) => w.includes('legacy_fallback'))).toHaveLength(1);
  });
});

describe('trackingUrl', () => {
  it('génère /track/<numéro>', () => {
    expect(trackingUrl('ZR-123456', { NEXT_PUBLIC_SITE_URL: 'https://s.example.com' })).toBe(
      'https://s.example.com/track/ZR-123456'
    );
  });
  it('numéro encodé : aucun caractère ne peut sortir du chemin', () => {
    expect(trackingUrl('A/B?x=1#y', { NEXT_PUBLIC_SITE_URL: 'https://s.example.com' })).toBe(
      'https://s.example.com/track/A%2FB%3Fx%3D1%23y'
    );
  });
});

describe('buildMessage — lien {{lien}} réellement envoyé', () => {
  it('ANCIEN DÉFAUT : sans NEXT_PUBLIC_SITE_URL mais sur Vercel → plus de builtwithrocket', () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'prod.example.app');
    const msg = buildMessage('en_transit', ORDER, new Map());
    expect(msg).toContain('https://prod.example.app/track/ZR-123456');
    expect(msg).not.toContain('builtwithrocket');
  });

  it('NEXT_PUBLIC_SITE_URL avec slash final : pas de double slash', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://s.example.com/');
    expect(buildMessage('echec', ORDER, new Map())).toContain(
      'https://s.example.com/track/ZR-123456'
    );
  });

  it('template personnalisé avec {{lien}} : même source', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://s.example.com');
    const msg = buildMessage('livre', ORDER, new Map([['livre', 'Suivi : {{lien}}']]));
    expect(msg).toBe('Suivi : https://s.example.com/track/ZR-123456');
  });

  it('statut sans {{lien}} : message inchangé', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://s.example.com');
    expect(buildMessage('livre', ORDER, new Map())).toBe(
      DARIJA_DEFAULTS.livre
        .replace('{{client}}', 'Amine')
        .replace('{{produit}}', 'Montre')
        .replace('{{tracking}}', 'ZR-123456')
    );
  });
});
