import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

// Quand l'URL de retour n'est pas autorisée côté Supabase, le code OAuth arrive
// sur la racine (/?code=…). Il doit être transmis à /auth/callback.
describe('middleware — code de connexion reçu sur la racine', () => {
  it('redirige /?code=… vers /auth/callback?code=…', () => {
    const res = middleware(new NextRequest('https://autotim.vercel.app/?code=abc-123'));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/auth/callback');
    expect(loc.searchParams.get('code')).toBe('abc-123');
  });

  it('laisse la landing / sans code publique', () => {
    const res = middleware(new NextRequest('https://autotim.vercel.app/'));
    expect(res.headers.get('location')).toBeNull();
  });
});
