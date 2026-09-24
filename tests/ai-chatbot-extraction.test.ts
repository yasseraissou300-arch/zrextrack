// Chatbot WhatsApp — la sortie du modèle n'est pas une donnée fiable.

import { describe, it, expect } from 'vitest';
import { isAngerDetected, isBlabla } from '@/lib/ai-chatbot/classifiers';
import {
  normalizeDzMobile,
  canonicalWilaya,
  sanitizeExtracted,
  isExtractionComplete,
  correctionReply,
  sheetSafe,
  toSheetRow,
} from '@/lib/ai-chatbot/extraction';

describe('détection de colère — mots entiers', () => {
  it.each([
    ['bghit wahda', 'wahd ⊂ wahda'],
    ["c'est facile", 'faci ⊂ facile'],
    ['nqder ndir fiha commande', 'ndir fi ⊂ ndir fiha'],
    ['7ramdoulillah', '7ram ⊂ 7ramdoulillah'],
  ])('« %s » ne bascule plus en humain (%s)', (text) => {
    expect(isAngerDetected(text)).toBe(false);
  });

  it.each(['arnaque !!', 'hadi scam', 'nta khayb', 'Merde', 'rani angry', 'ndir plainte'])(
    '« %s » est toujours détecté',
    (text) => {
      expect(isAngerDetected(text)).toBe(true);
    }
  );
});

describe('blabla', () => {
  it('reconnaît les réponses courtes (le webhook ne l’applique qu’au premier contact)', () => {
    // Ce sont exactement des réponses aux questions du bot : d'où la restriction
    // au premier message dans le webhook.
    for (const t of ['wah', '2', '16', 'oui']) expect(isBlabla(t)).toBe(true);
  });
});

describe('téléphone algérien', () => {
  it.each([
    ['0550123456', '0550123456'],
    ['05 50 12 34 56', '0550123456'],
    ['+213 550 12 34 56', '0550123456'],
    ['00213661234567', '0661234567'],
    ['213771234567', '0771234567'],
  ])('%s → %s', (raw, out) => expect(normalizeDzMobile(raw)).toBe(out));

  it.each(['0450123456', '055012345', '05501234567', '0123456789', 'appelle-moi', ''])(
    '%s est refusé',
    (raw) => expect(normalizeDzMobile(raw)).toBeNull()
  );
});

describe('wilaya', () => {
  it('normalise les variantes vers le nom officiel', () => {
    expect(canonicalWilaya('qsentina')).toBe('Constantine');
    expect(canonicalWilaya('Wahran')).toBe('Oran');
    expect(canonicalWilaya('Béjaïa')).toBe('Béjaïa');
  });
  it('refuse une wilaya inconnue (l’ancien code la gardait telle quelle)', () => {
    expect(canonicalWilaya('Casablanca')).toBeNull();
    expect(canonicalWilaya('...')).toBeNull();
  });
});

describe('assainissement du bloc <data>', () => {
  it('retire les champs critiques invalides et le signale', () => {
    const r = sanitizeExtracted({ nom: 'Amine', telephone: '12345', wilaya: 'Mars' });
    expect(r.data).toEqual({ nom: 'Amine' });
    expect(r.invalid.sort()).toEqual(['telephone', 'wilaya']);
  });

  it('ignore les placeholders recopiés du prompt, les objets et les clés exotiques', () => {
    const r = sanitizeExtracted({
      nom: '...',
      produit: { x: 1 },
      'clé bizarre': 'x',
      __proto__x: 'y',
      quantite: 2,
    });
    expect(r.data).toEqual({ quantite: '2' });
  });

  it('borne la longueur des valeurs', () => {
    const r = sanitizeExtracted({ produit: 'x'.repeat(5000) });
    expect(r.data.produit).toHaveLength(300);
  });

  it('rejette une entrée qui n’est pas un objet', () => {
    expect(sanitizeExtracted(null).data).toEqual({});
    expect(sanitizeExtracted(['a']).data).toEqual({});
  });
});

describe('complétude', () => {
  const ok = { nom: 'Amine B', telephone: '0550123456', wilaya: 'Oran', produit: 'Montre' };

  it('commande : les 4 champs valides → complète', () => {
    const current = sanitizeExtracted(ok);
    expect(
      isExtractionComplete({
        templateType: 'auto_confirmation',
        customPrompt: false,
        current,
        merged: current.data,
      })
    ).toBe(true);
  });

  it('commande : 3 clés quelconques ne suffisent plus (ancienne règle ≥ 3)', () => {
    const current = sanitizeExtracted({ nom: 'A', produit: 'B', couleur: 'rouge' });
    expect(
      isExtractionComplete({
        templateType: 'auto_confirmation',
        customPrompt: false,
        current,
        merged: current.data,
      })
    ).toBe(false);
  });

  it('commande : téléphone invalide → jamais complète, même avec 4 clés', () => {
    const current = sanitizeExtracted({ ...ok, telephone: '99' });
    expect(
      isExtractionComplete({
        templateType: 'auto_confirmation',
        customPrompt: false,
        current,
        merged: { ...current.data },
      })
    ).toBe(false);
  });

  it('SAV : réclamation + commande → complète (avant : 2 clés < 3, jamais notifiée)', () => {
    const current = sanitizeExtracted({ reclamation: 'produit cassé', commande: 'ZR123' });
    expect(
      isExtractionComplete({
        templateType: 'sav',
        customPrompt: false,
        current,
        merged: current.data,
      })
    ).toBe(true);
  });

  it('suivi : jamais poussé dans le Sheet', () => {
    const current = sanitizeExtracted({ tracking_number: 'ZR123' });
    expect(
      isExtractionComplete({
        templateType: 'tracking',
        customPrompt: false,
        current,
        merged: current.data,
      })
    ).toBe(false);
  });

  it('prompt personnalisé : règle historique ≥ 3 clés conservée', () => {
    const current = sanitizeExtracted({ name: 'A', phone_client: 'x', ville: 'y' });
    expect(
      isExtractionComplete({
        templateType: 'auto_confirmation',
        customPrompt: true,
        current,
        merged: current.data,
      })
    ).toBe(true);
  });

  it('les champs validés d’un message précédent complètent la commande', () => {
    const merged = sanitizeExtracted({ ...ok }).data;
    const current = sanitizeExtracted({ produit: 'Montre' });
    expect(
      isExtractionComplete({
        templateType: 'auto_confirmation',
        customPrompt: false,
        current,
        merged,
      })
    ).toBe(true);
  });
});

describe('réponse de correction', () => {
  it('téléphone invalide → redemande le numéro au lieu de « commande enregistrée »', () => {
    const current = sanitizeExtracted({ nom: 'A', telephone: '123', wilaya: 'Oran', produit: 'B' });
    const msg = correctionReply({
      templateType: 'auto_confirmation',
      customPrompt: false,
      current,
      merged: current.data,
    });
    expect(msg).toMatch(/05, 06 wella 07/);
  });

  it('champ manquant → le nomme', () => {
    const current = sanitizeExtracted({ nom: 'A', telephone: '0550123456', wilaya: 'Oran' });
    const msg = correctionReply({
      templateType: 'auto_confirmation',
      customPrompt: false,
      current,
      merged: current.data,
    });
    expect(msg).toMatch(/l-produit/);
  });

  it('suivi : le bloc attendu n’est jamais « corrigé »', () => {
    const current = sanitizeExtracted({ tracking_number: 'ZR1' });
    expect(
      correctionReply({
        templateType: 'tracking',
        customPrompt: false,
        current,
        merged: current.data,
      })
    ).toBeNull();
  });
});

describe('Google Sheets — injection de formule', () => {
  it.each(['=IMPORTXML("http://x","//a")', '+33 1', '-1', '@SUM(A1)'])(
    '« %s » est neutralisé',
    (v) => expect(sheetSafe(v).startsWith("'")).toBe(true)
  );
  it('les valeurs normales sont intactes', () => {
    expect(toSheetRow({ nom: 'Amine', telephone: '0550123456' })).toEqual({
      nom: 'Amine',
      telephone: '0550123456',
    });
  });
});
