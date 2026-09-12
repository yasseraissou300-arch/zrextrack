// Phase 0 — Test B : anti-spam et warm-up WhatsApp.
//
// Enjeu : ce numéro a DÉJÀ été banni définitivement une fois. Ces protections
// sont la seule barrière entre l'utilisateur et une nouvelle suspension.
// Un bug qui laisserait passer plus de messages que prévu = ban.

import { describe, it, expect } from 'vitest';
import {
  ANTI_SPAM,
  WARMUP_PHASES,
  warmupState,
  effectiveDailyLimit,
  remainingDailyQuota,
  randomThrottle,
  varyMessage,
} from '@/lib/whatsapp/anti-spam';

/** Date ISO située il y a `n` jours. */
const ilYaJours = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe('Paliers de warm-up 8 → 15 → 25 → 40', () => {
  it('jours 1-3 → 8 messages/24h', () => {
    expect(effectiveDailyLimit(ilYaJours(0))).toBe(8);
    expect(effectiveDailyLimit(ilYaJours(2.9))).toBe(8);
  });

  it('jours 4-7 → 15', () => {
    expect(effectiveDailyLimit(ilYaJours(3))).toBe(15);
    expect(effectiveDailyLimit(ilYaJours(6.9))).toBe(15);
  });

  it('jours 8-14 → 25', () => {
    expect(effectiveDailyLimit(ilYaJours(7))).toBe(25);
    expect(effectiveDailyLimit(ilYaJours(13.9))).toBe(25);
  });

  it('jour 15+ → 40 (régime normal)', () => {
    expect(effectiveDailyLimit(ilYaJours(14))).toBe(40);
    expect(effectiveDailyLimit(ilYaJours(365))).toBe(40);
  });

  it('warm-up non activé (null) → plafond normal', () => {
    expect(effectiveDailyLimit(null)).toBe(ANTI_SPAM.DAILY_LIMIT);
    expect(effectiveDailyLimit(undefined)).toBe(ANTI_SPAM.DAILY_LIMIT);
  });

  it('les paliers sont strictement croissants et plafonnés à DAILY_LIMIT', () => {
    const limites = WARMUP_PHASES.map((p) => p.limit);
    for (let i = 1; i < limites.length; i++) {
      expect(limites[i]).toBeGreaterThan(limites[i - 1]);
    }
    expect(Math.max(...limites)).toBe(ANTI_SPAM.DAILY_LIMIT);
  });
});

describe("warmupState — informations affichées à l'utilisateur", () => {
  it('signale le warm-up actif tant que le plafond est réduit', () => {
    expect(warmupState(ilYaJours(1)).isActive).toBe(true);
    expect(warmupState(ilYaJours(20)).isActive).toBe(false);
  });

  it('annonce le prochain palier, null une fois au maximum', () => {
    const s = warmupState(ilYaJours(1));
    expect(s.nextPhaseInDays).toBeGreaterThan(0);
    expect(warmupState(ilYaJours(30)).nextPhaseInDays).toBeNull();
  });

  it('ne lève pas sur une date invalide', () => {
    expect(() => warmupState('pas-une-date')).not.toThrow();
  });
});

describe('remainingDailyQuota — LE garde-fou anti-ban', () => {
  it('décompte correctement sous warm-up', () => {
    expect(remainingDailyQuota(0, ilYaJours(1))).toBe(8);
    expect(remainingDailyQuota(5, ilYaJours(1))).toBe(3);
  });

  it('ne renvoie JAMAIS de valeur négative', () => {
    // Un négatif propagé en `limit` d'une requête ferait exploser le batch.
    expect(remainingDailyQuota(999, ilYaJours(1))).toBe(0);
    expect(remainingDailyQuota(999, null)).toBe(0);
  });

  it('bloque à zéro exactement au plafond', () => {
    expect(remainingDailyQuota(8, ilYaJours(1))).toBe(0);
    expect(remainingDailyQuota(40, null)).toBe(0);
  });

  it('ne dépasse jamais le plafond effectif, quel que soit le jour', () => {
    for (const j of [0, 1, 3, 5, 7, 10, 14, 30, 100]) {
      const restant = remainingDailyQuota(0, ilYaJours(j));
      expect(restant).toBeLessThanOrEqual(ANTI_SPAM.DAILY_LIMIT);
      expect(restant).toBe(effectiveDailyLimit(ilYaJours(j)));
    }
  });
});

describe('Throttle', () => {
  it('reste toujours dans la fenêtre configurée', () => {
    for (let i = 0; i < 200; i++) {
      const d = randomThrottle();
      expect(d).toBeGreaterThanOrEqual(ANTI_SPAM.THROTTLE_MIN_MS);
      expect(d).toBeLessThanOrEqual(ANTI_SPAM.THROTTLE_MAX_MS);
    }
  });

  it("l'espacement minimal reste conservateur (≥ 20 s)", () => {
    expect(ANTI_SPAM.THROTTLE_MIN_MS).toBeGreaterThanOrEqual(20_000);
  });
});

describe('varyMessage — évite la détection de doublon', () => {
  it('produit des variantes différentes du même texte', () => {
    const base = 'Bonjour, votre colis est en route vers Alger';
    const variantes = new Set(Array.from({ length: 30 }, () => varyMessage(base)));
    expect(variantes.size).toBeGreaterThan(1);
  });

  it('préserve le sens : les mots restent lisibles', () => {
    const varie = varyMessage('Bonjour votre colis arrive');
    // On retire les zero-width spaces injectés puis on recompare.
    expect(varie.replace(/​/g, '')).toContain('colis');
  });

  it('tolère une chaîne vide', () => {
    expect(() => varyMessage('')).not.toThrow();
  });
});
