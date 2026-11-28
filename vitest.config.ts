import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Les tests contre la VRAIE base (service_role) ne tournent que sur demande :
    // npm run test:integration
    exclude: ['**/node_modules/**', 'tests/integration/**'],
    reporters: 'verbose',
    // Heures calmes WhatsApp (21:00-08:00) désactivées : les tests d'envoi ne
    // doivent pas dépendre de l'heure à laquelle ils tournent. Testées à part.
    env: { WHATSAPP_QUIET_HOURS: 'off' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
