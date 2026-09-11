// Backoff exponentiel avec jitter — Phase 1.
//
// Sans jitter, dix jobs échoués au même instant retentent tous à la même
// seconde et re-saturent le service en panne. Le bruit aléatoire les étale.

export const BACKOFF = {
  /** Délai de base après la 1re tentative. */
  BASE_MS: 30_000,
  /** Plafond : au-delà, on n'attend jamais plus d'une heure. */
  MAX_MS: 3_600_000,
  /** Amplitude du jitter, ±20 %. */
  JITTER_RATIO: 0.2,
};

/**
 * Délai avant la prochaine tentative.
 *
 *   tentative 1 → ~30 s      tentative 4 → ~4 min
 *   tentative 2 → ~1 min     tentative 5 → ~8 min
 *   tentative 3 → ~2 min     au-delà     → plafonné à 1 h
 *
 * Toujours strictement positif : un délai nul ou négatif ferait boucler le
 * worker sur le même job dans le même tick.
 */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempts));
  // 2^(n-1) plafonné avant multiplication pour éviter tout dépassement.
  const exponent = Math.min(n - 1, 20);
  const raw = Math.min(BACKOFF.BASE_MS * 2 ** exponent, BACKOFF.MAX_MS);
  const jitter = raw * BACKOFF.JITTER_RATIO * (random() * 2 - 1);
  return Math.max(1_000, Math.round(raw + jitter));
}

/** Instant de la prochaine tentative. */
export function nextRunAfter(attempts: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + backoffMs(attempts));
}
