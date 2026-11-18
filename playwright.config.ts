import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL set → test an already deployed stack (production smoke, project "prod").
// Unset → build the e2e bundle and serve it locally (projects "desktop" and "mobile").
const deployed = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'apps/web/e2e',
  outputDir: 'test-results',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // The local preview server and the local Nakama are shared by every worker; keep load predictable.
  workers: 3,
  reporter: [['list']],
  use: {
    baseURL: deployed ?? 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    // Local HTTPS test stacks use Caddy's internal CA.
    ignoreHTTPSErrors: !!deployed,
  },
  projects: deployed
    ? [
        {
          name: 'prod',
          use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
          testMatch: /prod\/.*\.spec\.ts/,
        },
      ]
    : [
        {
          name: 'desktop',
          use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
          grepInvert: /@mobile/,
          testIgnore: /prod\/|local-friends\//,
        },
        { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/, testIgnore: /prod\// },
      ],
  // Local runs use the production bundle (built in "e2e" mode, which only adds
  // the read-only window.__fkMatch hook), not the dev server.
  webServer: deployed
    ? undefined
    : {
        command: 'pnpm --filter @flickkick/web build:e2e && pnpm --filter @flickkick/web preview:e2e',
        url: 'http://localhost:4173',
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
