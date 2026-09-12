// Phase 1 — Backoff exponentiel.
//
// Enjeu : un délai nul ou négatif ferait boucler le worker sur le même job
// dans le même tick. Un backoff sans jitter ferait repartir tous les jobs
// échoués à la même seconde et re-saturerait le service en panne.

import { describe, it, expect } from 'vitest';
import { backoffMs, nextRunAfter, BACKOFF } from '@/lib/queue/backoff';

describe('backoffMs — progression', () => {
  // random() = 0.5 → jitter nul, valeurs déterministes
  const sansJitter = () => 0.5;

  it('suit la progression 30 s → 1 min → 2 min → 4 min → 8 min', () => {
    expect(backoffMs(1, sansJitter)).toBe(30_000);
    expect(backoffMs(2, sansJitter)).toBe(60_000);
    expect(backoffMs(3, sansJitter)).toBe(120_000);
    expect(backoffMs(4, sansJitter)).toBe(240_000);
    expect(backoffMs(5, sansJitter)).toBe(480_000);
  });

  it('plafonne à 1 heure', () => {
    expect(backoffMs(20, sansJitter)).toBe(BACKOFF.MAX_MS);
    expect(backoffMs(100, sansJitter)).toBe(BACKOFF.MAX_MS);
  });

  it('ne déborde pas sur un nombre de tentatives absurde', () => {
    const d = backoffMs(1e6, sansJitter);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeLessThanOrEqual(BACKOFF.MAX_MS * 1.2);
  });
});

describe('backoffMs — jitter', () => {
  it('reste dans ±20 % de la valeur nominale', () => {
    for (let i = 0; i < 500; i++) {
      const d = backoffMs(3);
      expect(d).toBeGreaterThanOrEqual(120_000 * 0.8 - 1);
      expect(d).toBeLessThanOrEqual(120_000 * 1.2 + 1);
    }
  });

  it('produit des valeurs différentes — sinon le jitter ne sert à rien', () => {
    const valeurs = new Set(Array.from({ length: 50 }, () => backoffMs(3)));
    expect(valeurs.size).toBeGreaterThan(1);
  });
});

describe('backoffMs — invariants de sûreté', () => {
  it('est TOUJOURS strictement positif', () => {
    // Un délai <= 0 replanifierait le job dans le passé → boucle infinie.
    for (const n of [1, 2, 3, 5, 10, 50]) {
      for (const r of [() => 0, () => 0.5, () => 0.999]) {
        expect(backoffMs(n, r)).toBeGreaterThan(0);
      }
    }
  });

  it('tolère 0 ou un nombre négatif de tentatives', () => {
    expect(backoffMs(0)).toBeGreaterThan(0);
    expect(backoffMs(-5)).toBeGreaterThan(0);
  });

  it('reste au moins à 1 seconde même au pire jitter', () => {
    expect(backoffMs(1, () => 0)).toBeGreaterThanOrEqual(1_000);
  });
});

describe('nextRunAfter', () => {
  it('renvoie un instant dans le futur', () => {
    const base = new Date('2026-09-10T12:00:00Z');
    expect(nextRunAfter(1, base).getTime()).toBeGreaterThan(base.getTime());
  });

  it('croît avec le nombre de tentatives', () => {
    const base = new Date('2026-09-10T12:00:00Z');
    const t1 = nextRunAfter(1, base).getTime();
    const t5 = nextRunAfter(5, base).getTime();
    expect(t5).toBeGreaterThan(t1);
  });
});
