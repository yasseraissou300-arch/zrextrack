import type { MetadataRoute } from 'next';

// Manifeste PWA : permet d'installer AutoTim sur l'écran d'accueil du
// téléphone (« Ajouter à l'écran d'accueil ») et de l'ouvrir en plein écran,
// comme une application. La plupart des marchands gèrent leurs commandes
// depuis leur téléphone.
//
// Pas de service worker : aucune page de l'espace connecté n'est mise en cache
// (données commandes / clients), l'application reste toujours en ligne.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AutoTim — Suivi commandes',
    short_name: 'AutoTim',
    description: 'Suivi des commandes et notifications WhatsApp automatiques pour e-commerçants.',
    start_url: '/admin-dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'fr',
    background_color: '#f5f3ff',
    theme_color: '#6d28d9',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
