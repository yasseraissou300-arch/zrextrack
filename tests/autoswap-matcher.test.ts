// Phase 0 — Test C : moteur AutoSwap.
//
// Enjeu : proposer un swap invalide fait perdre de l'argent (frais de swap
// facturés par ZRExpress) et de la crédibilité. Les règles ZRExpress sont
// strictes : seules les situations « Ne répond pas 3 » et « Commande annulée »
// sont swappables, max 2 swaps par colis, et les wilayas du Sud ne peuvent
// swapper qu'en interne.

import { describe, it, expect } from 'vitest';
import {
  isSituationSwappable,
  isSwappable,
  isTarget,
  normalizeParcel,
  matchSwappables,
  parseProductsDescription,
} from '@/lib/autoswap/matcher';
import type { ZRParcel } from '@/lib/autoswap/types';

function colis(over: Partial<ZRParcel> & { desc?: string } = {}): ZRParcel {
  const { desc, ...rest } = over;
  return {
    id: over.id ?? crypto.randomUUID(),
    trackingNumber: over.trackingNumber ?? 'ZR-' + Math.random().toString(36).slice(2, 8),
    productsDescription: desc ?? 'pantalon lain( pl )( noir M ) :  - 1',
    deliveryAddress: { city: 'Alger', cityTerritoryId: 'alg-1', cityTerritoryCode: 16 },
    customer: { name: 'Client', phone: { number1: '213555000000' } },
    swap: { count: 0, isEligibleForSwap: false, sameCityPrice: 50, differentCityPrice: 100 },
    ...rest,
  } as ZRParcel;
}

describe('Règle ZRExpress — situations swappables', () => {
  it('« Ne répond pas 3 » est swappable', () => {
    expect(isSituationSwappable('Ne répond pas 3')).toBe(true);
  });

  it('« Ne répond pas 1 » et « 2 » ne le sont PAS', () => {
    // Point critique : proposer un swap sur « Ne répond pas 1 » serait refusé
    // par ZRExpress. Le chiffre 3 est exigé par leur règle affichée.
    expect(isSituationSwappable('Ne répond pas 1')).toBe(false);
    expect(isSituationSwappable('Ne répond pas 2')).toBe(false);
  });

  it('« Commande annulée » et « Annulé par le client » sont swappables', () => {
    expect(isSituationSwappable('Commande annulée')).toBe(true);
    expect(isSituationSwappable('Annulé par le client')).toBe(true);
  });

  it('les autres situations ne le sont pas', () => {
    expect(isSituationSwappable('Reportée à une date ultérieure')).toBe(false);
    expect(isSituationSwappable('Appel sans réponse')).toBe(false);
    expect(isSituationSwappable('')).toBe(false);
  });
});

describe('isSwappable — flag API + repli situation + limite de 2 swaps', () => {
  it("accepte quand l'API positionne isEligibleForSwap", () => {
    const p = normalizeParcel(
      colis({ swap: { count: 0, isEligibleForSwap: true } } as Partial<ZRParcel>)
    );
    expect(isSwappable(p)).toBe(true);
  });

  it('repli sur la situation quand le flag API est absent', () => {
    // Cas réel observé : ZRExpress listait 21 colis swappables, le flag n'était
    // vrai que sur 1 seul.
    const p = normalizeParcel(colis({ situation: 'Ne répond pas 3' } as Partial<ZRParcel>));
    expect(isSwappable(p)).toBe(true);
  });

  it('REFUSE un colis déjà swappé 2 fois (limite ZRExpress)', () => {
    const p = normalizeParcel(
      colis({
        situation: 'Ne répond pas 3',
        swap: { count: 2, isEligibleForSwap: true },
      } as Partial<ZRParcel>)
    );
    expect(isSwappable(p)).toBe(false);
  });

  it('accepte encore à count = 1', () => {
    const p = normalizeParcel(
      colis({
        situation: 'Ne répond pas 3',
        swap: { count: 1, isEligibleForSwap: false },
      } as Partial<ZRParcel>)
    );
    expect(isSwappable(p)).toBe(true);
  });
});

describe('isTarget — commandes en attente (comparaison normalisée)', () => {
  it('reconnaît snake_case ET libellé accentué', () => {
    // Bug corrigé : le match exact ratait « Commande reçue » (12 au lieu de 45).
    for (const s of ['commande_recue', 'Commande reçue', 'pret_a_expedier', 'Prêt à expédier']) {
      expect(isTarget(normalizeParcel(colis({ state: { name: s } } as Partial<ZRParcel>)))).toBe(
        true
      );
    }
  });

  it('exclut les états déjà expédiés', () => {
    for (const s of ['Vers Wilaya', 'Sortie en livraison', 'Livré', 'Dispatch']) {
      expect(isTarget(normalizeParcel(colis({ state: { name: s } } as Partial<ZRParcel>)))).toBe(
        false
      );
    }
  });
});

describe('parseProductsDescription', () => {
  it('extrait nom, SKU, couleur, taille et quantité', () => {
    const p = parseProductsDescription('pantalon lain( pl )( noir M ) :  - 2');
    expect(p.productSkuCode).toBe('pl');
    expect(p.variantColors).toContain('noir');
    expect(p.variantSizes).toContain('M');
    expect(p.quantity).toBe(2);
  });

  it('gère le texte libre sans parenthèses', () => {
    const p = parseProductsDescription('Pontalon lain sport beige M  :  - 1');
    expect(p.variantColors).toContain('beige');
    expect(p.quantity).toBe(1);
  });

  it('normalise les synonymes de couleur (blue → bleu)', () => {
    expect(parseProductsDescription('robe( r )( blue L )').variantColors).toContain('bleu');
  });

  it('ne lève pas sur description vide', () => {
    expect(() => parseProductsDescription('')).not.toThrow();
  });
});

describe('matchSwappables — appariement', () => {
  const src = () =>
    colis({
      id: 'SRC',
      trackingNumber: 'SRC-1',
      situation: 'Ne répond pas 3',
      desc: 'pantalon lain( pl )( noir M ) :  - 1',
    } as Partial<ZRParcel>);

  it('apparie un produit identique (STRONG)', () => {
    const p = matchSwappables([
      src(),
      colis({
        id: 'TGT',
        trackingNumber: 'TGT-1',
        state: { name: 'commande_recue' },
        desc: 'pantalon lain( pl )( noir M ) :  - 1',
      } as Partial<ZRParcel>),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0].confidence).toBe('STRONG');
  });

  it('apparie partiellement un pack multi-couleurs (WEAK)', () => {
    // Le colis contient [noir, bleu], la cible ne veut que [noir] → utile.
    const p = matchSwappables([
      colis({
        id: 'S',
        trackingNumber: 'S-1',
        situation: 'Commande annulée',
        desc: 'pantalon lain( pl )( noir , bleu M ) :  - 1',
      } as Partial<ZRParcel>),
      colis({
        id: 'T',
        trackingNumber: 'T-1',
        state: { name: 'commande_recue' },
        desc: 'pantalon lain( pl )( noir M ) :  - 1',
      } as Partial<ZRParcel>),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0].confidence).toBe('WEAK');
  });

  it('REFUSE des produits différents', () => {
    expect(
      matchSwappables([
        src(),
        colis({
          id: 'T',
          state: { name: 'commande_recue' },
          desc: 'robe ete( re )( noir M ) :  - 1',
        } as Partial<ZRParcel>),
      ])
    ).toHaveLength(0);
  });

  it('REFUSE si aucune couleur commune', () => {
    expect(
      matchSwappables([
        src(),
        colis({
          id: 'T',
          state: { name: 'commande_recue' },
          desc: 'pantalon lain( pl )( rouge M ) :  - 1',
        } as Partial<ZRParcel>),
      ])
    ).toHaveLength(0);
  });

  it('REFUSE si les quantités diffèrent', () => {
    expect(
      matchSwappables([
        src(),
        colis({
          id: 'T',
          state: { name: 'commande_recue' },
          desc: 'pantalon lain( pl )( noir M ) :  - 3',
        } as Partial<ZRParcel>),
      ])
    ).toHaveLength(0);
  });

  it('RESPECTE la restriction des wilayas du Sud (Adrar = 1)', () => {
    // Source à Adrar → ne peut swapper que dans Adrar.
    const sud = colis({
      id: 'S',
      situation: 'Ne répond pas 3',
      desc: 'pantalon lain( pl )( noir M ) :  - 1',
      deliveryAddress: { city: 'Adrar', cityTerritoryId: 'adr', cityTerritoryCode: 1 },
    } as Partial<ZRParcel>);
    const alger = colis({
      id: 'T',
      state: { name: 'commande_recue' },
      desc: 'pantalon lain( pl )( noir M ) :  - 1',
      deliveryAddress: { city: 'Alger', cityTerritoryId: 'alg', cityTerritoryCode: 16 },
    } as Partial<ZRParcel>);
    expect(matchSwappables([sud, alger])).toHaveLength(0);

    const adrar2 = colis({
      id: 'T2',
      state: { name: 'commande_recue' },
      desc: 'pantalon lain( pl )( noir M ) :  - 1',
      deliveryAddress: { city: 'Adrar', cityTerritoryId: 'adr', cityTerritoryCode: 1 },
    } as Partial<ZRParcel>);
    expect(matchSwappables([sud, adrar2])).toHaveLength(1);
  });

  it("n'utilise JAMAIS deux fois le même colis (affectation 1-pour-1)", () => {
    const props = matchSwappables([
      src(),
      colis({
        id: 'T1',
        trackingNumber: 'T-1',
        state: { name: 'commande_recue' },
        desc: 'pantalon lain( pl )( noir M ) :  - 1',
      } as Partial<ZRParcel>),
      colis({
        id: 'T2',
        trackingNumber: 'T-2',
        state: { name: 'commande_recue' },
        desc: 'pantalon lain( pl )( noir M ) :  - 1',
      } as Partial<ZRParcel>),
    ]);
    expect(props).toHaveLength(1); // une seule source → une seule proposition
    const sources = props.map((p) => p.swappable.id);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("ne propose rien quand il n'y a aucun colis swappable", () => {
    expect(
      matchSwappables([
        colis({ situation: 'Ne répond pas 1' } as Partial<ZRParcel>),
        colis({ state: { name: 'commande_recue' } } as Partial<ZRParcel>),
      ])
    ).toHaveLength(0);
  });

  it('ne lève pas sur une liste vide', () => {
    expect(() => matchSwappables([])).not.toThrow();
  });
});
