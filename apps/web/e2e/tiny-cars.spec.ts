import { expect, test } from '@playwright/test';
import { boardToPage, waitForArenaInput } from './board3d';

test('new racing models play with animated wheels, exhaust and nitro', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.addInitScript(() =>
    localStorage.setItem('flickkick.settings.v1', JSON.stringify({ graphics: 'low', language: 'en' })),
  );
  const errors: string[] = [],
    models = new Set<string>();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.ok() && response.url().endsWith('.glb')) models.add(response.url().split('/').at(-1)!);
  });
  await page.goto('/');
  await page.getByLabel('Your player name').fill('Racing Driver');
  await page.getByRole('button', { name: 'Start playing' }).click();
  await page.goto('/play/local');
  await page.locator('.local-team').nth(0).getByRole('radio', { name: 'Rusty McToot', exact: true }).click();
  await page.locator('.local-team').nth(1).getByRole('radio', { name: 'Professor Vroom', exact: true }).click();
  await page.getByRole('button', { name: 'Kick off' }).click();
  await expect.poll(() => models.has('tiny-racer-6.glb') && models.has('tiny-racer-9.glb')).toBe(true);
  const canvas = page.getByLabel('Bumper Goal 3D football arena');
  await expect(canvas).toHaveAttribute('data-models-ready', '10');
  expect(errors).toEqual([]);
  const state = await page.evaluate(() => (window as any).__fkMatch.state());
  const car = state.bodies[state.turn.side === 'L' ? 3 : 8];
  const start = await boardToPage(page, car.x, car.y),
    end = await boardToPage(page, car.x + (state.turn.side === 'L' ? -2.8 : 2.8), car.y);
  await waitForArenaInput(page, start);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  for (const attribute of ['data-wheel-turns', 'data-smoke-count', 'data-nitro-count'])
    await expect.poll(async () => Number(await canvas.getAttribute(attribute))).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
