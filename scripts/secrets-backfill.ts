// P2-9 phase 3 — migration des secrets stockés (chiffrement) et retour arrière.
//
//   ⚠️  EXÉCUTION MANUELLE UNIQUEMENT. Jamais depuis le code applicatif, jamais
//       en CI, jamais pendant le gel (refus intégré jusqu'au 2026-09-26T22:15Z).
//
// Variables d'environnement : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SECRETS_KEYRING. ⚠️ vite-node charge AUTOMATIQUEMENT .env / .env.local : c'est
// pourquoi --target=<ref du projet> est exigé avant TOUT accès base (même en
// simulation) : src/lib/security/script-guard.ts vérifie l'URL, l'alias
// SUPABASE_URL et la clé réellement chargés, et refuse AVANT toute connexion.
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
import { executeBackfill } from '@/lib/security/secret-backfill';
import { withGuardedClient } from '@/lib/security/script-guard';

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const outcome = await withGuardedClient(
    argv,
    process.env,
    (url, serviceKey) => createClient(url, serviceKey, { auth: { persistSession: false } }),
    (supabase) => executeBackfill(argv, process.env, supabase as never)
  );
  if (!outcome.ok) {
    // Refus AVANT connexion. Le rapport ne contient que l'hôte et des booléens.
    console.error(
      JSON.stringify({ error: outcome.error, code: outcome.code, env: outcome.report })
    );
    process.exit(2);
  }
  console.log(JSON.stringify(outcome.value.output, null, 2));
  process.exit(outcome.value.exitCode);
}

main().catch(() => {
  // Jamais le message brut : il pourrait contenir une URL ou une valeur.
  console.error(JSON.stringify({ error: 'échec inattendu (détails volontairement omis)' }));
  process.exit(1);
});
