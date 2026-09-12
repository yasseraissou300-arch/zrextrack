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
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
