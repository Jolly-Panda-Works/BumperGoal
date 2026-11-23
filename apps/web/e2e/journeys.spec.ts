import { boardToPage } from './board3d';
import { expect, test, type Page } from '@playwright/test';

// Local journeys from the master plan that do not need the Nakama server:
// 1 start, 2 guest entry, 3 profile edit, 4 settings, 5 local match,
// 6 finish vs bot (via forfeit, full AI-vs-AI completion is a unit test), 13 persistence.

const SHOTS = 'test-results/screens';

async function enterAsGuest(page: Page, name = 'E2E Player') {
  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByLabel('Your player name').fill(name);
  await page.getByRole('button', { name: 'Start playing' }).click();
  await expect(page).toHaveURL(/\/tutorial$/);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

interface BodyState {
  kind: string;
  x: number;
  y: number;
}

async function matchState(page: Page) {
  return page.evaluate(() => {
    const hook = (window as unknown as { __fkMatch: { state: () => unknown; canAim: () => boolean } }).__fkMatch;
    return {
      state: hook.state() as {
        bodies: BodyState[];
        turn: { side: string; index: number };
        phase: string;
        score: { L: number; R: number };
      },
      canAim: hook.canAim(),
    };
  });
}

test('first run, guest entry and home navigation', async ({ page }) => {
  await enterAsGuest(page);
  await expect(page.getByRole('link', { name: 'Play vs AI', exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/home-desktop.png` });

  for (const [label, heading] of [
    ['Shop', 'Shop'],
    ['Ranks', 'Leaderboard'],
    ['Profile', 'Profile'],
  ]) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText("This page doesn't exist.")).toHaveCount(0);
  }
});

test('profile edit persists across reload', async ({ page }) => {
  await enterAsGuest(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Edit player name' }).click();
  await page.getByLabel('Player name', { exact: true }).fill('Renamed 1');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Renamed 1', exact: true })).toBeVisible();
  await expect(page.locator('.profile-chip__name')).toHaveText('Renamed 1');
});

test('settings: Persian switches to RTL and persists', async ({ page }) => {
  await enterAsGuest(page);
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'فارسی' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'تنظیمات' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await page.goto('/home');
  await page.screenshot({ path: `${SHOTS}/home-fa-rtl.png` });
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  await page.getByRole('switch', { name: 'Mute all' }).click();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Mute all' })).toHaveAttribute('aria-checked', 'true');
});

test('local match vs AI: real drag shot, bot replies, leave, result and history', async ({ page }) => {
  await enterAsGuest(page);
  await page.getByRole('link', { name: /Play vs AI/ }).click();
  await page.getByRole('button', { name: 'Kick off' }).click();
  await expect(page).toHaveURL(/\/match$/);
  await expect(page.locator('[data-testid=game-host] canvas')).toHaveCount(1);
  await expect(page.getByText('BOT').first()).toBeVisible();

  // Play until it is our turn (the bot may have won the coin toss), then shoot.
  await expect.poll(async () => (await matchState(page)).canAim, { timeout: 30_000 }).toBe(true);
  const before = await matchState(page);
  const ball = before.state.bodies.at(-1)!;
  // Pick our disc (L: indices 0..4) closest to the ball and drag away from the ball.
  const discs = before.state.bodies.slice(0, 5).map((b, i) => ({ ...b, i, d: Math.hypot(b.x - ball.x, b.y - ball.y) }));
  const disc = discs.sort((a, b) => a.d - b.d)[0]!;
  const from = await boardToPage(page, disc.x, disc.y);
  const dir = { x: (ball.x - disc.x) / disc.d, y: (ball.y - disc.y) / disc.d };
  const to = await boardToPage(page, disc.x - dir.x * 2.2, disc.y - dir.y * 2.2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.screenshot({ path: `${SHOTS}/match-aiming.png` });
  await page.mouse.up();

  // The shot is simulated and the turn passes to the bot, which then shoots back.
  await expect
    .poll(async () => (await matchState(page)).state.turn.index, { timeout: 20_000 })
    .toBeGreaterThan(before.state.turn.index);
  // The shot was simulated and applied: either the disc moved, or a goal reset the board.
  const after = (await matchState(page)).state;
  const moved = after.bodies[disc.i]!;
  const scored = after.score.L + after.score.R > before.state.score.L + before.state.score.R;
  expect(after.shotCount).toBe(before.state.shotCount + 1);
  expect(scored || Math.hypot(moved.x - disc.x, moved.y - disc.y) > 0.1).toBe(true);
  await expect
    .poll(async () => (await matchState(page)).state.turn.index, { timeout: 30_000 })
    .toBeGreaterThan(before.state.turn.index + 1);
  await page.screenshot({ path: `${SHOTS}/match-after-bot.png` });

  // Leave: counts as a loss, goes to the result screen, recorded in local history.
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Leave match' }).click();
  await page.getByRole('dialog', { name: 'Leave this match?' }).getByRole('button', { name: 'Leave match' }).click();
  await expect(page).toHaveURL(/\/result$/, { timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
  await expect(page.getByText('You left the match')).toBeVisible();
  await expect(page.getByText('No coins or XP were awarded')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/result.png` });
  await page.goto('/profile/history');
  // With the server running, history opens on the Online tab; this was a practice match.
  const practiceTab = page.getByRole('tab', { name: 'Practice' });
  const openPractice = async () => {
    const online = await page
      .locator('.server-dot--online')
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (online) await practiceTab.click();
  };
  await openPractice();
  await expect(page.locator('.history-item')).toHaveCount(1);
  await expect(page.locator('.history-item').getByText('BOT', { exact: true })).toBeVisible();
  await page.reload();
  await openPractice();
  await expect(page.locator('.history-item')).toHaveCount(1);
});

test('online features state truthfully whether the server or the feature is missing', async ({ page }) => {
  await enterAsGuest(page);
  await page.goto('/play/online');
  await expect(page.locator('.server-dot--connecting')).toHaveCount(0, { timeout: 15_000 });
  // Connected: live "Find match" buttons; not connected: an explicit notice.
  await expect(
    page.getByText('Online services not connected').or(page.getByRole('button', { name: 'Find match' }).first()),
  ).toBeVisible();
  for (const path of ['/shop', '/leaderboard', '/rewards', '/wallet']) {
    await page.goto(path);
    await expect(
      page.getByText(/Online services not connected|Server connected: feature in progress/).first(),
    ).toBeVisible();
  }
});

test('mobile layout @mobile', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/');
  await expect(page.locator('.orientation-screen')).toBeVisible();
  await expect(page.locator('.welcome')).toBeHidden();
  await page.setViewportSize({ width: 852, height: 393 });
  await expect(page.locator('.orientation-screen')).toBeHidden();
  await expect(page.locator('.welcome')).toBeVisible();
  await enterAsGuest(page);
  await page.screenshot({ path: `${SHOTS}/home-mobile.png` });
  await page.getByRole('link', { name: /Play vs AI/ }).click();
  await page.getByRole('button', { name: 'Kick off' }).click();
  await expect(page.locator('[data-testid=game-host] canvas')).toHaveCount(1);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/match-mobile.png` });
});
