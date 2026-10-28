// Statut AFFICHÉ d'une session chatbot dans le tableau de bord.
//
// Deux colonnes, deux sens — à ne pas confondre :
//   - is_complete : le DERNIER tour contenait un bloc <data> complet. Il repasse
//     à false dès le message suivant sans <data> (« merci », « sahha »…).
//   - sheets_sent : une commande / réclamation VALIDÉE a été prise en charge
//     (Google Sheets et/ou notification admin). Pris une seule fois, jamais
//     remis à false. Ce n'est NI « livrée » NI « encaissée ».
//
// AVANT : le badge ne lisait que is_complete → « … En cours » + « Sheets ✓ » sur
// la même ligne après un simple « merci ». Ici : sheets_sent prime pour
// l'AFFICHAGE uniquement. Aucune donnée, aucun filtre, aucun compteur modifié.

export type SessionDisplayStatus = 'transmitted' | 'complete' | 'in_progress';

export interface SessionStatusInput {
  is_complete?: boolean | null;
  sheets_sent?: boolean | null;
  template_type?: string | null;
}

export function sessionDisplayStatus(s: SessionStatusInput): SessionDisplayStatus {
  if (s.sheets_sent === true) return 'transmitted';
  return s.is_complete === true ? 'complete' : 'in_progress';
}

/**
 * « Données complètes » au sens des FILTRES et COMPTEURS : le dernier tour était
 * complet, OU une commande / réclamation a déjà été transmise. Sans cela, un
 * simple « merci » après transmission sortait la ligne de « complètes
 * uniquement » — et une réclamation SAV disparaissait de la vue par défaut de
 * l'opérateur. Seul true strict compte.
 */
export function hasCompleteData(s: SessionStatusInput): boolean {
  return s.is_complete === true || s.sheets_sent === true;
}

/** Libellé court ; « transmise » s'accorde avec l'objet (réclamation pour le SAV). */
export function sessionStatusLabel(s: SessionStatusInput): string {
  switch (sessionDisplayStatus(s)) {
    case 'transmitted':
      return s.template_type === 'sav' ? 'Réclamation transmise' : 'Commande transmise';
    case 'complete':
      return 'Complet';
    default:
      return 'En cours';
  }
}
