// Tests d'intégration contre la VRAIE base Supabase (schéma autotim, service_role).
//
// Jamais lancés par `npm test`. Lancer explicitement : npm run test:integration
// Prérequis : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env.local
// (ou dans l'environnement). Sans la clé, les tests sont ignorés proprement.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    reporters: 'verbose',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Séquentiel : les tests partagent la même table réelle.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
