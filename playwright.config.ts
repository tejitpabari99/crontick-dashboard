import { defineConfig } from '@playwright/test';

// Browser smoke (03 U12). Needs the built UI: `npm run build:ui` (test:smoke does it first).
export default defineConfig({
  testDir: 'tests/smoke',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { browserName: 'chromium' },
});
