// Script de recâblage des webhooks WhatsApp : Evolution simulé, aucun réseau.

import { describe, it, expect, vi } from 'vitest';
import {
  configErrors,
  rewire,
  isAutotimInstance,
  maskUrl,
  webhookUrl,
  instanceNames,
} from '../scripts/rewire-whatsapp-webhooks.mjs';

const EV = 'https://evolution.test';
const SECRET = 'TEST_WEBHOOK_SECRET_123';
const APP = 'https://app.test/';
const TARGET = `https://app.test/api/ai-chatbot/webhook/whatsapp?token=${SECRET}`;

function fakeEvolution(
  instances: string[],
  webhooks: Record<string, string | null>,
  opts: { v2Only?: boolean } = {}
) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (url === `${EV}/instance/fetchInstances`)
      return Response.json(instances.map((name) => ({ name })));
    const m = url.match(/\/webhook\/(find|set)\/(.+)$/);
    if (m && m[1] === 'find') return Response.json({ webhook: { url: webhooks[m[2]] ?? null } });
    if (m && m[1] === 'set') {
      const u = body?.webhook?.url ?? (opts.v2Only ? undefined : body?.url);
      if (u) webhooks[m[2]] = u;
      return Response.json({ ok: true });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, webhooks };
}

describe('règles', () => {
  it('seules les instances AutoTim sont concernées', () => {
    expect(isAutotimInstance('zrex_111111111111_auto')).toBe(true);
    expect(isAutotimInstance('zrex_111111111111')).toBe(true);
    for (const n of ['autre_app', 'zrex_xyz', 'zrex_111111111111_auto/../x', '', null])
      expect(isAutotimInstance(n)).toBe(false);
  });
  it('le jeton n’est jamais affiché', () => {
    expect(maskUrl(webhookUrl(APP, SECRET))).toBe(
      'https://app.test/api/ai-chatbot/webhook/whatsapp?token=***'
    );
    expect(maskUrl(webhookUrl(APP, SECRET))).not.toContain(SECRET);
  });
  it('formats Evolution v1 / v2', () => {
    expect(
      instanceNames([{ name: 'a' }, { instanceName: 'b' }, { instance: { instanceName: 'c' } }])
    ).toEqual(['a', 'b', 'c']);
    expect(instanceNames(null)).toEqual([]);
  });
});

describe('rewire', () => {
  it('simulation : AUCUNE écriture, autres instances ignorées', async () => {
    const ev = fakeEvolution(['zrex_111111111111_auto', 'autre_app'], {
      zrex_111111111111_auto: 'https://app.test/api/ai-chatbot/webhook/whatsapp',
    });
    const logs: string[] = [];
    const r = await rewire({
      evUrl: EV,
      evKey: 'k',
      secret: SECRET,
      appUrl: APP,
      apply: false,
      fetchImpl: ev.fetchImpl,
      log: (s: string) => logs.push(s),
    });
    expect(r).toEqual([
      {
        name: 'zrex_111111111111_auto',
        action: 'à recâbler',
        before: 'https://app.test/api/ai-chatbot/webhook/whatsapp',
      },
    ]);
    expect(ev.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(ev.calls.some((c) => c.url.includes('autre_app'))).toBe(false);
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('--apply : recâble avec le jeton, vérifie, ne touche jamais une instance étrangère', async () => {
    const ev = fakeEvolution(['zrex_111111111111_auto', 'zrex_222222222222_sav', 'autre_app'], {});
    const logs: string[] = [];
    const r = await rewire({
      evUrl: EV,
      evKey: 'k',
      secret: SECRET,
      appUrl: APP,
      apply: true,
      fetchImpl: ev.fetchImpl,
      log: (s: string) => logs.push(s),
    });
    expect(r.map((x: { action: string }) => x.action)).toEqual(['recâblée', 'recâblée']);
    expect(ev.webhooks.zrex_111111111111_auto).toBe(TARGET);
    expect(ev.calls.some((c) => c.url.includes('autre_app'))).toBe(false);
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('Evolution v2 seulement : bascule sur le format imbriqué', async () => {
    const ev = fakeEvolution(['zrex_111111111111_auto'], {}, { v2Only: true });
    const r = await rewire({
      evUrl: EV,
      evKey: 'k',
      secret: SECRET,
      appUrl: APP,
      apply: true,
      fetchImpl: ev.fetchImpl,
      log: () => {},
    });
    expect(r[0].action).toBe('recâblée');
  });

  it('déjà à jour : aucune écriture', async () => {
    const ev = fakeEvolution(['zrex_111111111111_auto'], { zrex_111111111111_auto: TARGET });
    const r = await rewire({
      evUrl: EV,
      evKey: 'k',
      secret: SECRET,
      appUrl: APP,
      apply: true,
      fetchImpl: ev.fetchImpl,
      log: () => {},
    });
    expect(r[0].action).toBe('déjà à jour');
    expect(ev.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});

describe('configuration', () => {
  const ok = {
    WHATSAPP_WEBHOOK_SECRET: 'a'.repeat(64),
    APP_URL: 'https://autotim.vercel.app',
    EVOLUTION_API_URL: 'https://evolution.example',
  };
  it('configuration valide → aucune erreur', () => {
    expect(configErrors(ok)).toEqual([]);
  });
  it('secret trop court, APP_URL http/locale, Evolution invalide → refus, sans jamais citer la valeur', () => {
    const errs = configErrors({
      WHATSAPP_WEBHOOK_SECRET: 'TEST_SHORT',
      APP_URL: 'http://localhost:3000',
      EVOLUTION_API_URL: 'pas une url',
    });
    expect(errs).toHaveLength(4);
    expect(errs.join(' ')).not.toContain('TEST_SHORT');
  });
});
