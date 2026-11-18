import { expect, test } from '@playwright/test';
import { boardToPage, waitForArenaInput } from './board3d';
test('equipped trail renders behind moving cars', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your player name').fill('Trail Driver');
  await page.getByRole('button', { name: 'Start playing' }).click();
  await page.evaluate(() => {
    const profile = JSON.parse(localStorage.getItem('flickkick.profile.v1')!);
    localStorage.setItem(
      'flickkick.profile.v1',
      JSON.stringify({ ...profile, trailId: 'trail_rainbow', teamId: 'team_ocean' }),
    );
    localStorage.setItem(
      'flickkick.inventory.v1',
      JSON.stringify({ coins: 0, gems: 0, owned: ['trail_rainbow', 'team_ocean'], packs: [] }),
    );
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const models = new Set<string>();
  page.on('response', (response) => {
    if (response.ok() && response.url().endsWith('.glb')) models.add(response.url().split('/').at(-1)!);
  });
  await page.goto('/play/local');
  await page.getByRole('button', { name: 'Kick off' }).click();
  const canvas = page.getByLabel('Bumper Goal 3D football arena');
  await expect(canvas).toBeVisible();
  await expect.poll(() => models.has('carrier.glb')).toBe(true);
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = await page.evaluate(() => (window as any).__fkMatch.state());
    const car = state.bodies[state.turn.side === 'L' ? 1 : 4];
    const start = await boardToPage(page, car.x, car.y);
    const ball = state.bodies.at(-1)!;
    const distance = Math.hypot(ball.x - car.x, ball.y - car.y);
    const end = await boardToPage(
      page,
      car.x - ((ball.x - car.x) / distance) * 2.3,
      car.y - ((ball.y - car.y) / distance) * 2.3,
    );
    await waitForArenaInput(page, start);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    if (state.turn.side === 'L') {
      await expect.poll(async () => Number(await canvas.getAttribute('data-trail-count'))).toBeGreaterThan(0);
      break;
    }
    await expect
      .poll(async () => page.evaluate(() => (window as any).__fkMatch.state().turn.seq), { timeout: 25000 })
      .toBeGreaterThan(state.turn.seq);
  }
  await expect.poll(async () => Number(await canvas.getAttribute('data-trail-count'))).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
