import { expect, test } from '@playwright/test';
import { boardToPage } from './board3d';

for (const viewport of [
  { label: 'desktop', width: 1280, height: 1000 },
  { label: 'phone @mobile', width: 393, height: 852 },
]) {
  test(`3D models and a real slingshot shot (${viewport.label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    const models = new Set<string>();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.url().endsWith('.glb') && response.ok()) models.add(response.url().split('/').at(-1)!);
    });
    await page.goto('/');
    await page.getByLabel('Your player name').fill('3D Driver');
    await page.getByRole('button', { name: 'Start playing' }).click();
    await page.goto('/play/local');
    await page.getByRole('button', { name: 'Kick off' }).click();
    await expect(page.getByLabel('Bumper Goal 3D football arena')).toBeVisible();
    await expect(page.getByLabel('Bumper Goal 3D football arena')).toHaveAttribute(
      'data-layout',
      viewport.width >= 700 ? 'landscape' : 'portrait',
    );
    await expect.poll(() => models.size).toBe(2);
    const canvas = await page.getByLabel('Bumper Goal 3D football arena').boundingBox();
    expect(canvas).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    await expect(page.locator('.hud')).toBeInViewport();
    const state = await page.evaluate(() =>
      (
        window as unknown as {
          __fkMatch: { state(): { turn: { side: string; seq: number }; bodies: { x: number; y: number }[] } };
        }
      ).__fkMatch.state(),
    );
    const car = state.bodies[state.turn.side === 'L' ? 3 : 8]!;
    const start = await boardToPage(page, car.x, car.y);
    const end = await boardToPage(page, car.x + (state.turn.side === 'L' ? -2.3 : 2.3), car.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __fkMatch: { state(): { turn: { seq: number } } };
                }
              ).__fkMatch.state().turn.seq,
          ),
        { timeout: 25000 },
      )
      .toBeGreaterThan(state.turn.seq);
    expect([...models].sort()).toEqual(['cicada.glb', 'cruiser.glb']);
    expect(errors).toEqual([]);
  });
}
