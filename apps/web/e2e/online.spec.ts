import { expect, test } from '@playwright/test';

// Real integration test against the local Nakama stack (server/deploy).
// Skipped, not faked, when the server is not running.
const NAKAMA = 'http://127.0.0.1:7350/healthcheck';

test.beforeEach(async ({ request }) => {
  const up = await request
    .get(NAKAMA, { timeout: 3000 })
    .then((r) => r.ok())
    .catch(() => false);
  test.skip(!up, 'Nakama is not running (docker compose -f server/deploy/docker-compose.yml up)');
});

test('guest connects to Nakama, sees the server wallet and saves a server-validated name', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your player name').fill('Online Tester');
  await page.getByRole('button', { name: 'Start playing' }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();

  // Starting balance granted once by the server (economy.json: 500 coins, 10 gems).
  await expect(page.locator('.server-dot--online')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.topbar__wallet .currency-pill').first()).toHaveText('500');
  await expect(page.locator('.topbar__wallet .currency-pill').nth(1)).toHaveText('10');

  await page.goto('/profile');
  await expect(page.getByText('Level 1', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Secure your account' })).toBeVisible();

  // The server rejects invalid names even if the client check is bypassed.
  const rejected = await page.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem('flickkick.session.v1')!) as { token: string };
    const r = await fetch('http://127.0.0.1:7350/v2/rpc/profile_update', {
      method: 'POST',
      headers: { Authorization: `Bearer ${saved.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify({ displayName: '<x>' })),
    });
    return r.status;
  });
  expect(rejected).toBe(400);

  await page.getByRole('button', { name: 'Edit player name' }).click();
  await page.getByLabel('Player name', { exact: true }).fill('Server Named');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // Restart: the session is restored and the server profile comes back, wallet unchanged.
  await page.reload();
  await expect(page.locator('.server-dot--online')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Server Named', exact: true })).toBeVisible();
  await expect(page.locator('.topbar__wallet .currency-pill').first()).toHaveText('500');

  // Server-validated equip of a free team.
  await page.goto('/locker');
  await page.locator('.item', { hasText: 'Coral' }).getByRole('button', { name: 'Equip' }).click();
  await expect(page.locator('.item.is-equipped', { hasText: 'Coral' })).toBeVisible();
});
