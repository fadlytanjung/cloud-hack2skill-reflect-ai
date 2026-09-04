import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vitest/config';

/**
 * Node is the default environment: most of the suite is pure logic and the
 * Express integration tests. React component tests opt into jsdom with a
 * `// @vitest-environment jsdom` docblock at the top of the file.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  // Point Vite's dotenv loading at a directory with no .env files, so a
  // developer's real credentials never bleed into a test run.
  envDir: path.resolve(__dirname, 'test/fixtures/env'),
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    // Deterministic client config for tests that read import.meta.env. Every
    // VITE_ var firebaseConfig consults is pinned here, so the suite asserts
    // fixed values rather than whatever the local .env happens to hold.
    env: {
      VITE_FIREBASE_PROJECT_ID: 'reflect-ai-test',
      VITE_FIREBASE_API_KEY: 'test-api-key',
      VITE_FIREBASE_APP_ID: '1:000000000000:web:testappid',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
      VITE_FIREBASE_DATABASE_ID: 'reflect-ai-app',
      VITE_FIREBASE_AUTH_DOMAIN: '',
      VITE_FIREBASE_STORAGE_BUCKET: '',
      VITE_FIREBASE_MEASUREMENT_ID: '',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/types.ts',
        'src/server/devServer.ts',
      ],
      thresholds: {
        // A floor just under the current numbers (98 lines / 97 statements /
        // 95 functions / 88 branches). Ratchet these up as coverage grows;
        // never lower one to make a run pass.
        lines: 95,
        functions: 92,
        branches: 85,
        statements: 95,
      },
    },
  },
});
