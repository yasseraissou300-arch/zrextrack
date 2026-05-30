// Classification des statuts ZRExpress → statut interne de l'app.
//
// Logique partagée entre la sync (/api/sync-zrexpress) et les statistiques
// de swaps (/api/autoswap/swapped-stats) pour garantir une classification
// IDENTIQUE partout. Extrait d'un route handler vers une lib pour pouvoir
// l'importer sans déclencher les contraintes d'export des fichiers route.ts
// de Next.js.

// Normalise une chaîne ZREXpress : minuscules + sans accents + espaces normalisés
export function norm(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // supprime les accents
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Map ZREXpress état + situation → statut interne
// RÈGLE : la situation est vérifiée EN PREMIER — elle prime toujours sur l'état
export function mapStatus(rawState: string, rawSituation = ''): string {
  const s = norm(rawState);
  const sit = norm(rawSituation);
  const has = (src: string, ...terms: string[]) => terms.some(t => src.includes(t));

  // ══ PRIORITÉ 1 : SITUATION → ÉCHEC ═══════════════════════════════════════
  // Si la situation indique un problème, peu importe l'état (même "En préparation")
  if (sit && has(sit,
    // Pas de réponse
    'appele sans reponse', 'sans reponse', 'appele sr', 'ne repond pas',
    'repond pas', 'pas repondu', 'pas de reponse',
    // Absent / injoignable
    'client absent', 'absent', 'non joignable', 'injoignable',
    // Refus
    'refus de livraison', 'refuse',
    // Annulé
    'annule', 'annulee', 'annulation',
    // Echec livraison
    'echec', 'echoue', 'echec de livraison', 'non livre', 'non remis', 'colis non remis',
    // Adresse/commune erronée
    'commune erronee', 'adresse erronee', 'adresse incorrecte', 'errone', 'erronee',
    'commune incorrecte', 'wilaya erronee',
    // Téléphone invalide
    'telephone incorrect', 'numero incorrect', 'numero invalide',
    // Introuvable
    'introuvable', 'adresse introuvable', 'client introuvable',
    // En attente d'info
    'en attente adresse', 'attente adresse', 'attente confirmation',
    'en attente de confirmation'
  )) return 'echec';

  // ══ PRIORITÉ 2 : SITUATION → RETOURNÉ ════════════════════════════════════
  if (sit && has(sit,
    'retourne', 'retour expediteur', 'retour confirme',
    'refus client', 'renvoye', 'renvoi', 'retour marchand'
  )) return 'retourne';

  // ══ PRIORITÉ 3 : SITUATION → EN LIVRAISON ════════════════════════════════
  if (sit && has(sit,
    'sorti en livraison', 'sorti', 'en cours de livraison', 'en distribution',
    'distribution', 'reporte', 'reportee', 'en route vers client',
    // ZREXpress : appel au client pour livraison bureau ou domicile
    'appel telephonique', 'appel tel', 'appele',
    // En attente de retrait au bureau
    'en attente de retrait', 'attente de retrait', 'attente retrait',
    'en attente au bureau', 'disponible au bureau', 'au bureau',
    // Passage prévu
    'passage prevu', 'passage programme', 'livraison prevue',
    // Avisé (client notifié)
    'avise', 'avisee', 'client avise',
    // Livraison en cours générique
    'en livraison', 'livraison en cours', 'en cours'
  )) return 'en_livraison';

  // ══ PRIORITÉ 4 : SITUATION → EN TRANSIT ══════════════════════════════════
  if (sit && has(sit, 'en transit', 'transit', 'hub', 'centre tri', 'arrive au hub', 'expedie')) return 'en_transit';

  // ══ PRIORITÉ 5 : SITUATION → LIVRÉ ═══════════════════════════════════════
  if (sit && has(sit, 'livre', 'remis') && !has(sit, 'en cours', 'sorti', 'non remis')) return 'livre';

  // ══ À PARTIR D'ICI : lecture de l'ÉTAT (aucune situation significative) ══

  // ── ÉTAT → LIVRÉ ─────────────────────────────────────────────────────────
  if (s === 'livre' || s === 'livree' || s === 'delivered') return 'livre';
  if (has(s, 'livre') && !has(s, 'en livr', 'en cours', 'retour')) return 'livre';
  if (has(s, 'remis au client', 'remis destinataire', 'livraison effectuee')) return 'livre';

  // ── ÉTAT → ÉCHEC / ANNULÉ ────────────────────────────────────────────────
  if (has(s,
    'echec', 'echoue', 'annule', 'annulee', 'annulation',
    'cancel', 'canceled', 'errone', 'erronee', 'non delivre', 'non livre'
  )) return 'echec';

  // ── ÉTAT → RETOURNÉ ──────────────────────────────────────────────────────
  if (has(s, 'retourne', 'en retour', 'retour expediteur', 'retour confirme', 'return')) return 'retourne';

  // ── ÉTAT → EN TRANSIT ────────────────────────────────────────────────────
  if (has(s,
    'expedie', 'expedier', 'shipped', 'en transit', 'transit',
    'arrive au hub', 'arrivee hub', 'hub', 'centre tri', 'centre de tri',
    'en acheminement', 'acheminement'
  )) return 'en_transit';

  // ── ÉTAT → EN LIVRAISON ──────────────────────────────────────────────────
  if (has(s,
    'en livr', 'en cours de livr', 'sorti', 'en distribution',
    'distribution', 'on delivery', 'out for delivery'
  )) return 'en_livraison';

  // ── ÉTAT → EN PRÉPARATION ────────────────────────────────────────────────
  if (has(s,
    'en preparation', 'preparation', 'prise en charge', 'pec',
    'en attente', 'attente', 'nouveau', 'new', 'pending',
    'recu', 'enleve', 'collecte', 'ramassage'
  )) return 'en_preparation';

  return 'en_preparation';
}

// ── Classification spécifique aux colis DÉJÀ swappés ─────────────────────────
export type DeliveryBucket = 'delivered' | 'cancelled' | 'in_progress';

// Pour un colis swappé, on classe UNIQUEMENT sur l'état de livraison, JAMAIS sur
// la situation.
//
// Raison (vérifiée sur cas réel) : après un swap, le champ `situation` garde
// souvent la raison du PREMIER échec — celle qui a rendu le colis swappable, ex
// « Commune erronée », « Client absent ». Or l'état ("Sortie en livraison",
// "Livré", "Encaissé"…) reflète, lui, le NOUVEAU parcours de livraison vers le
// client cible. Se fier à la situation classerait à tort un colis en cours de
// livraison comme « annulé » (bug observé : taux de livraison 1.5% au lieu du réel).
//
// États de succès ZRExpress : Livré → Encaissé → Recouvert (les 3 = client servi).
// États d'échec :
//   - recupere_par_fournisseur : le colis est REVENU chez le marchand = annulé.
//     (vérifié sur données réelles — situation associée « Commande annulée »
//      ou « Ne répond pas 3 ». L'état seul suffit à le classer comme annulé.)
//   - Retour / Annulé / Échec / Refus.
// Tout le reste (Confirmée, Vers wilaya, En livraison, Sortie en livraison,
// Transit, Préparation) = en cours.
export function classifySwappedDelivery(rawState: string): DeliveryBucket {
  const s = norm(rawState); // ex "recupere_par_fournisseur" → "recupere par fournisseur"
  const has = (...terms: string[]) => terms.some(t => s.includes(t));

  // Succès : encaissé / recouvert / payé, ou « livré » (mais pas « en livraison »,
  // « sortie en livraison », « non livré »).
  if (has('encaisse', 'recouvert', 'recouvre', 'paye', 'paid')) return 'delivered';
  if (has('livre') && !has('en livr', 'sorti', 'sortie', 'en cours', 'non')) return 'delivered';

  // Échec définitif : colis récupéré par le fournisseur, retour, annulé, échec, refus.
  if (has('recupere par fournisseur', 'fournisseur', 'retour', 'annul', 'echec', 'echoue', 'refus', 'return')) return 'cancelled';

  // Sinon : encore en cours de livraison.
  return 'in_progress';
}
