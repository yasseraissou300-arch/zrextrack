// Écriture concurrente-sûre de ai_chat_sessions (P3).
//
// CONSTAT : les webhooks WhatsApp et Messenger lisent la session, appellent
// Gemini (plusieurs secondes), puis RÉÉCRIVENT toute la ligne (conversation,
// extracted_data, compteurs, human_handover) par upsert. Deux messages du même
// client traités en parallèle — cas courant : « salam » puis « nheb montre »
// envoyés coup sur coup — lisent le même état ; la dernière écriture efface le
// tour de l'autre, ses données extraites, ses jetons, et peut remettre
// human_handover à false après un passage à l'humain.
//
// CORRECTIF (aucune migration) : concurrence optimiste sur la colonne EXISTANTE
// `updated_at`. L'écriture n'aboutit que si la ligne n'a pas changé depuis la
// lecture ; sinon on relit, on recalcule le tour sur l'état frais (fusion), et
// on retente. Une création concurrente est détectée par la contrainte
// UNIQUE(user_id, channel, contact_id) (23505).
//
// `updated_at` écrit est strictement croissant (max(maintenant, lu + 1 ms)) :
// deux écritures successives ne produisent jamais la même valeur, donc un
// lecteur périmé ne peut pas « retomber » sur une valeur identique (ABA).

import { logEvent } from '@/lib/security/safe-log';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export interface SessionKey {
  userId: string;
  channel: 'whatsapp' | 'facebook';
  contactId: string;
}

/** Colonnes lues ; toutes optionnelles côté base (ajouts successifs). */
export interface SessionRow {
  id: string;
  updated_at: string | null;
  conversation?: ChatTurn[] | null;
  extracted_data?: Record<string, string> | null;
  human_handover?: boolean | null;
  failure_count?: number | null;
  tokens_used?: number | null;
  [k: string]: unknown;
}

/**
 * Calcule le patch à partir de l'état FRAIS (null = pas encore de session).
 * Doit être pure : elle peut être rappelée après un conflit.
 * `patch: null` = rien à écrire (ex. échec Gemini sans session).
 */
export type BuildPatch<R> = (fresh: SessionRow | null) => {
  patch: Record<string, unknown> | null;
  result: R;
};

export type CommitOutcome<R> =
  | { ok: true; result: R; attempts: number }
  | {
      ok: false;
      reason: 'conflict' | 'db_error';
      result: R;
      attempts: number;
      error_code?: string;
    };

export const MAX_COMMIT_ATTEMPTS = 4;

type Client = { from: (table: string) => any };

/** Horodatage strictement postérieur à `previous`. */
export function nextUpdatedAt(previous: string | null | undefined, now = Date.now()): string {
  const prev = previous ? Date.parse(previous) : NaN;
  return new Date(Number.isNaN(prev) ? now : Math.max(now, prev + 1)).toISOString();
}

export async function readSession(
  supabase: Client,
  key: SessionKey
): Promise<{ row: SessionRow | null; error_code?: string }> {
  const { data, error } = await supabase
    .from('ai_chat_sessions')
    .select('*')
    .eq('user_id', key.userId)
    .eq('channel', key.channel)
    .eq('contact_id', key.contactId)
    .maybeSingle();
  if (error) return { row: null, error_code: error.code ?? 'unknown' };
  return { row: (data as SessionRow | null) ?? null };
}

export async function commitSession<R>(
  supabase: Client,
  key: SessionKey,
  seen: SessionRow | null,
  build: BuildPatch<R>,
  maxAttempts = MAX_COMMIT_ATTEMPTS
): Promise<CommitOutcome<R>> {
  let fresh = seen;
  let last = build(fresh);
  const logBase = { tenant_id: key.userId, event: key.channel };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) last = build(fresh);
    if (last.patch === null) return { ok: true, result: last.result, attempts: attempt };

    const updated_at = nextUpdatedAt(fresh?.updated_at);
    let conflict = false;

    if (!fresh) {
      const { error } = await supabase
        .from('ai_chat_sessions')
        .insert({
          user_id: key.userId,
          channel: key.channel,
          contact_id: key.contactId,
          ...last.patch,
          updated_at,
        })
        .select('id');
      if (!error) return { ok: true, result: last.result, attempts: attempt };
      if (error.code !== '23505') return dbError(error.code, attempt);
      conflict = true; // créée entre-temps par un autre message
    } else {
      let q = supabase
        .from('ai_chat_sessions')
        .update({ ...last.patch, updated_at })
        .eq('id', fresh.id)
        .eq('user_id', key.userId);
      q =
        fresh.updated_at == null ? q.is('updated_at', null) : q.eq('updated_at', fresh.updated_at);
      const { data, error } = await q.select('id');
      if (error) return dbError(error.code, attempt);
      if (Array.isArray(data) && data.length === 1) {
        return { ok: true, result: last.result, attempts: attempt };
      }
      conflict = true;
    }

    if (conflict) {
      logEvent('info', 'chat.session', { ...logBase, status: 'write_conflict_retry', attempt });
      const reread = await readSession(supabase, key);
      if (reread.error_code) return dbError(reread.error_code, attempt);
      fresh = reread.row;
    }
  }

  logEvent('error', 'chat.session', { ...logBase, status: 'session_conflict_unresolved' });
  return { ok: false, reason: 'conflict', result: last.result, attempts: maxAttempts };

  function dbError(code: string | undefined, attempt: number): CommitOutcome<R> {
    logEvent('error', 'chat.session', {
      ...logBase,
      status: 'session_write_failed',
      error_code: code ?? 'unknown',
    });
    return {
      ok: false,
      reason: 'db_error',
      result: last.result,
      attempts: attempt,
      error_code: code,
    };
  }
}
