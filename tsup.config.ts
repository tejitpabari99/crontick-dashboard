import { defineConfig } from 'tsup';

const shebang = { js: '#!/usr/bin/env node' };

const common = {
  format: ['esm'] as const,
  target: 'node22',
  platform: 'node' as const,
  splitting: false,
  sourcemap: false,
  // Runtime deps stay external (installed from package.json); the contract (src/contract) is bundled.
  external: ['node-notifier'],
};

// One config array so `clean` runs once; the UI is copied in afterwards (it is built by vite beforehand).
export default defineConfig([
  {
    ...common,
    format: ['esm'],
    entry: { 'cli/main': 'src/cli/main.ts', 'server/index': 'src/server/index.ts' },
    banner: shebang,
    clean: true,
    onSuccess: 'node scripts/copy-ui.mjs',
  },
  {
    // Bin guard: ./main.js must stay a dynamic import (external) so nothing heavy loads before the Node-version check.
    ...common,
    format: ['esm'],
    entry: { 'cli/index': 'src/cli/index.ts' },
    external: [...common.external, './main.js'],
    banner: shebang,
    clean: false,
  },
  {
    ...common,
    format: ['esm'],
    entry: { index: 'src/index.ts' },
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    clean: false,
  },
]);
