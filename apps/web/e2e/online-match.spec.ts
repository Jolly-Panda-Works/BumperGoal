import { expect, test, type Browser, type Page } from '@playwright/test';

// Real online journeys against the local Nakama stack (skipped when it is down).
test.beforeEach(async ({ request }) => {
  const up = await request
    .get('http://127.0.0.1:7350/healthcheck', { timeout: 3000 })
    .then((r) => r.ok())
    .catch(() => false);
  test.skip(!up, 'Nakama is not running');
});

interface Hook {
  state: () => {
    bodies: { x: number; y: number }[];
    turn: { side: string; index: number; seq: number };
    stateHash: string;
    phase: string;
    discsPerTeam: number;
  };
  canAim: () => boolean;
}

async function guest(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Your player name').fill(name);
  await page.getByRole('button', { name: 'Start playing' }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await expect(page.locator('.server-dot--online')).toBeVisible({ timeout: 15_000 });
}

async function findMatch(page: Page) {
  await page.getByRole('link', { name: /Play online/ }).click();
  await page.locator('.arena', { hasText: 'Park Pitch' }).getByRole('button', { name: 'Find match' }).click();
  await expect(page).toHaveURL(/\/play\/online\/search\?arena=park/);
}

const hook = (page: Page) => page.evaluate(() => (window as unknown as { __fkMatch: Hook }).__fkMatch.state());
const canAim = (page: Page) => page.evaluate(() => (window as unknown as { __fkMatch: Hook }).__fkMatch.canAim());

/** Real pointer drag on one of my discs, pulling away from the ball. */
async function shoot(page: Page) {
  const s = await hook(page);
  const mine = s.turn.side === 'L' ? 0 : s.discsPerTeam;
  const ball = s.bodies.at(-1)!;
  const discs = s.bodies.slice(mine, mine + s.discsPerTeam).map((b, i) => ({ ...b, i: mine + i }));
  const disc = discs.sort(
    (a, b) => Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(b.x - ball.x, b.y - ball.y),
  )[0]!;
  const box = (await page.locator('[data-testid=game-host] canvas').boundingBox())!;
  const k = box.width / 720;
  const direction = s.turn.side === 'L' ? -1 : 1;
  const px = (x: number, y: number) => ({
    x: box.x + (360 + direction * y * 66) * k,
    y: box.y + (640 + direction * x * 66) * k,
  });
  const d = Math.hypot(ball.x - disc.x, ball.y - disc.y);
  const from = px(disc.x, disc.y);
  const to = px(disc.x - ((ball.x - disc.x) / d) * 2, disc.y - ((ball.y - disc.y) / d) * 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

test('no human available: server bot after 15 s, real shots, server rewards and online history', async ({ page }) => {
  test.setTimeout(120_000);
  await guest(page, 'Bot Seeker');
  await findMatch(page);
  await expect(page.getByText('Searching for a player…')).toBeVisible();
  await expect(page.getByText("No player found: you'll play against FlickBot")).toBeVisible({ timeout: 25_000 });
  await expect(page).toHaveURL(/\/match$/, { timeout: 10_000 });
  await expect(page.locator('[data-testid=game-host] canvas')).toHaveCount(1);
  await expect(page.locator('.hud').getByText('BOT', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/online-bot-match.png' });

  // If it's our turn, shoot; then the bot must reply through the server.
  const start = await hook(page);
  if (start.turn.side === 'L') {
    await expect.poll(() => canAim(page), { timeout: 10_000 }).toBe(true);
    await shoot(page);
    await expect.poll(async () => (await hook(page)).turn.index, { timeout: 20_000 }).toBeGreaterThan(start.turn.index);
  }
  const afterMine = (await hook(page)).turn.index;
  await expect.poll(async () => (await hook(page)).turn.index, { timeout: 40_000 }).toBeGreaterThan(afterMine);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Online matches keep running while this menu is open.')).toBeVisible();
  await page.getByRole('button', { name: 'Leave match' }).click();
  await page.getByRole('dialog', { name: 'Leave this match?' }).getByRole('button', { name: 'Leave match' }).click();
  await expect(page).toHaveURL(/\/result$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rewards' })).toBeVisible();
  await expect(page.getByText('+30')).toBeVisible(); // loss XP from the server
  await page.screenshot({ path: 'test-results/screens/online-result.png' });

  await page.goto('/profile/history');
  await expect(page.locator('.history-item').first()).toContainText('FlickBot');
  await expect(page.locator('.history-item').first().getByText('BOT', { exact: true })).toBeVisible();
  // Wallet: 500 start − 50 entry, no prize.
  await expect(page.locator('.topbar__wallet .currency-pill').first()).toHaveText('450');
});

async function twoPlayers(browser: Browser) {
  const a = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const b = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  return [a, b] as const;
}

test('two humans: matched together, shots replay identically on both clients', async ({ browser }) => {
  test.setTimeout(120_000);
  const [a, b] = await twoPlayers(browser);
  await guest(a, 'Human Alpha');
  await guest(b, 'Human Beta');
  await findMatch(a);
  await findMatch(b);
  await expect(a.getByText('Opponent found!')).toBeVisible({ timeout: 12_000 });
  await expect(b.getByText('Opponent found!')).toBeVisible({ timeout: 12_000 });
  await expect(a).toHaveURL(/\/match$/, { timeout: 10_000 });
  await expect(b).toHaveURL(/\/match$/, { timeout: 10_000 });
  // The board appears once the authoritative state has arrived on both clients.
  await expect(a.locator('[data-testid=game-host] canvas')).toHaveCount(1, { timeout: 15_000 });
  await expect(b.locator('[data-testid=game-host] canvas')).toHaveCount(1, { timeout: 15_000 });
  await expect(a.locator('.hud').getByText('BOT', { exact: true })).toHaveCount(0);

  for (let shot = 0; shot < 2; shot++) {
    const s = await hook(a);
    // The turn opens a moment after the state arrives, so wait for either client.
    let mover: Page | null = null;
    await expect
      .poll(
        async () => {
          mover = (await canAim(a)) ? a : (await canAim(b)) ? b : null;
          return mover !== null;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await shoot(mover!);
    // Both clients converge on the same authoritative state after the playback.
    await expect.poll(async () => (await hook(a)).turn.index, { timeout: 20_000 }).toBeGreaterThan(s.turn.index);
    await expect.poll(async () => (await hook(b)).turn.index, { timeout: 20_000 }).toBeGreaterThan(s.turn.index);
    const [ha, hb] = [await hook(a), await hook(b)];
    expect(ha.stateHash).toBe(hb.stateHash);
    expect(ha.turn).toEqual(hb.turn);
  }
  await a.screenshot({ path: 'test-results/screens/online-human-a.png' });
  await b.screenshot({ path: 'test-results/screens/online-human-b.png' });
});
