// P2-9 phase 3 — migration des secrets stockés (chiffrement) et retour arrière.
//
//   ⚠️  EXÉCUTION MANUELLE UNIQUEMENT. Jamais depuis le code applicatif, jamais
//       en CI, jamais pendant le gel (refus intégré jusqu'au 2026-09-26T22:15Z).
//
// Variables d'environnement : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SECRETS_KEYRING. ⚠️ vite-node charge AUTOMATIQUEMENT .env / .env.local : c'est
// pourquoi --target=<ref du projet> est exigé avant TOUT accès base (même en
// simulation) et doit correspondre à l'hôte de NEXT_PUBLIC_SUPABASE_URL.
//
// Simulation (défaut, aucune écriture) :
//   npx vite-node --config vitest.config.ts scripts/secrets-backfill.ts -- --target=<ref> --mode=encrypt
// Réel (après relecture de la simulation, sauvegarde faite, sur GO) :
//   … -- --target=<ref> --mode=encrypt --apply --backup-confirmed --confirm=<planned de la simulation>
// Retour arrière (chiffré → clair, avec le même trousseau) :
//   … -- --target=<ref> --mode=decrypt [--apply --backup-confirmed --confirm=<N>]
//
// Sortie : rapport JSON de COMPTES uniquement (aucune valeur, claire ou chiffrée).
// Codes : 0 ok · 1 arguments · 2 refus de sécurité · 3 incohérence après écriture.

import { createClient } from '@supabase/supabase-js';
import { checkTarget, executeBackfill } from '@/lib/security/secret-backfill';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      JSON.stringify({
        error: 'NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis',
        present: { url: !!url, service_role: !!serviceKey, keyring: !!process.env.SECRETS_KEYRING },
      })
    );
    process.exit(1);
  }
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  // Aucun accès base sans cible explicite (voir en-tête).
  const targetError = checkTarget(url, argv);
  if (targetError) {
    console.error(JSON.stringify({ error: targetError }));
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const result = await executeBackfill(argv, process.env, supabase as never);
  console.log(JSON.stringify(result.output, null, 2));
  process.exit(result.exitCode);
}

main().catch(() => {
  // Jamais le message brut : il pourrait contenir une URL ou une valeur.
  console.error(JSON.stringify({ error: 'échec inattendu (détails volontairement omis)' }));
  process.exit(1);
});
