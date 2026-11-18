import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'apps/web/e2e/local-friends',
  outputDir: 'test-results/local-friends',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:5194',
    viewport: { width: 390, height: 844 },
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'node apps/web/node_modules/vite/bin/vite.js apps/web --mode screens --host 127.0.0.1 --port 5194 --strictPort',
    url: 'http://127.0.0.1:5194',
    reuseExistingServer: false,
  },
});
