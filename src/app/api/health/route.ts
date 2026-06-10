import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// Endpoint public de supervision (pour UptimeRobot ou tout autre moniteur).
//
// Vérifie deux choses d'un coup :
//   1. L'app Vercel répond (sinon le moniteur n'obtient aucune réponse)
//   2. La base Supabase est joignable (requête minimale ci-dessous)
//
// Réponses :
//   200 { status: 'ok' }   → tout va bien
//   503 { status: 'error' } → base injoignable (ex. erreur 522 / projet
//                             "Unhealthy" → redémarrer le projet Supabase)
//
// Bonus : un ping toutes les 5 min maintient le projet Supabase actif
// (le plan gratuit met en pause les projets inactifs).

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServiceClient();
    // Requête la moins chère possible : un count sur `plans` (3 lignes),
    // head:true → aucune donnée transférée.
    const { error } = await supabase
      .from('plans')
      .select('id', { count: 'exact', head: true });
    if (error) throw new Error(error.message);

    return NextResponse.json({
      status: 'ok',
      db: 'up',
      time: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { status: 'error', db: 'down', detail: e?.message || 'inconnu' },
      { status: 503 },
    );
  }
}
