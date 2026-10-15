// Content-Security-Policy — d'abord en REPORT-ONLY (aucun blocage).
//
// Construite à partir des sources réellement chargées par l'application
// (inventaire 2026-10-14) : scripts et styles servis par Next, Google Fonts
// (src/styles/tailwind.css), Supabase (REST, Auth, Realtime en WebSocket,
// Storage), images d'avatars / pages Facebook / médias / QR (data:).
// Aucun iframe, aucun formulaire externe, aucun script tiers, aucun eval.
//
// EXCEPTIONS DOCUMENTÉES :
// - script-src 'unsafe-inline' : Next.js (App Router) injecte des scripts
//   inline d'amorçage (self.__next_f.push) différents à chaque page, et les
//   pages sont pré-rendues statiquement : ni empreinte ni nonce possible sans
//   rendre toutes les pages dynamiques. Exigé aussi par le script de thème de
//   src/app/layout.tsx. Retirable plus tard : nonce par requête dans
//   src/middleware.ts + 'strict-dynamic' (au prix du rendu dynamique).
// - style-src 'unsafe-inline' : attributs style= posés par recharts, sonner et
//   Next (next/image). Faible risque (pas d'exécution de code).
// - img-src https: : avatars Google/Facebook, CDN Facebook, Storage Supabase,
//   hôtes des remotePatterns ; une image ne peut pas exécuter de code.
// PAS de 'unsafe-eval' : Next ne l'utilise pas en production.

/** Origine Supabase (https) et son équivalent WebSocket (Realtime). */
function supabaseOrigins(url) {
  try {
    const u = new URL(url);
    return [`https://${u.host}`, `wss://${u.host}`];
  } catch {
    return ['https://*.supabase.co', 'wss://*.supabase.co'];
  }
}

export function buildCsp(env = process.env) {
  const supabase = supabaseOrigins(env.NEXT_PUBLIC_SUPABASE_URL || '');
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'blob:', ...supabase.filter((o) => o.startsWith('https://'))],
    'connect-src': ["'self'", ...supabase],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'report-uri': ['/api/csp-report'],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}
