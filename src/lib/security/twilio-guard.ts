// Garde partagée des webhooks Twilio — Phase 0, P0-3.
//
// Les 3 endpoints voix (twiml / status / gather) reçoivent des requêtes de
// Twilio identifiées par `?cid=<voice_calls.id>`. On résout le tenant à partir
// de ce cid, on récupère SON Auth Token, puis on valide la signature.
//
// Le `cid` sert uniquement de clé de recherche — il n'accorde aucune confiance.
// C'est la signature qui authentifie.

import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { validateTwilioRequest, publicUrlFromRequest, readTwilioParams } from './twilio-signature';
import { isReplay } from './webhook-auth';
import { logEvent } from './safe-log';

export interface TwilioGuardOk {
  ok: true;
  /** Paramètres form-encoded déjà lus (le body ne peut être relu ensuite). */
  params: Record<string, string>;
  callId: string;
  userId: string | null;
  mode: 'verified' | 'unenforced';
}
export interface TwilioGuardFail {
  ok: false;
  status: number;
  reason: string;
}

/**
 * Valide une requête entrante Twilio et renvoie les paramètres déjà parsés.
 *
 * IMPORTANT : cette fonction consomme le corps de la requête. Les appelants
 * doivent utiliser `result.params` au lieu de `req.formData()`.
 */
export async function guardTwilioRequest(
  req: NextRequest,
  scope: string
): Promise<TwilioGuardOk | TwilioGuardFail> {
  const cid = req.nextUrl.searchParams.get('cid') || '';
  const params = await readTwilioParams(req);
  const signature = req.headers.get('x-twilio-signature');

  if (!cid) {
    logEvent('warn', scope, { status: 'rejected', reason: 'missing_cid' });
    return { ok: false, status: 400, reason: 'missing_cid' };
  }

  // Résolution du tenant → son Auth Token Twilio.
  const supabase = createServiceClient();
  const { data: call } = await supabase
    .from('voice_calls')
    .select('id, user_id')
    .eq('id', cid)
    .maybeSingle();

  const userId: string | null = call?.user_id ?? null;
  let authToken: string | null = null;
  if (userId) {
    const { data: settings } = await supabase
      .from('voice_call_settings')
      .select('auth_token')
      .eq('user_id', userId)
      .maybeSingle();
    authToken = settings?.auth_token ?? null;
  }

  const check = validateTwilioRequest({
    authToken,
    signature,
    url: publicUrlFromRequest(
      req,
      process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL
    ),
    params,
  });

  if (!check.ok) {
    logEvent('warn', scope, {
      status: 'rejected',
      reason: check.reason,
      tenant_id: userId ?? undefined,
      conversation_id: cid,
    });
    return { ok: false, status: check.status, reason: check.reason };
  }

  if (check.mode === 'unenforced') {
    logEvent('warn', scope, {
      status: 'unauthenticated_accepted',
      reason: 'auth_token Twilio indisponible — signature non vérifiée',
      tenant_id: userId ?? undefined,
    });
  }

  // Anti-rejeu : Twilio ne signe pas d'horodatage, donc une requête capturée
  // reste rejouable. On déduplique sur CallSid + statut de l'événement.
  const replayKey = `twilio:${scope}:${params.CallSid || cid}:${params.CallStatus || params.Digits || ''}`;
  if (params.CallSid && isReplay(replayKey)) {
    logEvent('info', scope, { status: 'skipped_replay', conversation_id: cid });
    return { ok: false, status: 409, reason: 'replay' };
  }

  return { ok: true, params, callId: cid, userId, mode: check.mode };
}
