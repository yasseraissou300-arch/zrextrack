import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { runRelance } from '@/lib/ai-chatbot/relance';

// Relance des conversations inactives — voir src/lib/ai-chatbot/relance.ts.
//
// Deux appelants, deux portées :
//   - planificateur : `Authorization: Bearer <CRON_SECRET>` → tous les tenants.
//     Si CRON_SECRET n'est pas configuré, ce mode est REFUSÉ (l'ancien code
//     ouvrait alors la relance multi-tenant à n'importe qui).
//   - bouton du tableau de bord : session utilisateur → SES sessions seulement.
// Le secret n'est plus accepté dans l'URL (?secret=) : il finirait dans les
// journaux d'accès.

function cronAuthorized(req: NextRequest, body: { secret?: unknown }): boolean {
  const expected = process.env.CRON_SECRET || '';
  if (!expected) return false;
  const header = req.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ')
    ? header.slice(7)
    : typeof body.secret === 'string'
      ? body.secret
      : '';
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handle(req: NextRequest, body: { secret?: unknown }) {
  const service = createServiceClient();
  // ?dry_run=1 : compte ce qui serait relancé, sans rien envoyer ni écrire.
  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1';

  if (cronAuthorized(req, body)) {
    const result = await runRelance(service, undefined, { dryRun });
    return NextResponse.json({ ok: true, scope: 'all', ...result });
  }

  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await runRelance(service, user.id, { dryRun });
  return NextResponse.json({ ok: true, scope: 'tenant', ...result });
}

// POST — planificateur (Bearer) ou bouton du tableau de bord (session)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handle(req, body ?? {});
}

// GET — même logique, sans corps
export async function GET(req: NextRequest) {
  return handle(req, {});
}
