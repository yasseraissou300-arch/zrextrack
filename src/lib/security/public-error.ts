// Réponse d'erreur destinée au NAVIGATEUR : jamais le message brut.
//
// Les messages PostgREST / Postgres / Storage / fournisseurs peuvent citer le
// texte d'un filtre, un nom de table ou de contrainte, des valeurs de clé
// (« Key (tracking_number)=(…) already exists »), une URL interne ou un
// secret. Le navigateur reçoit un message générique + une référence courte ;
// le journal reçoit la même référence et le CODE d'erreur seulement.

import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { logEvent } from '@/lib/security/safe-log';

function errorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code.slice(0, 40);
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name.slice(0, 40);
  }
  return 'unknown';
}

export function internalErrorResponse(
  scope: string,
  err: unknown,
  status = 500,
  publicMessage = 'Erreur interne — réessaie dans un instant.'
): NextResponse {
  const ref = crypto.randomBytes(4).toString('hex');
  logEvent('error', scope, { status: 'failed', error_code: errorCode(err), ref });
  return NextResponse.json({ error: publicMessage, ref }, { status });
}
