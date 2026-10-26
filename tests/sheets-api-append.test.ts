// Google Sheet « direct » : append réel via l'API Sheets + compte de service.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

const logEvent = vi.fn((..._args: unknown[]) => undefined);
vi.mock('@/lib/security/safe-log', () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

import { sendSheetRow, toSheetValues, spreadsheetIdOf } from '@/lib/ai-chatbot/sheets-sink';
import { getGoogleAccessToken, __resetGoogleTokenCache } from '@/lib/google/service-account';

const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
// Forme enregistrée par POST /api/ai-chatbot/googlesheets.
const STORED = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1:append`;
const row = {
  url: STORED,
  type: 'auto_confirmation',
  source: 'whatsapp_ai' as const,
  data: { nom: 'Client Test', telephone: '0550000001', wilaya: 'Oran', couleur: 'noir' },
  tenantId: 'tenant-a',
};

beforeEach(() => logEvent.mockClear());

describe('toSheetValues', () => {
  it('colonnes fixes dans un ordre stable, le reste joint en dernière colonne', () => {
    const at = new Date('2026-10-14T10:00:00.000Z');
    expect(toSheetValues(row, at)).toEqual([
      '2026-10-14T10:00:00.000Z',
      'whatsapp_ai',
      'auto_confirmation',
      'Client Test',
      '0550000001',
      'Oran',
      '',
      '',
      '',
      '',
      '',
      'couleur: noir',
    ]);
  });

  it('spreadsheetIdOf : seulement les URL sheets.googleapis.com', () => {
    expect(spreadsheetIdOf(STORED)).toBe(SHEET_ID);
    expect(spreadsheetIdOf('https://script.google.com/macros/s/X/exec')).toBeNull();
    expect(spreadsheetIdOf(`https://evil.example/v4/spreadsheets/${SHEET_ID}`)).toBeNull();
    expect(spreadsheetIdOf(`http://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`)).toBeNull();
  });
});

describe('sendSheetRow — Sheet direct', () => {
  it('append authentifié, premier onglet (A1), RAW, corps { values }', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const ok = await sendSheetRow(row, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: async () => 'TEST_ACCESS_TOKEN',
    });
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TEST_ACCESS_TOKEN');
    const body = JSON.parse(String(init.body));
    expect(body.values).toHaveLength(1);
    expect(body.values[0].slice(1, 5)).toEqual([
      'whatsapp_ai',
      'auto_confirmation',
      'Client Test',
      '0550000001',
    ]);
  });

  it('compte de service non configuré → false, aucun appel, journal sans URL', async () => {
    const fetchImpl = vi.fn();
    const ok = await sendSheetRow(row, { fetchImpl, getToken: async () => null });
    expect(ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('warn', 'sheets.sink', {
      status: 'no_service_account',
      tenant_id: 'tenant-a',
    });
  });

  it('Sheet non partagé (403) → false, code seul journalisé, jamais le jeton ni l’ID', async () => {
    const fetchImpl = vi.fn(async () => new Response('denied', { status: 403 }));
    const ok = await sendSheetRow(row, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: async () => 'TEST_ACCESS_TOKEN',
    });
    expect(ok).toBe(false);
    const logged = JSON.stringify(logEvent.mock.calls);
    expect(logged).toContain('"error_code":"403"');
    for (const leak of ['TEST_ACCESS_TOKEN', SHEET_ID, '0550000001'])
      expect(logged).not.toContain(leak);
  });

  it('webhook Apps Script : chemin SSRF inchangé, aucun jeton Google envoyé', async () => {
    const getToken = vi.fn(async () => 'TEST_ACCESS_TOKEN');
    const fetchImpl = vi.fn(async () => new Response('ok'));
    const ok = await sendSheetRow(
      { ...row, url: 'https://script.google.com/macros/s/ABC/exec' },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getToken,
        lookup: async () => [{ address: '142.250.74.110', family: 4 }],
      }
    );
    expect(ok).toBe(true);
    expect(getToken).not.toHaveBeenCalled();
    const init = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.stringify(init[1].headers ?? {})).not.toContain('Bearer');
  });
});

describe('getGoogleAccessToken', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  beforeEach(() => {
    __resetGoogleTokenCache();
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'bot@test-project.iam.gserviceaccount.com');
    vi.stubEnv('GOOGLE_PRIVATE_KEY', pem.replace(/\n/g, '\\n'));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('JWT signé échangé une fois, puis mis en cache jusqu’à l’expiration − 60 s', async () => {
    let t = 1_000_000;
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ access_token: 'TEST_AT', expires_in: 3600 }))
    ) as unknown as typeof fetch;
    expect(await getGoogleAccessToken(fetchImpl, () => t)).toBe('TEST_AT');
    t += 3_000_000; // 50 min
    expect(await getGoogleAccessToken(fetchImpl, () => t)).toBe('TEST_AT');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t += 600_000; // 60 min : < 60 s de marge → renouvellement
    await getGoogleAccessToken(fetchImpl, () => t);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const body = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toMatch(
      /^grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=[\w-]+\.[\w-]+\.[\w-]+$/
    );
  });

  it('variables absentes → null sans appel', async () => {
    vi.stubEnv('GOOGLE_PRIVATE_KEY', '');
    const fetchImpl = vi.fn();
    expect(await getGoogleAccessToken(fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('réponse sans access_token → null, rien en cache', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 }));
    expect(await getGoogleAccessToken(fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(await getGoogleAccessToken(fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
