// Sélection des messages à renvoyer via « Renvoyer les échecs » (page Messages).
//
// L'ancien bouton renvoyait TOUTES les lignes « echec » des 200 dernières du
// journal, sans condition. Or ce journal contient (mesuré le 2026-09-10) des
// centaines de milliers d'échecs d'avril-juillet 2026 : un clic aurait envoyé
// jusqu'au plafond journalier des notifications de colis vieilles de deux
// mois, et renvoyé une deuxième fois un message déjà renvoyé avec succès
// (l'échec d'origine reste « echec » dans le journal après un renvoi réussi).

export interface MessageLogRow {
  tracking_number: string;
  customer_name: string;
  customer_whatsapp: string;
  message: string;
  status: string;
  sent_at: string;
}

/** Au-delà, une notification n'a plus de sens pour le client. */
export const RESEND_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const digits = (s: string) => (s || '').replace(/\D/g, '').slice(-9); // 9 derniers chiffres

/**
 * Échecs récents (< 24 h), dédoublonnés, pour lesquels AUCUN envoi réussi
 * plus récent n'existe vers le même numéro pour le même colis.
 */
export function selectResendable(rows: MessageLogRow[], now: number = Date.now()): MessageLogRow[] {
  const key = (r: MessageLogRow) => `${digits(r.customer_whatsapp)}|${r.tracking_number || ''}`;

  const lastSuccess = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== 'envoye') continue;
    const t = Date.parse(r.sent_at);
    if (!Number.isFinite(t)) continue;
    lastSuccess.set(key(r), Math.max(lastSuccess.get(key(r)) ?? 0, t));
  }

  const seen = new Set<string>();
  const out: MessageLogRow[] = [];
  for (const r of rows) {
    if (r.status !== 'echec') continue;
    const t = Date.parse(r.sent_at);
    if (!Number.isFinite(t) || now - t > RESEND_MAX_AGE_MS) continue;
    const k = key(r);
    if ((lastSuccess.get(k) ?? 0) > t) continue; // déjà renvoyé avec succès
    const dedupe = `${k}|${r.message}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(r);
  }
  return out;
}
