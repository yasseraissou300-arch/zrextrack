// CSP Report-Only (P3) : configuration + endpoint de rapports.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { buildCsp } from '../csp.config.mjs';
import nextConfig from '../next.config.mjs';

const logEvent = vi.fn((..._args: unknown[]) => undefined);
vi.mock('@/lib/security/safe-log', () => ({ logEvent: (...args: unknown[]) => logEvent(...args) }));

import { POST } from '@/app/api/csp-report/route';

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v])
  );
}

describe('buildCsp', () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://testproject.supabase.co' } as unknown as NodeJS.ProcessEnv;

  it("n'autorise jamais unsafe-eval", () => {
    expect(buildCsp(env)).not.toContain('unsafe-eval');
  });

  it('origines Supabase exactes (https + wss) dans connect-src', () => {
    const d = directives(buildCsp(env));
    expect(d['connect-src']).toEqual(["'self'", 'https://testproject.supabase.co', 'wss://testproject.supabase.co']);
    expect(d['media-src']).toContain('https://testproject.supabase.co');
    expect(d['media-src']).not.toContain('wss://testproject.supabase.co');
  });

  it('URL Supabase absente → repli *.supabase.co', () => {
    const d = directives(buildCsp({} as unknown as NodeJS.ProcessEnv));
    expect(d['connect-src']).toContain('https://*.supabase.co');
  });

  it('verrous : object-src/frame-src none, base-uri/form-action self, report-uri', () => {
    const d = directives(buildCsp(env));
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['frame-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(d['report-uri']).toEqual(['/api/csp-report']);
    expect(d['default-src']).toEqual(["'self'"]);
  });
});

describe('next.config — CSP en Report-Only uniquement', () => {
  it('en-tête Report-Only présent, aucune CSP appliquée', async () => {
    const cfg = nextConfig as unknown as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    const all = (await cfg.headers()).flatMap((r) => r.headers.map((h) => h.key));
    expect(all).toContain('Content-Security-Policy-Report-Only');
    expect(all).not.toContain('Content-Security-Policy');
  });
});

describe('POST /api/csp-report', () => {
  beforeEach(() => logEvent.mockClear());

  const post = (body: string) =>
    POST(new NextRequest('http://localhost/api/csp-report', { method: 'POST', body }));

  it('format historique : journalise directive + origine, jamais le chemin ni la query', async () => {
    const res = await post(JSON.stringify({
      'csp-report': {
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example/path/secret?token=TEST_TOKEN',
        'document-uri': 'http://localhost/track/TEST_TRACKING_A',
      },
    }));
    expect(res.status).toBe(204);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith('warn', 'csp.report', { event: 'violation', reason: 'script-src-elem https://evil.example' });
    const logged = JSON.stringify(logEvent.mock.calls);
    expect(logged).not.toContain('TEST_TOKEN');
    expect(logged).not.toContain('/path/secret');
    expect(logged).not.toContain('TEST_TRACKING_A');
  });

  it('Reporting API : tableau borné à 10 rapports', async () => {
    const reports = Array.from({ length: 25 }, () => ({ body: { effectiveDirective: 'img-src', blockedURL: 'inline' } }));
    const res = await post(JSON.stringify(reports));
    expect(res.status).toBe(204);
    expect(logEvent).toHaveBeenCalledTimes(10);
    expect(logEvent.mock.calls[0][2]).toEqual({ event: 'violation', reason: 'img-src inline' });
  });

  it('corps illisible ou géant : 204 sans journalisation', async () => {
    expect((await post('not json')).status).toBe(204);
    expect((await post('{"csp-report":' + 'x'.repeat(20_000))).status).toBe(204);
    expect(logEvent).not.toHaveBeenCalled();
  });
});
