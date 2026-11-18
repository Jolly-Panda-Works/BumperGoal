import { expect, test } from '@playwright/test';
import { nightForMatch } from '../src/game/CarSignals';
import { boardToPage, waitForArenaInput } from './board3d';

for (const night of [true, false])
  test(`car collision horn, hazards and moving headlights (${night ? 'night' : 'day'})`, async ({ page }) => {
    let stamp = 1900000000000;
    while (nightForMatch(0, `local-${stamp.toString(36)}`) !== night) stamp++;
    await page.addInitScript((stamp) => {
      Date.now = () => stamp;
      localStorage.setItem(
        'flickkick.profile.v1',
        JSON.stringify({ welcomed: true, tutorialDone: true, displayName: 'Night Driver' }),
      );
      localStorage.setItem(
        'flickkick.settings.v1',
        JSON.stringify({ language: 'en', graphics: 'low', reducedMotion: false }),
      );
    }, stamp);
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/play/local');
    await page.getByRole('button', { name: 'Kick off', exact: true }).click();
    const canvas = page.getByLabel('Bumper Goal 3D football arena');
    await expect(canvas).toHaveAttribute('data-time-of-day', night ? 'night' : 'day');
    await expect(canvas).toHaveAttribute('data-models-ready', '6');
    const state = await page.evaluate(() => (window as any).__fkMatch.state());
    const startIndex = state.turn.side === 'L' ? 1 : 4;
    const car = state.bodies[startIndex],
      target = state.bodies[startIndex - 1];
    const a = await boardToPage(page, car.x, car.y);
    const distance = Math.hypot(target.x - car.x, target.y - car.y);
    const end = await boardToPage(
      page,
      car.x - ((target.x - car.x) / distance) * 3.2,
      car.y - ((target.y - car.y) / distance) * 3.2,
    );
    await waitForArenaInput(page, a);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    if (night) {
      await expect
        .poll(async () => Number(await canvas.getAttribute('data-headlight-count')), { timeout: 6000 })
        .toBeGreaterThan(0);
      await page.screenshot({ path: '../../outputs/BumperGoal-night-headlights.png' });
    }
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-horn-count')), { timeout: 12000 })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-hazard-count')), { timeout: 3000 })
      .toBeGreaterThan(0);
    if (!night) await expect(canvas).toHaveAttribute('data-headlight-count', '0');
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-headlight-count')), { timeout: 15000 })
      .toBe(0);
    await expect.poll(async () => Number(await canvas.getAttribute('data-hazard-count')), { timeout: 6000 }).toBe(0);
    expect(errors).toEqual([]);
  });
