import { defineConfig } from 'vitest/config'

/**
 * Tests unitaires de la logique pure du mobile (lib, hooks) — environnement
 * node, modules natifs (expo-router, MMKV) mockés dans les tests. L'UI RN
 * n'est pas rendue ici : elle se valide sur device (expo run:android).
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
