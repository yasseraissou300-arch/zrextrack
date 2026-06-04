import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Middleware d'auth "optimiste" — AUCUN appel réseau.
//
// Avant, ce middleware appelait supabase.auth.getUser() (requête réseau vers
// l'auth Supabase) sur CHAQUE page. Depuis le runtime Edge de Vercel, cet appel
// pouvait hanger → Vercel renvoyait 504 MIDDLEWARE_INVOCATION_TIMEOUT et tout
// le dashboard devenait inaccessible.
//
// Nouvelle approche : on vérifie UNIQUEMENT la présence d'un cookie de session
// Supabase (vérif locale, instantanée, jamais de réseau → jamais de timeout).
//   - pas de cookie  → redirection /login
//   - cookie présent → on laisse passer
//
// La VRAIE validation d'auth (token valide, non révoqué) se fait dans les
// routes /api (getUser côté serveur, runtime Node). Donc même si quelqu'un
// forge un cookie, il ne verra qu'une coquille de page vide : toutes les
// données passent par des API protégées qui renvoient 401. Aucune fuite.

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Routes publiques — aucune auth nécessaire
  const publicRoutes = ['/login', '/pricing', '/auth/callback', '/api/', '/track/'];
  if (publicRoutes.some(r => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // Vérif locale : un cookie de session Supabase existe-t-il ?
  // @supabase/ssr stocke le token dans `sb-<ref>-auth-token` (parfois découpé
  // en `.0`, `.1`...). On cherche n'importe quel cookie qui matche.
  const hasSession = request.cookies.getAll().some(
    c => c.name.startsWith('sb-') && c.name.includes('auth-token') && !!c.value
  );

  if (!hasSession) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'],
};
