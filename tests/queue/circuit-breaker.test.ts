// Phase 1 — Circuit breaker WhatsApp.
//
// Enjeu mesuré : 532 471 lignes d'échec produites en production entre avril et
// juillet 2026, toutes « Session WhatsApp expirée », pour 45 messages envoyés.
// Ces tests verrouillent le mécanisme censé rendre cela impossible.

import { describe, it, expect } from 'vitest';
import { circuitState, afterFailure, afterSuccess, CIRCUIT } from '@/lib/queue/circuit-breaker';

const NOW = new Date('2026-09-10T12:00:00Z');
const futur = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const passe = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('circuitState — lecture', () => {
  it("fermé quand aucun réglage n'existe", () => {
    expect(circuitState(null, NOW)).toEqual({ open: false, until: null, failures: 0 });
  });

  it('fermé quand circuit_open_until est nul', () => {
    const s = circuitState({ consecutive_send_failures: 3, circuit_open_until: null }, NOW);
    expect(s.open).toBe(false);
    expect(s.failures).toBe(3);
  });

  it("OUVERT quand la date d'ouverture est dans le futur", () => {
    const s = circuitState(
      { consecutive_send_failures: 5, circuit_open_until: futur(10 * 60_000) },
      NOW
    );
    expect(s.open).toBe(true);
    expect(s.until).toBeInstanceOf(Date);
  });

  it('refermé une fois la date dépassée', () => {
    const s = circuitState(
      { consecutive_send_failures: 5, circuit_open_until: passe(60_000) },
      NOW
    );
    expect(s.open).toBe(false);
  });

  it('ne lève pas sur une date invalide — un réglage corrompu ne doit pas', () => {
    // bloquer tous les envois ni faire planter le tick.
    expect(() =>
      circuitState({ consecutive_send_failures: 1, circuit_open_until: 'pas-une-date' }, NOW)
    ).not.toThrow();
    expect(
      circuitState({ consecutive_send_failures: 1, circuit_open_until: 'pas-une-date' }, NOW).open
    ).toBe(false);
  });
});

describe('afterFailure — ouverture au seuil', () => {
  it("ne s'ouvre pas avant le seuil", () => {
    for (let n = 0; n < CIRCUIT.THRESHOLD - 1; n++) {
      expect(afterFailure(n, NOW).openUntil).toBeNull();
    }
  });

  it("s'ouvre EXACTEMENT au seuil", () => {
    const r = afterFailure(CIRCUIT.THRESHOLD - 1, NOW);
    expect(r.failures).toBe(CIRCUIT.THRESHOLD);
    expect(r.openUntil).not.toBeNull();
  });

  it('ouvre pour la durée configurée', () => {
    const r = afterFailure(CIRCUIT.THRESHOLD - 1, NOW);
    expect(r.openUntil!.getTime() - NOW.getTime()).toBe(CIRCUIT.OPEN_MS);
  });

  it('incrémente le compteur à chaque échec', () => {
    expect(afterFailure(0, NOW).failures).toBe(1);
    expect(afterFailure(7, NOW).failures).toBe(8);
  });
});

describe('afterSuccess — réarmement', () => {
  it('remet le compteur à zéro et referme', () => {
    expect(afterSuccess()).toEqual({ failures: 0, openUntil: null });
  });
});

describe('SCÉNARIO DE NON-RÉGRESSION — la panne des 532 471 lignes', () => {
  it('une session morte ouvre le circuit en 5 échecs, pas en 500 000', () => {
    // Simule la panne réelle : chaque envoi échoue avec la même erreur.
    let failures = 0;
    let openUntil: Date | null = null;
    let tentativesEffectuees = 0;

    for (let i = 0; i < 10_000; i++) {
      const etat = circuitState(
        {
          consecutive_send_failures: failures,
          circuit_open_until: openUntil ? openUntil.toISOString() : null,
        },
        NOW
      );
      if (etat.open) continue; // circuit ouvert → aucun envoi, aucune écriture

      tentativesEffectuees++;
      const r = afterFailure(failures, NOW);
      failures = r.failures;
      openUntil = r.openUntil;
    }

    // Sur 10 000 messages en attente, seuls 5 envois sont réellement tentés.
    expect(tentativesEffectuees).toBe(CIRCUIT.THRESHOLD);
    expect(failures).toBe(CIRCUIT.THRESHOLD);
    expect(openUntil).not.toBeNull();
  });

  it('un succès après réouverture remet le compteur à zéro', () => {
    const apresPanne = afterFailure(CIRCUIT.THRESHOLD - 1, NOW);
    expect(apresPanne.openUntil).not.toBeNull();

    // Le circuit se referme après OPEN_MS, l'envoi suivant réussit.
    const plusTard = new Date(NOW.getTime() + CIRCUIT.OPEN_MS + 1000);
    expect(
      circuitState(
        {
          consecutive_send_failures: apresPanne.failures,
          circuit_open_until: apresPanne.openUntil!.toISOString(),
        },
        plusTard
      ).open
    ).toBe(false);

    expect(afterSuccess().failures).toBe(0);
  });
});
