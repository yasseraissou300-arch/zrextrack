// P4 — Tableau de bord : « Commande transmise » quand sheets_sent = true.
//
// AVANT : le badge de l'onglet Données ne lisait que is_complete. Après une
// commande transmise puis un « merci » (is_complete repasse à false), la ligne
// affichait « … En cours » à côté de « Sheets ✓ ». Données synthétiques.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sessionDisplayStatus, sessionStatusLabel } from '@/lib/ai-chatbot/session-status';

describe('sessionDisplayStatus / sessionStatusLabel', () => {
  it('CAS 1 — sheets_sent false : comportement inchangé (is_complete décide)', () => {
    expect(sessionStatusLabel({ sheets_sent: false, is_complete: true })).toBe('Complet');
    expect(sessionStatusLabel({ sheets_sent: false, is_complete: false })).toBe('En cours');
  });

  it('CAS 2 — sheets_sent true + is_complete true → Commande transmise', () => {
    expect(sessionStatusLabel({ sheets_sent: true, is_complete: true })).toBe('Commande transmise');
  });

  it('CAS 3 — sheets_sent true + is_complete false (après « merci ») → Commande transmise', () => {
    expect(sessionDisplayStatus({ sheets_sent: true, is_complete: false })).toBe('transmitted');
    expect(sessionStatusLabel({ sheets_sent: true, is_complete: false })).toBe(
      'Commande transmise'
    );
  });

  it('CAS 4 — parcours réel : commande complète, transmise, puis « merci »', () => {
    // États successifs de la ligne ai_chat_sessions écrits par le webhook.
    const afterOrder = { is_complete: true, sheets_sent: true, template_type: 'auto_confirmation' };
    const afterMerci = { ...afterOrder, is_complete: false }; // réponse sans <data>
    expect(sessionStatusLabel(afterOrder)).toBe('Commande transmise');
    expect(sessionStatusLabel(afterMerci)).toBe('Commande transmise');
  });

  it.each([
    [undefined, false, 'En cours'],
    [null, false, 'En cours'],
    [undefined, true, 'Complet'],
    [null, true, 'Complet'],
  ])(
    'CAS 5 — anciennes lignes, sheets_sent %j + is_complete %j → %s',
    (sheets, complete, label) => {
      expect(sessionStatusLabel({ sheets_sent: sheets, is_complete: complete })).toBe(label);
    }
  );

  it('CAS 6 — conversation terminée sans transmission : jamais « transmise »', () => {
    expect(sessionStatusLabel({ sheets_sent: false, is_complete: true })).not.toMatch(/transmise/);
    expect(sessionStatusLabel({ is_complete: true })).not.toMatch(/transmise/);
  });

  it('SAV : l’objet transmis est une réclamation, pas une commande', () => {
    expect(
      sessionStatusLabel({ sheets_sent: true, is_complete: false, template_type: 'sav' })
    ).toBe('Réclamation transmise');
  });

  it('aucune valeur « truthy » autre que true ne vaut transmission', () => {
    expect(sessionDisplayStatus({ sheets_sent: 'true' as never, is_complete: false })).toBe(
      'in_progress'
    );
    expect(sessionDisplayStatus({ sheets_sent: 1 as never, is_complete: false })).toBe(
      'in_progress'
    );
  });
});

describe('page tableau de bord — consommateurs du statut', () => {
  const src = readFileSync(path.resolve(__dirname, '../src/app/ai-chatbot/page.tsx'), 'utf8');

  it('le badge de l’onglet Données ne dérive plus du seul is_complete', () => {
    expect(src).not.toMatch(/is_complete \? '✓ Complet' : '… En cours'/);
    expect(src).toMatch(/sessionStatusLabel\(session\)/);
  });

  it('la colonne Statut de l’export SAV utilise la même règle', () => {
    expect(src).not.toMatch(/is_complete \? 'Complète' : 'En cours'/);
    expect(src).toMatch(
      /sessionDisplayStatus\(s\) === 'transmitted'\s*\?\s*sessionStatusLabel\(s\)/
    );
    // CAS 1 : libellés historiques de l'export conservés quand rien n'est transmis.
    expect(src).toMatch(/\? 'Complète'\s*: 'En cours'/);
  });

  it('filtres et compteurs : même critère hasCompleteData (is_complete OU sheets_sent)', () => {
    expect(src).not.toMatch(/statusFilter === 'complete' && !s\.is_complete/);
    expect(src).not.toMatch(/sessions\.filter\(\(s\) => s\.is_complete\)\.length/);
    expect(src).not.toMatch(/sessions\.filter\(\(s\) => !s\.is_complete\)\.length/);
    expect(src.match(/hasCompleteData/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });
});
