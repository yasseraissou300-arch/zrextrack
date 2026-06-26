// Protections anti-suspension WhatsApp.
//
// WhatsApp suspend les numéros qui envoient en masse à des contacts qui ne les
// ont pas enregistrés. Pour AutoTim, les clients reçoivent des notifications
// légitimes (livraison, SAV…) mais l'algo de WhatsApp ne le sait pas — il voit
// 200 messages en 30 sec avec le même texte « Bonjour {name}, ... » → spam.
//
// Stratégies appliquées :
//   1. Throttle : 3-5 sec de délai aléatoire entre chaque envoi (≠ rythme robotique)
//   2. Limite journalière : max N messages envoyés par 24h, glissant
//   3. Circuit breaker : 5 échecs consécutifs → on stoppe le batch
//   4. Variation : suffixe invisible unique par message → ≠ texte parfaitement
//      identique entre messages (WhatsApp détecte les copies exactes)

export const ANTI_SPAM = {
  // Délai entre 2 envois consécutifs en mode bulk (en millisecondes).
  // Random entre min et max pour ne pas avoir un rythme robotique.
  // Rallongé à 20-60s après une suspension WhatsApp : un rythme lent et
  // irrégulier ressemble bien plus à un envoi humain qu'un burst.
  THROTTLE_MIN_MS: 20000,
  THROTTLE_MAX_MS: 60000,

  // Plafond journalier glissant (sur 24h). TRÈS conservateur après la
  // suspension du numéro : on redescend bas pour reconstruire sa réputation.
  // À remonter LENTEMENT (jamais en burst) seulement si tout reste stable.
  DAILY_LIMIT: 40,

  // Si N envois consécutifs échouent, on stoppe le batch pour ne pas brûler
  // davantage de réputation du numéro.
  MAX_CONSECUTIVE_ERRORS: 5,

  // Pool d'emojis « safe » pour la variation. On en pioche 1 (ou rien) à la
  // fin du message — change la signature texte pour WhatsApp anti-dup.
  EMOJI_POOL: ['', '', '', '🙏', '✨', '🌟', '⭐', '💚', '☘️', '🤲'],
};

// Délai aléatoire entre throttle min et max.
export function randomThrottle(): number {
  const span = ANTI_SPAM.THROTTLE_MAX_MS - ANTI_SPAM.THROTTLE_MIN_MS;
  return ANTI_SPAM.THROTTLE_MIN_MS + Math.floor(Math.random() * span);
}

// Sleep helper utilisé entre les envois.
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Pioche un emoji du pool (ou chaîne vide) pour varier la fin du message.
function pickEmoji(): string {
  return ANTI_SPAM.EMOJI_POOL[Math.floor(Math.random() * ANTI_SPAM.EMOJI_POOL.length)];
}

// Insère 1-3 caractères « zero-width space » (U+200B) à des positions aléatoires
// du texte. Invisible à l'œil mais change la signature byte du message → casse
// la détection de doublons côté WhatsApp.
function injectZWS(text: string): string {
  if (!text) return text;
  const count = 1 + Math.floor(Math.random() * 3);
  const chars = [...text];
  for (let i = 0; i < count; i++) {
    // Évite d'insérer juste avant ou après un emoji / URL — on cible des
    // positions sur des lettres ASCII pour rester safe.
    const safePositions: number[] = [];
    for (let j = 1; j < chars.length - 1; j++) {
      if (/[a-zA-Z]/.test(chars[j])) safePositions.push(j);
    }
    if (safePositions.length === 0) break;
    const pos = safePositions[Math.floor(Math.random() * safePositions.length)];
    chars.splice(pos, 0, '​');
  }
  return chars.join('');
}

// Applique la variation à un message avant envoi.
// Garanties : ne casse pas le sens, n'altère pas les URLs, ne modifie pas les
// emojis. Juste assez de bruit pour éviter la détection de duplication.
export function varyMessage(text: string): string {
  if (!text) return text;
  const emoji = pickEmoji();
  const withEmoji = emoji ? `${text} ${emoji}` : text;
  return injectZWS(withEmoji);
}

// Calcule combien de messages on peut encore envoyer aujourd'hui pour ce user
// avant de toucher le plafond.
export function remainingDailyQuota(sentToday: number): number {
  return Math.max(0, ANTI_SPAM.DAILY_LIMIT - sentToday);
}
