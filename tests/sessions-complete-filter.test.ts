// P4 — Filtres et compteurs « complètes » : is_complete OU sheets_sent.
//
// AVANT : « complètes uniquement » (API) et les compteurs lisaient is_complete
// seul ; une commande ou une réclamation TRANSMISE puis suivie d'un « merci »
// (is_complete repasse à false) sortait des vues « complètes » — la réclamation
// SAV disparaissait de la vue par défaut de l'opérateur. Données synthétiques.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { hasCompleteData } from '@/lib/ai-chatbot/session-status';

const calls: Array<[string, unknown[]]> = [];
function chain(): unknown {
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(res);
      }
      return (...args: unknown[]) => {
        calls.push([prop, args]);
        return proxy;
      };
    },
  });
  return proxy;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: () => chain(),
  }),
  createServiceClient: () => ({ from: () => chain() }),
}));

beforeEach(() => {
  calls.length = 0;
});

async function get(query: string) {
  const { GET } = await import('@/app/api/ai-chatbot/sessions/route');
  return GET(new NextRequest(`https://app.test/api/ai-chatbot/sessions${query}`));
}

describe('GET /api/ai-chatbot/sessions?complete=true', () => {
  it('filtre « complètes » = is_complete OU sheets_sent (plus de .eq(is_complete) seul)', async () => {
    await get('?complete=true');
    expect(calls).toContainEqual(['or', ['is_complete.eq.true,sheets_sent.eq.true']]);
    expect(calls).not.toContainEqual(['eq', ['is_complete', true]]);
  });

  it('toujours limité au tenant de la session', async () => {
    await get('?complete=true');
    expect(calls).toContainEqual(['eq', ['user_id', 'u-1']]);
  });

  it('sans le paramètre : aucun filtre de complétude (inchangé)', async () => {
    await get('');
    expect(calls.some(([m]) => m === 'or')).toBe(false);
    expect(calls.some(([m, a]) => m === 'eq' && a[0] === 'is_complete')).toBe(false);
  });
});

describe('hasCompleteData — vues Données et Réclamations', () => {
  const sav = (o: Record<string, unknown>) => ({ template_type: 'sav', ...o });
  const sessions = [
    sav({ id: 'r1', is_complete: true, sheets_sent: true }), // réclamation transmise
    sav({ id: 'r2', is_complete: false, sheets_sent: true }), // … puis « merci »
    sav({ id: 'r3', is_complete: true, sheets_sent: false }), // complète, non transmise
    sav({ id: 'r4', is_complete: false, sheets_sent: false }), // en cours
    sav({ id: 'r5', is_complete: false, sheets_sent: null }), // ancienne ligne
  ];

  it('vue SAV par défaut (« complètes ») : la réclamation transmise puis « merci » RESTE visible', () => {
    const visible = sessions.filter(hasCompleteData).map((s) => s.id);
    expect(visible).toEqual(['r1', 'r2', 'r3']);
  });

  it('vue « en cours » : seulement ce qui n’est ni complet ni transmis', () => {
    expect(sessions.filter((s) => !hasCompleteData(s)).map((s) => s.id)).toEqual(['r4', 'r5']);
  });

  it('compteurs : complètes + en cours = total (aucune ligne comptée deux fois ni perdue)', () => {
    const complete = sessions.filter(hasCompleteData).length;
    const pending = sessions.filter((s) => !hasCompleteData(s)).length;
    expect(complete + pending).toBe(sessions.length);
  });

  it('seul true strict compte', () => {
    expect(hasCompleteData({ is_complete: 'true' as never, sheets_sent: 1 as never })).toBe(false);
  });
});
