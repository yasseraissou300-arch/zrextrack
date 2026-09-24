// Anti-rejeu durable — plusieurs instances Vercel simulées.
//
// Chaque `vi.resetModules()` + import redonne un module neuf, donc une Map
// `seen` vide : exactement ce que voit une AUTRE instance serverless, ou la
// même après un démarrage à froid. La base (FakeSupabase) est partagée.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => db,
}));

beforeEach(() => {
  db = new FakeSupabase();
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

/** Une « instance » = un module fraîchement chargé (mémoire vide). */
async function freshInstance() {
  vi.resetModules();
  return import('@/lib/security/replay-store');
}

const NO_PRUNE = () => 1;

describe('entre instances', () => {
  it('le cache mémoire seul laisse passer un rejeu sur une autre instance (constat)', async () => {
    vi.resetModules();
    const a = await import('@/lib/security/webhook-auth');
    vi.resetModules();
    const b = await import('@/lib/security/webhook-auth');
    expect(a.isReplay('wa:inst:MSG1')).toBe(false);
    expect(b.isReplay('wa:inst:MSG1')).toBe(false); // ← le défaut corrigé ici
  });

  it('le store durable détecte le rejeu sur une autre instance', async () => {
    const a = await freshInstance();
    const b = await freshInstance();
    expect(await a.isReplayDurable(db as any, 'wa:inst:MSG1', NO_PRUNE)).toBe(false);
    expect(await b.isReplayDurable(db as any, 'wa:inst:MSG1', NO_PRUNE)).toBe(true);
  });

  it('5 instances simultanées : une seule traite l’événement', async () => {
    // Chargement séquentiel (resetModules), puis appels réellement concurrents.
    const instances = [];
    for (let i = 0; i < 5; i++) instances.push(await freshInstance());
    const results = await Promise.all(
      instances.map((m) => m.isReplayDurable(db as any, 'wa:inst:MSG2', NO_PRUNE))
    );
    expect(results.filter((r) => r === false)).toHaveLength(1);
    expect(db.all('autotim', 'webhook_events')).toHaveLength(1);
  });

  it('des événements différents ne se bloquent pas', async () => {
    const a = await freshInstance();
    expect(await a.isReplayDurable(db as any, 'wa:inst:A', NO_PRUNE)).toBe(false);
    expect(await a.isReplayDurable(db as any, 'wa:inst:B', NO_PRUNE)).toBe(false);
  });
});

describe('dégradation', () => {
  it('table absente (006 non exécutée) → pas d’erreur, repli sur la mémoire', async () => {
    const a = await freshInstance();
    db.failNext('autotim', 'webhook_events', 'upsert', { code: 'PGRST205' });
    expect(await a.isReplayDurable(db as any, 'wa:inst:MSG3', NO_PRUNE)).toBe(false);
    // Même instance : la mémoire bloque le rejeu, comme avant.
    expect(await a.isReplayDurable(db as any, 'wa:inst:MSG3', NO_PRUNE)).toBe(true);
  });

  it('clé vide → jamais considérée comme rejeu', async () => {
    const a = await freshInstance();
    expect(await a.isReplayDurable(db as any, '', NO_PRUNE)).toBe(false);
  });

  it('clé bornée à 200 caractères (contrainte de la table)', async () => {
    const a = await freshInstance();
    await a.isReplayDurable(db as any, 'x'.repeat(500), NO_PRUNE);
    expect(db.all('autotim', 'webhook_events')[0].event_key).toHaveLength(200);
  });
});

describe('purge', () => {
  it('supprime les entrées de plus de 7 jours, garde les récentes', async () => {
    db.seed('autotim', 'webhook_events', [
      { event_key: 'old', received_at: new Date(Date.now() - 8 * 86_400_000).toISOString() },
      { event_key: 'recent', received_at: new Date(Date.now() - 86_400_000).toISOString() },
    ]);
    const a = await freshInstance();
    await a.isReplayDurable(db as any, 'wa:inst:MSG4', () => 0); // déclenche la purge
    await new Promise((r) => setTimeout(r, 0));
    const keys = db
      .all('autotim', 'webhook_events')
      .map((r) => r.event_key)
      .sort();
    expect(keys).toEqual(['recent', 'wa:inst:MSG4']);
  });
});

describe('webhook WhatsApp', () => {
  it('le même message livré à deux instances n’est traité qu’une fois', async () => {
    const body = JSON.stringify({
      event: 'messages.upsert',
      instance: 'zrex_test_auto',
      data: {
        key: { remoteJid: '213550000001@s.whatsapp.net', fromMe: false, id: 'EVO-DUP-1' },
        message: { conversation: 'Salam, bghit montre' },
      },
    });
    const post = async () => {
      vi.resetModules();
      const { POST } = await import('@/app/api/ai-chatbot/webhook/whatsapp/route');
      const res = await POST(
        new NextRequest('https://app.test/api/ai-chatbot/webhook/whatsapp', {
          method: 'POST',
          body,
        })
      );
      return res.json();
    };
    const first = await post();
    const second = await post();
    expect(first.deduped).toBeUndefined();
    expect(second.deduped).toBe(true);
  });
});
