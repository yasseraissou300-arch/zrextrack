// sendSheetRow : jamais bloquant, jamais l'URL ni les données dans les journaux.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const logEvent = vi.fn((..._args: unknown[]) => undefined);
vi.mock('@/lib/security/safe-log', () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

import { sendSheetRow } from '@/lib/ai-chatbot/sheets-sink';
import type { LookupFn } from '@/lib/security/safe-outbound';

const publicDns: LookupFn = async () => [{ address: '142.250.74.110', family: 4 }];
const privateDns: LookupFn = async () => [{ address: '10.0.0.7', family: 4 }];
const row = {
  type: 'auto_confirmation',
  source: 'whatsapp_ai' as const,
  data: { nom: 'Client Test', telephone: '0550000001', type: 'forged' },
  tenantId: 'tenant-a',
};

beforeEach(() => logEvent.mockClear());

describe('sendSheetRow', () => {
  it('URL interne (via DNS) → false, aucun fetch, journal sans URL ni données', async () => {
    const fetchImpl = vi.fn();
    const ok = await sendSheetRow(
      { ...row, url: 'https://hook.example/SECRET_PATH?k=TEST_KEY' },
      { fetchImpl, lookup: privateDns }
    );
    expect(ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('warn', 'sheets.sink', {
      status: 'blocked',
      reason: 'private_address',
      tenant_id: 'tenant-a',
    });
    const logged = JSON.stringify(logEvent.mock.calls);
    for (const leak of ['SECRET_PATH', 'TEST_KEY', 'hook.example', '0550000001', 'Client Test'])
      expect(logged).not.toContain(leak);
  });

  it('URL publique → POST JSON, champs fixes non écrasables', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok')) as unknown as typeof fetch;
    const ok = await sendSheetRow(
      { ...row, url: 'https://hook.example/x' },
      { fetchImpl, lookup: publicDns }
    );
    expect(ok).toBe(true);
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(init.body)).toMatchObject({
      nom: 'Client Test',
      type: 'auto_confirmation',
      source: 'whatsapp_ai',
    });
  });

  it('réponse HTTP en erreur → false + code seul', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const ok = await sendSheetRow(
      { ...row, url: 'https://hook.example/x' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, lookup: publicDns }
    );
    expect(ok).toBe(false);
    expect(logEvent).toHaveBeenCalledWith('warn', 'sheets.sink', {
      status: 'http_error',
      error_code: '500',
      tenant_id: 'tenant-a',
    });
  });

  it('URL vide → rien', async () => {
    const fetchImpl = vi.fn();
    expect(await sendSheetRow({ ...row, url: '' }, { fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
