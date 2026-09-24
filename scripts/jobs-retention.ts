// P2-8 — rétention de autotim.jobs (politique : src/lib/queue/retention.ts).
//
//   ⚠️  EXÉCUTION MANUELLE UNIQUEMENT. Jamais depuis le code applicatif, jamais
//       en CI, jamais pendant le gel (refus intégré jusqu'au 2026-09-26T22:15Z).
//       Le mode réel exige en outre le privilège DELETE, que service_role n'a
//       PAS (002b) : sans décision post-gel, il s'arrête proprement (code 2).
//
// ⚠️ vite-node charge AUTOMATIQUEMENT .env / .env.local. --target=<ref> est donc
// exigé avant TOUT accès base, simulation comprise ; script-guard vérifie l'URL,
// l'alias SUPABASE_URL et la clé réellement chargés, et refuse AVANT connexion.
//
// Simulation (défaut, lecture seule) :
//   npx vite-node --config vitest.config.ts scripts/jobs-retention.ts -- --target=<ref>
// Réel (après le gel, sauvegarde faite, sur GO) :
//   … -- --target=<ref> --apply --backup-confirmed --confirm=<plannedDeletes de la simulation>
//
// Sortie : comptes par type / statut / décision. Aucun id, aucune clé, aucun payload.
// Codes : 0 ok · 1 arguments ou lecture · 2 refus de sécurité · 3 incohérence après écriture.

import { createClient } from '@supabase/supabase-js';
import { executeRetention } from '@/lib/queue/retention';
import { withGuardedClient } from '@/lib/security/script-guard';

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const outcome = await withGuardedClient(
    argv,
    process.env,
    (url, serviceKey) => createClient(url, serviceKey, { auth: { persistSession: false } }),
    (supabase) => executeRetention(argv, supabase as never)
  );
  if (!outcome.ok) {
    // Refus AVANT connexion. Le rapport ne contient que l'hôte et des booléens.
    console.error(
      JSON.stringify({ error: outcome.error, code: outcome.code, env: outcome.report })
    );
    process.exit(2);
  }
  console.info(JSON.stringify(outcome.value.output, null, 2));
  process.exit(outcome.value.exitCode);
}

main().catch(() => {
  // Jamais le message brut : il pourrait contenir une URL ou une valeur.
  console.error(JSON.stringify({ error: 'échec inattendu (détails volontairement omis)' }));
  process.exit(1);
});
