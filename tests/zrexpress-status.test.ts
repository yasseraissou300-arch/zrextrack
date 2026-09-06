// Phase 0 — Test A : classification des statuts ZRExpress.
//
// C'est la fonction la plus critique de la plateforme : elle décide quel
// message WhatsApp part au client. Une erreur ici = un client reçoit
// « votre colis est livré » alors qu'il a été retourné.
//
// Règle métier vérifiée : la SITUATION prime toujours sur l'ÉTAT.

import { describe, it, expect } from 'vitest';
import { mapStatus, norm } from '@/lib/zrexpress/status';

describe('norm()', () => {
  it('supprime accents, underscores et normalise la casse', () => {
    expect(norm('En_Préparation')).toBe('en preparation');
    expect(norm('  SORTIE   EN  LIVRAISON ')).toBe('sortie en livraison');
    expect(norm('Retourné')).toBe('retourne');
  });
  it('tolère null/undefined/vide', () => {
    expect(norm('')).toBe('');
    expect(norm(undefined as unknown as string)).toBe('');
  });
});

describe('mapStatus — les 6 statuts internes', () => {
  it('en_preparation', () => {
    expect(mapStatus('En préparation')).toBe('en_preparation');
    expect(mapStatus('Commande reçue')).toBe('en_preparation');
  });

  it('en_transit', () => {
    expect(mapStatus('En transit')).toBe('en_transit');
  });

  it('en_livraison', () => {
    expect(mapStatus('Sortie en livraison')).toBe('en_livraison');
  });

  it('livre', () => {
    expect(mapStatus('Livré')).toBe('livre');
  });
});

// ─── BUGS CONNUS, NON CORRIGÉS EN PHASE 0 ───────────────────────────────────
// `it.fails` = « ce test DOIT échouer aujourd'hui ». Si quelqu'un corrige le
// bug, ce test se met à passer et Vitest le signale → obligation de mettre à
// jour. Le bug est ainsi tracé dans le code, pas seulement dans un rapport.
//
// Non corrigés ici volontairement : reclasser des colis change les
// notifications WhatsApp envoyées au prochain sync (un colis passant de
// `en_preparation` à `en_transit` déclenche un message). Effet de bord à
// valider explicitement — hors périmètre de la stabilisation.
describe('BUG-12 / BUG-13 — états ZRExpress non reconnus par mapStatus', () => {
  it.fails('BUG-12 : « Vers Wilaya » devrait être en_transit (retourne en_preparation)', () => {
    // Onglet réel ZRExpress « Vers Wilaya » — 11 colis observés chez
    // l'utilisateur. Aucun terme de la liste `en_transit` ne correspond, donc
    // la fonction retombe sur le défaut `en_preparation`.
    // Conséquence : le client reçoit « on prépare votre colis » alors qu'il est
    // déjà acheminé vers sa wilaya.
    expect(mapStatus('Vers Wilaya')).toBe('en_transit');
  });

  it.fails('BUG-13 : « Encaissé » devrait être livre (retourne en_preparation)', () => {
    // Incohérence interne à src/lib/zrexpress/status.ts :
    // `classifySwappedDelivery` traite bien encaisse/recouvert comme un succès
    // (« Livré → Encaissé → Recouvert = les 3 = client servi ») mais `mapStatus`
    // ne connaît pas ces états.
    // Conséquence : colis livré ET encaissé affiché « en préparation », et la
    // notification « livré » n'est jamais envoyée.
    expect(mapStatus('Encaissé')).toBe('livre');
  });

  it.fails('BUG-13b : « Recouvert » devrait être livre', () => {
    expect(mapStatus('Recouvert')).toBe('livre');
  });

  it('echec', () => {
    expect(mapStatus('Sortie en livraison', 'Ne répond pas 1')).toBe('echec');
    expect(mapStatus('Sortie en livraison', 'Commande annulée')).toBe('echec');
    expect(mapStatus('En transit', 'Commune erronée')).toBe('echec');
  });

  it('retourne', () => {
    expect(mapStatus('Retourné')).toBe('retourne');
    expect(mapStatus('En transit', 'Retour expéditeur')).toBe('retourne');
  });
});

describe('mapStatus — LA SITUATION PRIME SUR L\'ÉTAT', () => {
  it('un colis « En préparation » mais « Ne répond pas » est un échec', () => {
    // Sans cette règle, le client recevrait « on prépare votre colis »
    // alors que le livreur ne l'a jamais joint.
    expect(mapStatus('En préparation', 'Ne répond pas 3')).toBe('echec');
  });

  it('un colis « Livré » mais situation « Retour » est un retour', () => {
    expect(mapStatus('Livré', 'Retour expéditeur')).toBe('retourne');
  });

  it('situation vide → on retombe sur l\'état', () => {
    expect(mapStatus('Livré', '')).toBe('livre');
  });
});

describe('mapStatus — robustesse', () => {
  it('ne lève jamais sur entrée vide ou inconnue', () => {
    expect(() => mapStatus('', '')).not.toThrow();
    expect(() => mapStatus('libellé totalement inconnu')).not.toThrow();
  });

  it('renvoie toujours un des 6 statuts internes', () => {
    const VALIDES = ['en_preparation', 'en_transit', 'en_livraison', 'livre', 'echec', 'retourne'];
    const echantillons = [
      '', 'xyz', 'Livré', 'Retourné', 'En transit', 'Dispatch',
      'Prêt à expédier', 'Sortie en livraison', 'Vers Wilaya',
    ];
    for (const e of echantillons) {
      expect(VALIDES).toContain(mapStatus(e));
    }
  });
});
