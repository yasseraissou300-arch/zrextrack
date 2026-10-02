// P4 — Compteur « Messages WhatsApp » du tableau de bord (GET /api/kpis → messagesSent).
//
// Lignes de public.messages telles que les écrivent les chemins d'envoi réels
// (lecture du code, voir .claude/mission/kpi-messages-sent-audit.md) :
//   - /api/whatsapp/send (envoi manuel, « Renvoyer ») : une ligne PAR TENTATIVE,
//     status 'envoye' OU 'echec' ;
//   - drain des notifications : idem, 'envoye' OU 'echec' ;
//   - file whatsapp.send (campagnes, notifications) : ligne 'envoye' au succès
//     SEULEMENT, aucune ligne à l'échec ;
//   - relance chatbot : ligne 'envoye' au succès seulement ;
//   - réponses du chatbot (WhatsApp, Messenger), message de résolution SAV,
//     messages REÇUS : aucune ligne.
// Définition cible : messagesSent = envois RÉUSSIS du tenant (status 'envoye').

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
const T = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: T } } }) },
  }),
}));

let n = 0;
function msg(status: 'envoye' | 'echec', extra: Record<string, unknown> = {}) {
  return {
    id: `m-${++n}`,
    user_id: T,
    tracking_number: 'ZR-1',
    customer_name: 'Client',
    customer_whatsapp: '213550000001',
    message: 'Votre colis est en route',
    status,
    error_message: status === 'echec' ? 'Evolution HTTP 500' : null,
    sent_at: new Date().toISOString(),
    ...extra,
  };
}

async function messagesSent(): Promise<number> {
  const { GET } = await import('@/app/api/kpis/route');
  const res = await GET();
  expect(res.status).toBe(200);
  return (await res.json()).messagesSent;
}

beforeEach(() => {
  db = new FakeSupabase();
  n = 0;
});

describe('KPI messagesSent — envois réussis uniquement', () => {
  it('A — un envoi réussi → 1', async () => {
    db.seed('public', 'messages', [msg('envoye')]);
    expect(await messagesSent()).toBe(1);
  });

  it('B — un envoi ÉCHOUÉ (ligne echec : envoi manuel / drain) → 0', async () => {
    db.seed('public', 'messages', [msg('echec')]);
    expect(await messagesSent()).toBe(0);
  });

  it('C/D — message reçu, réponse chatbot, Messenger : aucune ligne → 0', async () => {
    expect(await messagesSent()).toBe(0);
  });

  it('E — échec puis « Renvoyer » réussi (deux lignes) → 1 message réellement envoyé', async () => {
    db.seed('public', 'messages', [msg('echec'), msg('envoye')]);
    expect(await messagesSent()).toBe(1);
  });

  it('F — file whatsapp.send : échec (aucune ligne) puis retry réussi (une ligne) → 1', async () => {
    db.seed('public', 'messages', [msg('envoye', { tracking_number: 'CAMP-1' })]);
    expect(await messagesSent()).toBe(1);
  });

  it('G — volume : 3 réussis + 5 échecs → 3', async () => {
    db.seed('public', 'messages', [
      ...Array.from({ length: 3 }, () => msg('envoye')),
      ...Array.from({ length: 5 }, () => msg('echec')),
    ]);
    expect(await messagesSent()).toBe(3);
  });

  it('isolation : les envois d’un autre tenant ne sont jamais comptés', async () => {
    db.seed('public', 'messages', [msg('envoye'), msg('envoye', { user_id: OTHER })]);
    expect(await messagesSent()).toBe(1);
  });
});
