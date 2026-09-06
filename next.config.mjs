import { imageHosts } from './image-hosts.config.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: true,
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