// LOG-6 / LOG-2 — logEvent n'émet que les champs de sa liste blanche et
// assainit les champs texte libres.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logEvent, redactFreeText } from '@/lib/security/safe-log';

let lines: string[] = [];
beforeEach(() => {
  lines = [];
  for (const m of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

const last = () => JSON.parse(lines[lines.length - 1]);

describe('liste blanche (LOG-6)', () => {
  it('champ hors liste (phone, email, body) : NON émis, seul son nom est signalé', () => {
    logEvent('info', 't', {
      status: 'ok',
      phone: '0550123456',
      email: 'client@example.com',
      body: '{"secret":"x"}',
    } as never);
    const l = last();
    expect(l.status).toBe('ok');
    expect(l).not.toHaveProperty('phone');
    expect(l).not.toHaveProperty('email');
    expect(l).not.toHaveProperty('body');
    expect(l.dropped_keys).toEqual(['body', 'email', 'phone']);
    expect(lines.join('')).not.toMatch(/0550123456|client@example\.com|secret/);
  });

  it('champs habituels conservés à l’identique (tenant_id, instance, message_id, elapsed_ms…)', () => {
    const tenant = '11111111-1111-4111-8111-111111111111';
    logEvent('warn', 'queue', {
      tenant_id: tenant,
      instance: 'zrex_ab12_auto',
      message_id: 'MSG-1',
      elapsed_ms: 42,
      worker: 'w1',
      ref: 'E-abcd1234',
    });
    expect(last()).toMatchObject({
      tenant_id: tenant,
      instance: 'zrex_ab12_auto',
      message_id: 'MSG-1',
      elapsed_ms: 42,
      worker: 'w1',
      ref: 'E-abcd1234',
    });
    expect(last()).not.toHaveProperty('dropped_keys');
  });

  it('contact jamais en clair, même si l’appelant oublie maskPhone', () => {
    logEvent('info', 't', { contact: '213550123456@s.whatsapp.net' });
    expect(last().contact).toBe('213***456');
    logEvent('info', 't', { contact: '213***456' });
    expect(last().contact).toBe('213***456');
  });
});

describe('texte libre assaini (LOG-2 : err.message brut)', () => {
  it('reason avec numéro, email, ?key= et token= → masqués', () => {
    logEvent('error', 'webhook.whatsapp', {
      reason:
        'fetch failed for 213550123456@s.whatsapp.net client@example.com https://x/y?key=AIzaSECRET&token=tok123',
    });
    const r = last().reason as string;
    expect(r).not.toMatch(/550123456|client@example|AIzaSECRET|tok123/);
    expect(r).toContain('[email]'); // le JID est masqué comme une adresse
    expect(r).toContain('key=••••');
  });

  it('numéro seul (avec espaces ou +213) → [num]', () => {
    expect(redactFreeText('send to +213 550 12 34 56 failed')).toBe('send to [num] failed');
    expect(redactFreeText('send to 0550123456 failed')).toBe('send to [num] failed');
  });

  it('borné à 200 caractères', () => {
    logEvent('error', 't', { reason: 'x'.repeat(5000) });
    expect((last().reason as string).length).toBeLessThanOrEqual(200);
  });

  it('dates et petits nombres conservés', () => {
    expect(redactFreeText('HTTP 504 at 2026-10-14 after 5000 ms')).toBe(
      'HTTP 504 at 2026-10-14 after 5000 ms'
    );
  });
});
