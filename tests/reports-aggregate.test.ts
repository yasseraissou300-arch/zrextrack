// Page Rapports : argent encaissé / perdu, taux de livraison par wilaya et
// par produit (variantes regroupées).

import { describe, it, expect } from 'vitest';
import { buildReport, productBase } from '@/lib/reports/aggregate';

describe('productBase', () => {
  it('retire la variante, la taille et la quantité', () => {
    expect(productBase('Veste EMY ( 50 / Grenat ) - 1')).toBe('Veste EMY');
    expect(productBase('Veste EMY ( 48 / grenta ) - 2')).toBe('Veste EMY');
    expect(productBase('robe( r )( noir 2xl )')).toBe('robe');
    expect(productBase('Ensemble  Lina x2')).toBe('Ensemble Lina');
  });

  it('garde un nom sans variante tel quel, « Sans nom » si vide', () => {
    expect(productBase('Abaya Dubai')).toBe('Abaya Dubai');
    expect(productBase('')).toBe('Sans nom');
    expect(productBase(null)).toBe('Sans nom');
    expect(productBase('( 50 / noir )')).toBe('Sans nom');
  });
});

const o = (delivery_status: string, cod: number, wilaya = 'Alger', product_name = 'Veste EMY') => ({
  delivery_status,
  cod,
  wilaya,
  product_name,
});

describe('buildReport', () => {
  const rows = [
    o('livre', 4000),
    o('livre', 6000, 'Oran'),
    o('echec', 5000),
    o('retourne', 3000, 'Oran', 'Robe ( M )'),
    o('en_preparation', 2500),
    o('en_livraison', 1500, 'Oran', 'Robe ( L ) - 1'),
  ];
  const r = buildReport(rows);

  it('compteurs et taux de livraison sur les colis TERMINÉS', () => {
    expect(r).toMatchObject({ total: 6, livre: 2, echec: 1, retourne: 1, enCours: 2 });
    // 2 livrés sur 4 terminés — les colis en cours ne font pas baisser le taux
    expect(r.tauxLivraison).toBe(50);
  });

  it('argent : encaissé, perdu (échecs + retours), en cours, panier moyen', () => {
    expect(r.caEncaisse).toBe(10000);
    expect(r.caPerdu).toBe(8000);
    expect(r.caEnCours).toBe(4000);
    expect(r.panierMoyen).toBe(5000);
  });

  it('par wilaya : volume, taux et montant encaissé', () => {
    expect(r.wilayas).toEqual([
      { name: 'Alger', total: 3, livre: 1, refus: 1, taux: 50, ca: 4000 },
      { name: 'Oran', total: 3, livre: 1, refus: 1, taux: 50, ca: 6000 },
    ]);
  });

  it('par produit : les variantes sont regroupées', () => {
    expect(r.produits).toEqual([
      { name: 'Veste EMY', total: 4, livre: 2, refus: 1, taux: 67, ca: 10000 },
      { name: 'Robe', total: 2, livre: 0, refus: 1, taux: 0, ca: 0 },
    ]);
  });

  it('aucune commande : tout à zéro, pas de division par zéro', () => {
    expect(buildReport([])).toMatchObject({
      total: 0,
      tauxLivraison: 0,
      panierMoyen: 0,
      wilayas: [],
      produits: [],
    });
  });

  it('un cod texte ou absent ne casse pas les sommes', () => {
    const x = buildReport([
      { delivery_status: 'livre', cod: '2500' },
      { delivery_status: 'livre', cod: null },
    ]);
    expect(x.caEncaisse).toBe(2500);
  });
});
