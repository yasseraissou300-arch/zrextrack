import { imageHosts } from './image-hosts.config.mjs';

// En-têtes de sécurité appliqués à toutes les réponses (audit HDR, 2026-10-08).
// Aucune CSP ici : elle sera introduite d'abord en Report-Only (scripts inline
// de Next, images Supabase / Google Fonts) — chantier séparé.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

// Anti-iframe partout SAUF la page publique de suivi (/track), qu'un marchand
// peut vouloir intégrer dans sa boutique.
const frameHeaders = [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // HDR-3 : les source maps publiaient tout le code client (commentaires
  // compris). Désactivées en production.
  productionBrowserSourceMaps: false,
  // HDR-5 : ne plus annoncer le framework (X-Powered-By: Next.js).
  poweredByHeader: false,
  distDir: process.env.DIST_DIR || '.next',
  // Phase 0 — P0-2 : les erreurs TypeScript ne sont plus ignorées au build.
  // Vérifié : `tsc --noEmit` renvoie 0 erreur. Un type cassé fait désormais
  // échouer le build au lieu de partir en production.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  images: {
    remotePatterns: imageHosts,
    minimumCacheTTL: 60,
  },
  // Phase 0 — la redirection `/` → `/admin-dashboard` a été retirée.
  // Elle rendait la landing page publique (src/app/page.tsx) inaccessible :
  // Next applique les redirects AVANT le middleware, donc rendre `/` publique
  // côté middleware ne suffisait pas. Les visiteurs non connectés doivent voir
  // la vitrine ; les utilisateurs connectés arrivent sur le dashboard via
  // /auth/callback qui redirige déjà vers /admin-dashboard.
  async redirects() {
    return [];
  },

  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/:path((?!track(?:/|$)).*)', headers: frameHeaders },
    ];
  },

  webpack(config, { dev }) {
    if (dev) {
      const ignoredPaths = (process.env.WATCH_IGNORED_PATHS || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      config.watchOptions = {
        ignored: ignoredPaths.length
          ? ignoredPaths.map((p) => `**/${p.replace(/^\/+|\/+$/g, '')}/**`)
          : undefined,
      };
    }
    return config;
  },
};
export default nextConfig;
