// Score de fiabilité client : dérivé des commandes passées, sert à repérer
// AVANT expédition les clients qui refusent leurs colis.

import { describe, it, expect } from 'vitest';
import {
  activeOrdersOfRiskyClients,
  buildClientStats,
  clientKey,
  riskLevel,
} from '@/lib/clients/risk';

describe('riskLevel', () => {
  it('aucun colis terminé = nouveau', () => {
    expect(riskLevel(0, 0)).toBe('nouveau');
  });

  it('livrés sans aucun refus : bon puis fidèle à partir de 2', () => {
    expect(riskLevel(1, 0)).toBe('bon');
    expect(riskLevel(2, 0)).toBe('fidele');
    expect(riskLevel(9, 0)).toBe('fidele');
  });

  it('un seul refus ne suffit jamais à classer « à risque »', () => {
    expect(riskLevel(0, 1)).toBe('surveiller');
    expect(riskLevel(1, 1)).toBe('surveiller');
  });

  it('2 refus ou plus et 2 colis sur 3 refusés = à risque', () => {
    expect(riskLevel(0, 2)).toBe('risque');
    expect(riskLevel(1, 2)).toBe('risque');
    expect(riskLevel(1, 5)).toBe('risque');
  });

  it('un bon client avec un refus isolé reste bon', () => {
    expect(riskLevel(3, 1)).toBe('bon');
    expect(riskLevel(5, 2)).toBe('bon');
    // 2 refus sur 4 : ni bon ni à risque
    expect(riskLevel(2, 2)).toBe('surveiller');
  });
});

describe('clientKey', () => {
  it('regroupe le même numéro écrit de plusieurs façons', () => {
    const a = clientKey({ customer_whatsapp: '0770 12 34 56', customer_name: 'Amine' });
    const b = clientKey({ customer_whatsapp: '+213770123456', customer_name: 'AMINE B.' });
    const c = clientKey({ customer_whatsapp: '213770123456', customer_name: '' });
    expect(a).toBe('213770123456');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('sans téléphone exploitable, retombe sur le nom', () => {
    expect(clientKey({ customer_whatsapp: '', customer_name: ' Sara ' })).toBe('nom:sara');
    expect(clientKey({ customer_whatsapp: '12', customer_name: 'Sara' })).toBe('nom:sara');
  });
});

const o = (phone: string, status: string, extra: Record<string, unknown> = {}) => ({
  customer_name: `Client ${phone}`,
  customer_whatsapp: phone,
  wilaya: 'Alger',
  delivery_status: status,
  cod: 3000,
  ...extra,
});

describe('buildClientStats', () => {
  it('compte livrés / refus / en cours et le montant encaissé', () => {
    const [c] = buildClientStats([
      o('0550000001', 'livre'),
      o('0550000001', 'livre', { cod: 4500 }),
      o('+213550000001', 'echec'),
      o('0550000001', 'retourne'),
      o('0550000001', 'en_preparation'),
    ]);
    expect(c).toMatchObject({
      total: 5,
      livre: 2,
      refus: 2,
      enCours: 1,
      caLivre: 7500,
      tauxLivraison: 50,
      level: 'surveiller',
    });
  });

  it('les colis en cours ne comptent ni pour ni contre le client', () => {
    const [c] = buildClientStats([o('0550000002', 'en_livraison'), o('0550000002', 'en_transit')]);
    expect(c.level).toBe('nouveau');
    expect(c.tauxLivraison).toBeNull();
  });

  it('ignore les lignes sans téléphone ni nom, trie par nombre de commandes', () => {
    const stats = buildClientStats([
      { customer_name: '', customer_whatsapp: '', delivery_status: 'echec' },
      o('0550000003', 'livre'),
      o('0550000004', 'echec'),
      o('0550000004', 'echec'),
    ]);
    expect(stats.map((c) => c.key)).toEqual(['213550000004', '213550000003']);
    expect(stats[0].level).toBe('risque');
  });
});

describe('activeOrdersOfRiskyClients', () => {
  it('ne remonte que les commandes encore en cours des clients à risque', () => {
    const rows = [
      o('0550000005', 'echec'),
      o('0550000005', 'retourne'),
      o('0550000005', 'en_preparation', { tracking_number: 'T-RISQUE', cod: 5200 }),
      // bon client : sa commande en cours ne doit pas remonter
      o('0550000006', 'livre'),
      o('0550000006', 'en_preparation', { tracking_number: 'T-BON' }),
      // client à risque mais plus aucune commande en cours
      o('0550000007', 'echec'),
      o('0550000007', 'echec'),
    ];
    const risky = activeOrdersOfRiskyClients(rows, buildClientStats(rows));
    expect(risky).toHaveLength(1);
    expect(risky[0]).toMatchObject({ tracking_number: 'T-RISQUE', cod: 5200, refus: 2, livre: 0 });
  });
});
