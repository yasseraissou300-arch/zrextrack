// P4 — AUDIT (constat, aucun code modifié) : données sensibles dans les journaux serveur.
//
// Base : main local ae4428c. Sorties capturées : console.log / error / warn /
// info / debug (logEvent écrit une ligne JSON via console). Valeurs FACTICES.
// Tests en DEUX ÉTATS quand un correctif existe sur une branche non mergée.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import type { Job } from '@/lib/queue/types';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const PHONE_A = '213550123456'; // TEST_PHONE_A (12 chiffres, format WhatsApp)
const MESSAGE_A = 'TEST_MESSAGE_A nheb montre, adresse rue des Oliviers';
const EMAIL_A = 'test_email_a@example.test';

let db: FakeSupabase;
let serviceThrows: Error | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => {
    if (serviceThrows) throw serviceThrows;
    return db;
  },
  createClient: async () => db,
}));
vi.mock('@/lib/user-creds', async (orig) => ({
  ...(await orig<typeof import('@/lib/user-creds')>()),
  resolveEvolutionCreds: async () => ({
    url: 'https://evolution-host.internal.test',
    key: 'TEST_EVOLUTION_KEY',
  }),
}));

const lines: string[] = [];
beforeEach(() => {
  db = new FakeSupabase();
  serviceThrows = null;
  lines.length = 0;
  vi.resetModules();
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const logs = () => lines.join('\n');

// ─── 1. logEvent : sérialisation réelle ─────────────────────────────────────

describe('logEvent (safe-log.ts) — comportement réel', () => {
  it('CONSTAT : AUCUNE liste blanche — tout champ passé est émis (le commentaire dit le contraire)', async () => {
    const { logEvent } = await import('@/lib/security/safe-log');
    logEvent('info', 'audit', { status: 'x', phone: PHONE_A, email: EMAIL_A } as never);
    expect(logs()).toContain(PHONE_A);
    expect(logs()).toContain(EMAIL_A);
  });

  it('un objet Error passé en champ est sérialisé en {} (message perdu, rien n’est exposé)', async () => {
    const { logEvent } = await import('@/lib/security/safe-log');
    logEvent('error', 'audit', {
      status: 'x',
      err: new Error(`secret TEST_SECRET_A ${PHONE_A}`),
    } as never);
    expect(logs()).not.toContain('TEST_SECRET_A');
    expect(logs()).toContain('"err":{}');
  });

  it('maskPhone garde 3 + 3 chiffres (213***456) : téléphone non reconstructible', async () => {
    const { maskPhone } = await import('@/lib/security/safe-log');
    expect(maskPhone(`${PHONE_A}@s.whatsapp.net`)).toBe('213***456');
  });
});

// ─── 2. Handler file whatsapp.send — corps d'erreur Evolution ───────────────

describe('queue whatsapp.send — échec Evolution (corrigé par 5520cf4, pile 12j)', () => {
  const job = (): Job => {
    const now = new Date().toISOString();
    return {
      id: 'job-1',
      tenant_id: TENANT_A,
      type: 'whatsapp.send',
      payload: { phone: PHONE_A, message: MESSAGE_A, tracking_number: 'TEST_TRACKING_A' },
      status: 'running',
      run_after: now,
      attempts: 1,
      max_attempts: 1,
      locked_at: now,
      locked_by: 'w',
      last_error: null,
      idempotency_key: null,
      created_at: now,
      updated_at: now,
    } as Job;
  };
  beforeEach(() => {
    db.seed('public', 'whatsapp_instances', [
      {
        user_id: TENANT_A,
        service_type: 'auto_confirmation',
        instance_name: 'zrex_a_auto',
        connected: true,
      },
    ]);
    db.seed('public', 'profiles', [{ id: TENANT_A, whatsapp_warmup_started_at: null }]);
  });

  it('HTTP 400 dont le corps cite le numéro : numéro COMPLET dans le journal sur main (constat) / absent après correctif', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: 400,
              response: {
                message: [{ exists: false, jid: `${PHONE_A}@s.whatsapp.net`, number: PHONE_A }],
              },
            }),
            { status: 400 }
          )
      )
    );
    const { handleWhatsAppSend } = await import('@/lib/queue/handlers/whatsapp-send');
    const r = await handleWhatsAppSend(job());
    expect(r.outcome).toBe('failed');
    const out = logs();
    expect(out).not.toContain('TEST_MESSAGE_A'); // le texte envoyé n'est jamais journalisé
    expect(out).not.toContain('TEST_EVOLUTION_KEY');
    if (out.includes(PHONE_A)) {
      expect(out).toContain('Evolution HTTP 400'); // main : corps brut recopié dans « reason »
      expect(r.outcome === 'failed' && r.error).toContain(PHONE_A); // et dans jobs.last_error
    } else {
      expect(r.outcome === 'failed' && r.error).not.toContain(PHONE_A);
    }
  });

  it('exception réseau dont le message cite l’URL Evolution : hôte interne dans le journal sur main (constat) / absent après correctif', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError(
          'fetch failed: https://evolution-host.internal.test/message/sendText/zrex_a_auto'
        );
      })
    );
    const { handleWhatsAppSend } = await import('@/lib/queue/handlers/whatsapp-send');
    await handleWhatsAppSend(job());
    const out = logs();
    if (out.includes('evolution-host.internal.test')) {
      expect(out).toContain('fetch failed'); // main
    } else {
      expect(out).not.toContain('evolution-host');
    }
  });
});

// ─── 3. Webhook WhatsApp — contenu des messages et exceptions ───────────────

describe('webhook WhatsApp — journaux', () => {
  const post = async (text: string) => {
    const { POST } = await import('@/app/api/ai-chatbot/webhook/whatsapp/route');
    return POST(
      new NextRequest('https://app.test/api/ai-chatbot/webhook/whatsapp', {
        method: 'POST',
        body: JSON.stringify({
          event: 'messages.upsert',
          instance: 'zrex_a_auto',
          data: {
            key: {
              remoteJid: `${PHONE_A}@s.whatsapp.net`,
              fromMe: false,
              id: `M-${Math.random()}`,
            },
            message: { conversation: text },
            pushName: 'TEST_NAME_A Bensalah',
          },
        }),
      })
    );
  };

  it('message reçu : ni le texte, ni le nom, ni le numéro complet ne sont journalisés (numéro masqué)', async () => {
    await post(MESSAGE_A); // aucune instance en base → arrêt après les premiers journaux
    const out = logs();
    expect(out).toContain('213***456');
    expect(out).not.toContain(PHONE_A);
    expect(out).not.toContain('TEST_MESSAGE_A');
    expect(out).not.toContain('TEST_NAME_A');
  });

  it('CONSTAT : exception non prévue → son message est journalisé TEL QUEL (reason), PII comprise sur main', async () => {
    serviceThrows = new Error(`unexpected for ${PHONE_A} ${EMAIL_A} « ${MESSAGE_A} »`);
    const res = await post('Salam');
    expect(res.status).toBe(200);
    const out = logs();
    expect(out).toContain('"status":"exception"');
    expect(out).toContain('TEST_MESSAGE_A'); // texte arbitraire : passe dans tous les cas
    if (out.includes(PHONE_A)) {
      expect(out).toContain(EMAIL_A); // main : aucune redaction
    } else {
      expect(out).not.toContain(EMAIL_A); // p3-safe-errors : redactForLog masque numéros et emails
    }
  });
});
