import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const pathname = request.nextUrl.pathname;

  // Public routes — no auth needed. On les court-circuite AVANT tout appel à
  // Supabase pour ne pas faire de réseau inutile (et éviter de bloquer /api,
  // /login, /track même si Supabase est lent).
  const publicRoutes = ['/login', '/pricing', '/auth/callback', '/api/', '/track/'];
  if (publicRoutes.some(r => pathname.startsWith(r))) {
    return supabaseResponse;
  }

  // Auth check avec garde-fou de timeout : si Supabase est lent/injoignable,
  // on NE bloque PAS la requête avec un 504 (MIDDLEWARE_INVOCATION_TIMEOUT).
  // On laisse passer — la page est client-side et ses appels API refont la
  // vraie vérif d'auth (getUser côté serveur) → aucune donnée sensible exposée.
  let user = null;
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('auth_timeout')), 5000)),
    ]);
    user = (result as { data: { user: unknown } }).data.user;
  } catch {
    // Supabase trop lent — fail open (laisse passer plutôt qu'un 504)
    return supabaseResponse;
  }

  // Not logged in — redirect to login
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'],
};
