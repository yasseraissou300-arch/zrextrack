import { imageHosts } from './image-hosts.config.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: true,
  distDir: process.env.DIST_DIR || '.next',
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: imageHosts,
    minimumCacheTTL: 60,
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/admin-dashboard',
        permanent: false,
      },
    ];
  },

  webpack(
    config,
    {
      dev: dev
    }
  ) {
    // Component tagger — uniquement en dev si le package est disponible
    if (dev) {
      try {
        require.resolve('@dhiwise/component-tagger/nextLoader');
        config.module.rules.push({
          test: /\.(jsx|tsx)$/,
          exclude: [/node_modules/],
          use: [{ loader: '@dhiwise/component-tagger/nextLoader' }],
        });
      } catch (_) {
        // package non installé, on ignore silencieusement
      }
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