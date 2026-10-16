// Envoi d'une ligne vers la cible Google Sheets configurée par le marchand
// (chatbot_configs.google_sheets_url). Deux formes, distinguées par l'URL :
//
//   1. Google Sheet « direct » (onglet Google Sheets du chatbot) : l'URL
//      enregistrée est https://sheets.googleapis.com/v4/spreadsheets/<id>/…
//      → API Sheets `values:append` avec le jeton du COMPTE DE SERVICE de la
//      plateforme (le marchand a partagé son Sheet avec cet email).
//      Avant : simple POST JSON sans OAuth vers cette URL → toujours refusé
//      par Google, aucune ligne n'arrivait.
//   2. Webhook (Apps Script / Make / Zapier / n8n) : POST JSON via la garde
//      SSRF (safePostJson).
//
// Jamais bloquant pour la conversation : un échec est journalisé (code seul,
// jamais l'URL ni les données) et avalé.

import { safePostJson, OutboundBlocked, type SafePostDeps } from '@/lib/security/safe-outbound';
import { getGoogleAccessToken } from '@/lib/google/service-account';
import { logEvent } from '@/lib/security/safe-log';

export interface SheetRowInput {
  url: string;
  type: string;
  source: 'whatsapp_ai' | 'facebook_ai';
  data: Record<string, string>;
  tenantId: string;
}

export interface SheetSinkDeps extends SafePostDeps {
  getToken?: () => Promise<string | null>;
}

const SHEETS_API =
  /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/([A-Za-z0-9_-]{10,100})(?:\/|$)/;

/** Colonnes fixes (ordre stable d'une commande à l'autre), puis le reste. */
export const SHEET_COLUMNS = [
  'nom',
  'telephone',
  'wilaya',
  'commune',
  'adresse',
  'produit',
  'quantite',
  'prix',
] as const;

export function spreadsheetIdOf(url: string): string | null {
  return url.match(SHEETS_API)?.[1] ?? null;
}

/** [date, source, type, nom, telephone, …, autres « clé: valeur » joints]. */
export function toSheetValues(
  input: Pick<SheetRowInput, 'type' | 'source' | 'data'>,
  at: Date
): string[] {
  const fixed = SHEET_COLUMNS.map((k) => input.data[k] ?? '');
  const rest = Object.keys(input.data)
    .filter((k) => !(SHEET_COLUMNS as readonly string[]).includes(k))
    .sort()
    .map((k) => `${k}: ${input.data[k]}`)
    .join(' | ');
  return [at.toISOString(), input.source, input.type, ...fixed, rest];
}

async function appendViaSheetsApi(
  spreadsheetId: string,
  input: SheetRowInput,
  deps: SheetSinkDeps
): Promise<boolean> {
  const token = await (deps.getToken ?? (() => getGoogleAccessToken()))();
  if (!token) {
    logEvent('warn', 'sheets.sink', { status: 'no_service_account', tenant_id: input.tenantId });
    return false;
  }
  // Plage « A1 » sans nom d'onglet = PREMIER onglet, quelle que soit la
  // langue du Sheet (l'ancien « Sheet1 » échouait sur « Feuille 1 »).
  const endpoint =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append` +
    '?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
  try {
    const res = await (deps.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [toSheetValues(input, new Date())] }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8_000),
    });
    if (!res.ok) {
      logEvent('warn', 'sheets.sink', {
        status: 'sheets_api_error',
        // 403/404 = Sheet non partagé avec le compte de service, ou supprimé.
        error_code: String(res.status),
        tenant_id: input.tenantId,
      });
      return false;
    }
    return true;
  } catch {
    logEvent('warn', 'sheets.sink', {
      status: 'sheets_api_unreachable',
      tenant_id: input.tenantId,
    });
    return false;
  }
}

export async function sendSheetRow(
  input: SheetRowInput,
  deps: SheetSinkDeps = {}
): Promise<boolean> {
  if (!input.url) return false;

  const spreadsheetId = spreadsheetIdOf(input.url);
  if (spreadsheetId) return appendViaSheetsApi(spreadsheetId, input, deps);

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
