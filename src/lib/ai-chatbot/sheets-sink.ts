// Envoi d'une ligne vers la cible Google Sheets configurée par le marchand
// (chatbot_configs.google_sheets_url). Jamais bloquant pour la conversation :
// un échec est journalisé (code seul, jamais l'URL ni les données) et avalé.

import { safePostJson, OutboundBlocked, type SafePostDeps } from '@/lib/security/safe-outbound';
import { logEvent } from '@/lib/security/safe-log';

export interface SheetRowInput {
  url: string;
  type: string;
  source: 'whatsapp_ai' | 'facebook_ai';
  data: Record<string, string>;
  tenantId: string;
}

export async function sendSheetRow(
  input: SheetRowInput,
  deps: SafePostDeps = {}
): Promise<boolean> {
  if (!input.url) return false;
  // Champs fixes APRÈS les données extraites : jamais écrasés par la conversation.
  const body = {
    ...input.data,
    type: input.type,
    timestamp: new Date().toISOString(),
    source: input.source,
  };
  try {
    const res = await safePostJson(input.url, body, deps);
    if (!res.ok) {
      logEvent('warn', 'sheets.sink', {
        status: 'http_error',
        error_code: String(res.status),
        tenant_id: input.tenantId,
      });
      return false;
    }
    return true;
  } catch (e) {
    logEvent('warn', 'sheets.sink', {
      status: 'blocked',
      reason: e instanceof OutboundBlocked ? e.reason : 'unexpected',
      tenant_id: input.tenantId,
    });
    return false;
  }
}
