import { expect, test, type ConsoleMessage } from '@playwright/test';

// Smoke test for a deployed stack (production bundle behind Caddy + Nakama).
// Run: E2E_BASE_URL=https://play.example.com npx playwright test --project=prod
// Proves the CSP allows everything the game needs: Rapier WebAssembly, the AI
// worker, fonts, and HTTPS/WSS to the API domain, with no console errors.

test('deployed build: guest login, local match, online bot match, no CSP violations', async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));

  await page.goto('/');
  await page.getByLabel('Your player name').fill('Prod Smoke');
  await page.getByRole('button', { name: 'Start playing' }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await expect(page.locator('.server-dot--online')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.topbar__wallet .currency-pill').first()).toHaveText('500');

  // Local match: Rapier wasm + Phaser + AI worker under the production CSP.
  await page.getByRole('link', { name: /Play vs AI/ }).click();
  await page.getByRole('button', { name: 'Kick off' }).click();
  await expect(page.locator('[data-testid=game-host] canvas')).toHaveCount(1);
  await expect(page.getByText(/Your turn|FlickBot is thinking/)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3000);
  await page.goto('/home');

  // Online: matchmaking over WSS, server bot fallback, authoritative match.
  await page.getByRole('link', { name: /Play online/ }).click();
  await page.locator('.arena', { hasText: 'Park Pitch' }).getByRole('button', { name: 'Find match' }).click();
  await expect(page.getByText("No player found: you'll play against FlickBot")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid=game-host] canvas')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.hud').getByText('BOT', { exact: true })).toBeVisible();
  await page.waitForTimeout(2000);

  const csp = problems.filter((p) => /Content Security Policy|Refused to/i.test(p));
  expect(csp, `CSP violations:\n${csp.join('\n')}`).toEqual([]);
  expect(problems, `console errors:\n${problems.join('\n')}`).toEqual([]);
});
