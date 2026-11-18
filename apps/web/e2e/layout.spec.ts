import { boardToPage } from './board3d';
import { expect, test, type Page } from '@playwright/test';

// Regression: the HUD/board must not move when the turn (and the turn timer)
// switches between players.

async function startAIMatch(page: Page) {
  await page.goto('/');
  await page.getByLabel('Your player name').fill('Layout Tester');
  await page.getByRole('button', { name: 'Start playing' }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await page.getByRole('link', { name: /Play vs AI/ }).click();
  await page.getByRole('button', { name: 'Kick off' }).click();
  await expect(page.locator('[data-testid=game-host] canvas')).toHaveCount(1);
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',') : 'none';
    };
    const hook = (window as unknown as { __fkMatch: { canAim: () => boolean } }).__fkMatch;
    return {
      canAim: hook.canAim(),
      canvas: box('[data-testid=game-host] canvas'),
      hud: box('.hud'),
      left: box('.hud-player:not(.hud-player--right)'),
      right: box('.hud-player--right'),
      score: box('.hud__score'),
    };
  });
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'phone portrait', width: 393, height: 852 },
]) {
  test(`board and HUD stay put when the turn changes (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startAIMatch(page);
    const samples: Awaited<ReturnType<typeof layout>>[] = [];
    const deadline = Date.now() + 45_000;
    // Sample until both "my turn" and "bot's turn" states were seen (the bot may kick off first).
    while (Date.now() < deadline) {
      samples.push(await layout(page));
      const seen = new Set(samples.map((s) => s.canAim));
      if (seen.size === 2 && samples.length > 6) break;
      if (samples.at(-1)!.canAim) {
        // Pass our turn quickly with a real shot so the bot gets one.
        const box = (await page.locator('[data-testid=game-host] canvas').boundingBox())!;
        const s = box.width / 720;
        const state = await page.evaluate(
          () =>
            (
              window as unknown as { __fkMatch: { state: () => { bodies: { x: number; y: number }[] } } }
            ).__fkMatch.state().bodies,
        );
        const d = state[1]!;
        const from = await boardToPage(page, d.x, d.y);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x - 60 * s, from.y, { steps: 4 });
        await page.mouse.up();
      }
      await page.waitForTimeout(400);
    }
    expect(new Set(samples.map((s) => s.canAim)).size, 'saw both turns').toBe(2);
    for (const key of ['canvas', 'hud', 'left', 'right', 'score'] as const) {
      expect(
        new Set(samples.map((s) => s[key])),
        `${key} moved: ${[...new Set(samples.map((s) => s[key]))].join(' | ')}`,
      ).toEqual(new Set([samples[0]![key]]));
    }
  });
}
