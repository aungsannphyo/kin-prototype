/**
 * Vite configuration — Kin browser playground
 *
 * This config drives the browser playground only (playground/).
 * It does NOT affect the framework build (tsconfig.build.json / npm run build).
 *
 * Alias: 'kin-prototype' → './src/index.ts'
 *   Vite resolves all relative imports inside src/ through the bundler,
 *   so '.js' extension specifiers in the source are handled transparently.
 */

import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  // Playground directory is the Vite root — index.html lives here
  root: resolve(__dirname, 'playground'),

  resolve: {
    alias: {
      // Point the package name to the TypeScript source so Vite compiles
      // the framework alongside the application. No pre-build required.
      'kin-prototype': resolve(__dirname, 'src/index.ts'),
    },
  },

  build: {
    // Output next to the project root, not inside playground/
    outDir: resolve(__dirname, 'playground-dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'playground/index.html'),
        todo: resolve(__dirname, 'playground/todo.html'),
        accountSharing: resolve(__dirname, 'playground/account-sharing.html'),
      },
    },
  },

  // Keep source maps available in dev
  esbuild: {
    sourcemap: true,
  },
})
