// Phase 0 — Test A : classification des statuts ZRExpress.
//
// C'est la fonction la plus critique de la plateforme : elle décide quel
// message WhatsApp part au client. Une erreur ici = un client reçoit
// « votre colis est livré » alors qu'il a été retourné.
//
// Règle métier vérifiée : la SITUATION prime toujours sur l'ÉTAT.

import { describe, it, expect } from 'vitest';
import { isPostDeliveryState, mapStatus, norm } from '@/lib/zrexpress/status';
import { mapParcel, silentTrackingNumbers } from '@/lib/zrexpress/map-parcel';

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

// ─── BUGS CONNUS, NON CORRIGÉS EN PHASE 0 ───────────────────────────────────
// `it.fails` = « ce test DOIT échouer aujourd'hui ». Si quelqu'un corrige le
// bug, ce test se met à passer et Vitest le signale → obligation de mettre à
// jour. Le bug est ainsi tracé dans le code, pas seulement dans un rapport.
//
// Non corrigés ici volontairement : reclasser des colis change les
// notifications WhatsApp envoyées au prochain sync (un colis passant de
// `en_preparation` à `en_transit` déclenche un message). Effet de bord à
// valider explicitement — hors périmètre de la stabilisation.
describe('BUG-12 (ouvert) / BUG-13 (corrigé) — états ZRExpress non reconnus par mapStatus', () => {
  it.fails('BUG-12 : « Vers Wilaya » devrait être en_transit (retourne en_preparation)', () => {
    // Onglet réel ZRExpress « Vers Wilaya » — 11 colis observés chez
    // l'utilisateur. Aucun terme de la liste `en_transit` ne correspond, donc
    // la fonction retombe sur le défaut `en_preparation`.
    // Conséquence : le client reçoit « on prépare votre colis » alors qu'il est
    // déjà acheminé vers sa wilaya.
    expect(mapStatus('Vers Wilaya')).toBe('en_transit');
  });

  // Corrigé : passage silencieux (isPostDeliveryState), aucune notification.
  it('BUG-13 : « Encaissé » est livre', () => {
    // Incohérence interne à src/lib/zrexpress/status.ts :
    // `classifySwappedDelivery` traite bien encaisse/recouvert comme un succès
    // (« Livré → Encaissé → Recouvert = les 3 = client servi ») mais `mapStatus`
    // ne connaît pas ces états.
    // Conséquence : colis livré ET encaissé affiché « en préparation », et la
    // notification « livré » n'est jamais envoyée.
    expect(mapStatus('Encaissé')).toBe('livre');
  });

  it('BUG-13b : « Recouvert » est livre', () => {
    expect(mapStatus('Recouvert')).toBe('livre');
  });
});

describe("mapStatus — LA SITUATION PRIME SUR L'ÉTAT", () => {
  it('un colis « En préparation » mais « Ne répond pas » est un échec', () => {
    // Sans cette règle, le client recevrait « on prépare votre colis »
    // alors que le livreur ne l'a jamais joint.
    expect(mapStatus('En préparation', 'Ne répond pas 3')).toBe('echec');
  });

  it('un colis « Livré » mais situation « Retour » est un retour', () => {
    expect(mapStatus('Livré', 'Retour expéditeur')).toBe('retourne');
  });

  it("situation vide → on retombe sur l'état", () => {
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
      '',
      'xyz',
      'Livré',
      'Retourné',
      'En transit',
      'Dispatch',
      'Prêt à expédier',
      'Sortie en livraison',
      'Vers Wilaya',
    ];
    for (const e of echantillons) {
      expect(VALIDES).toContain(mapStatus(e));
    }
  });
});

describe('États post-livraison ZRExpress (encaissé, recouvert, récupéré)', () => {
  it('recouvert / encaissé = livré, même avec une vieille situation', () => {
    expect(mapStatus('recouvert')).toBe('livre');
    expect(mapStatus('encaisse')).toBe('livre');
    expect(mapStatus('Encaissé')).toBe('livre');
    expect(mapStatus('recouvert', 'Ne répond pas 1')).toBe('livre');
  });

  it('récupéré par le fournisseur = retourné (échec si la situation le dit)', () => {
    expect(mapStatus('recupere_par_fournisseur')).toBe('retourne');
    expect(mapStatus('recupere_par_fournisseur', 'Commande annulée')).toBe('echec');
  });

  it('les états en cours restent inchangés', () => {
    expect(mapStatus('sortie_en_livraison')).toBe('en_livraison');
    expect(mapStatus('vers_wilaya')).not.toBe('livre');
    expect(mapStatus('commande_recue')).toBe('en_preparation');
    expect(mapStatus('livre')).toBe('livre');
  });

  it('isPostDeliveryState : seuls les états de fin de parcours sont silencieux', () => {
    for (const s of [
      'recouvert',
      'encaisse',
      'recupere_par_fournisseur',
      'remboursement_reinjecte',
    ])
      expect(isPostDeliveryState(s), s).toBe(true);
    for (const s of ['livre', 'sortie_en_livraison', 'vers_wilaya', 'commande_recue', ''])
      expect(isPostDeliveryState(s), s).toBe(false);
  });
});

describe('silentTrackingNumbers — aucune rafale WhatsApp à la reclassification', () => {
  it('marque les colis post-livraison, pas les autres', () => {
    const parcels = [
      { trackingNumber: 'A', state: { name: 'recouvert' } },
      { trackingNumber: 'B', state: { name: 'livre' } },
      { trackingNumber: 'C', state: { name: 'recupere_par_fournisseur' } },
      { trackingNumber: 'D', state: { name: 'sortie_en_livraison' } },
    ];
    const rows = parcels.map((p) => mapParcel(p, '2026-10-26T00:00:00.000Z'));
    expect([...silentTrackingNumbers(parcels, rows)].sort()).toEqual(['A', 'C']);
    expect(rows.map((r) => r.delivery_status)).toEqual([
      'livre',
      'livre',
      'retourne',
      'en_livraison',
    ]);
  });
});
