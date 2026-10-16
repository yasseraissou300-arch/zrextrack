// SSRF : POST vers une URL de marchand (Google Sheets / Apps Script / n8n…).

import { describe, it, expect, vi } from 'vitest';
import {
  isPublicAddress,
  checkOutboundUrl,
  safePostJson,
  OutboundBlocked,
  type LookupFn,
} from '@/lib/security/safe-outbound';
import { sheetsUrlError } from '@/lib/ai-chatbot/sheets-url';

const publicDns: LookupFn = async () => [{ address: '142.250.74.110', family: 4 }];
const dnsTo =
  (map: Record<string, string>): LookupFn =>
  async (h) => [{ address: map[h] ?? '142.250.74.110', family: map[h]?.includes(':') ? 6 : 4 }];

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof OutboundBlocked ? e.reason : 'other';
  }
}

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:7f00:1',
    '64:ff9b::a9fe:a9fe',
    'ff02::1',
    'not-an-ip',
  ])('%s → non public', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each([
    '142.250.74.110',
    '8.8.8.8',
    '172.32.0.1',
    '2a00:1450:4007:80e::200e',
    '::ffff:8.8.8.8',
  ])('%s → public', (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe('checkOutboundUrl (statique)', () => {
  it.each([
    ['ftp://example.com/x', 'bad_protocol'],
    ['file:///etc/passwd', 'bad_protocol'],
    ['https://user:pass@example.com/', 'credentials_in_url'],
    ['http://localhost:3000/', 'private_address'],
    ['http://api.localhost/', 'private_address'],
    ['http://metadata.google.internal/', 'private_address'],
    ['http://127.0.0.1/', 'private_address'],
    ['http://2130706433/', 'private_address'],
    ['http://0x7f.1/', 'private_address'],
    ['http://[::1]/', 'private_address'],
    ['http://[::ffff:a9fe:a9fe]/latest/meta-data', 'private_address'],
    ['pas une url', 'invalid_url'],
  ])('%s → %s', (u, r) => {
    let got = 'ok';
    try {
      checkOutboundUrl(u);
    } catch (e) {
      got = e instanceof OutboundBlocked ? e.reason : 'other';
    }
    expect(got).toBe(r);
  });

  it.each([
    'https://script.google.com/macros/s/ABC/exec',
    'https://hook.eu1.make.com/abc',
    'https://hooks.zapier.com/hooks/catch/1/2/',
    'http://n8n.example.com:5678/webhook/x',
    'https://sheets.googleapis.com/v4/spreadsheets/ID/values/Sheet1:append',
  ])('%s → accepté', (u) => expect(checkOutboundUrl(u).href).toBeTruthy());
});

describe('safePostJson', () => {
  it('résolution DNS vers une IP privée → refus AVANT tout fetch', async () => {
    const fetchImpl = vi.fn();
    const r = await reason(
      safePostJson(
        'https://evil.example/',
        {},
        { fetchImpl, lookup: dnsTo({ 'evil.example': '10.0.0.5' }) }
      )
    );
    expect(r).toBe('private_address');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('une seule résolution privée parmi plusieurs suffit à refuser', async () => {
    const lookup: LookupFn = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    expect(
      await reason(safePostJson('https://mixed.example/', {}, { fetchImpl: vi.fn(), lookup }))
    ).toBe('private_address');
  });

  it('DNS en échec → refus', async () => {
    const lookup: LookupFn = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(
      await reason(safePostJson('https://nx.example/', {}, { fetchImpl: vi.fn(), lookup }))
    ).toBe('dns_failed');
  });

  it('redirection vers les métadonnées cloud → refus, 2e requête jamais faite', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        })
    );
    const r = await reason(
      safePostJson('https://ok.example/', { a: 1 }, { fetchImpl, lookup: publicDns })
    );
    expect(r).toBe('private_address');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('redirection vers un nom qui résout en privé → refus', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 307, headers: { location: 'https://internal.example/x' } })
    );
    const lookup = dnsTo({ 'internal.example': 'fd00::1' });
    expect(await reason(safePostJson('https://ok.example/', {}, { fetchImpl, lookup }))).toBe(
      'private_address'
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('Apps Script : POST puis 302 → GET sans corps sur googleusercontent', async () => {
    const calls: { url: string; method?: string; body?: unknown; redirect?: string }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method,
        body: init?.body,
        redirect: init?.redirect,
      });
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: {
              location: 'https://script.googleusercontent.com/macros/echo?user_content_key=k',
            },
          })
        : new Response('{"result":"ok"}', { status: 200 });
    }) as unknown as typeof fetch;
    const res = await safePostJson(
      'https://script.google.com/macros/s/ABC/exec',
      { nom: 'Test' },
      { fetchImpl, lookup: publicDns }
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: 'POST', body: '{"nom":"Test"}', redirect: 'manual' });
    expect(calls[1]).toMatchObject({ method: 'GET', body: undefined, redirect: 'manual' });
    expect(calls[1].url).toContain('script.googleusercontent.com');
  });

  it('307 → re-POST du même corps', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      calls.push(`${init?.method} ${init?.body ?? ''}`);
      return calls.length === 1
        ? new Response(null, { status: 307, headers: { location: '/v2' } })
        : new Response('ok');
    }) as unknown as typeof fetch;
    await safePostJson('https://ok.example/v1', { a: 1 }, { fetchImpl, lookup: publicDns });
    expect(calls).toEqual(['POST {"a":1}', 'POST {"a":1}']);
  });

  it('boucle de redirections → arrêt après 3 sauts', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://ok.example/again' } })
    );
    expect(
      await reason(safePostJson('https://ok.example/', {}, { fetchImpl, lookup: publicDns }))
    ).toBe('too_many_redirects');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('délai dépassé → timeout', async () => {
    const fetchImpl = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_, rej) =>
          init?.signal?.addEventListener('abort', () =>
            rej(Object.assign(new Error('t'), { name: 'TimeoutError' }))
          )
        )
    ) as unknown as typeof fetch;
    expect(
      await reason(
        safePostJson('https://slow.example/', {}, { fetchImpl, lookup: publicDns, timeoutMs: 20 })
      )
    ).toBe('timeout');
  });
});

describe('sheetsUrlError (enregistrement)', () => {
  it('vide → accepté (désactive l’envoi)', () => {
    expect(sheetsUrlError('')).toBeNull();
    expect(sheetsUrlError(undefined)).toBeNull();
  });
  it('URL privée / locale → message', () => {
    expect(sheetsUrlError('http://169.254.169.254/')).toMatch(/locale ou privée/);
    expect(sheetsUrlError('http://localhost:8080/')).toMatch(/locale ou privée/);
  });
  it('non-chaîne ou trop longue → invalide', () => {
    expect(sheetsUrlError(42)).toMatch(/invalide/);
    expect(sheetsUrlError('https://a.example/' + 'x'.repeat(3000))).toMatch(/invalide/);
  });
  it('Apps Script / Make / n8n → accepté', () => {
    expect(sheetsUrlError('https://script.google.com/macros/s/ABC/exec')).toBeNull();
    expect(sheetsUrlError('http://n8n.example.com:5678/webhook/x')).toBeNull();
  });
});
