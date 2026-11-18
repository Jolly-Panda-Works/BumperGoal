import { expect, test } from '@playwright/test';

for (const [width, height, language] of [
  [1280, 720, 'en'],
  [844, 390, 'en'],
  [844, 390, 'fa'],
  [640, 360, 'en'],
] as const) {
  test(`toy menu fits ${width}x${height} ${language} and opens existing actions`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript((language) => {
      localStorage.setItem(
        'flickkick.profile.v1',
        JSON.stringify({ displayName: 'Turbo Panda', welcomed: true, tutorialDone: true }),
      );
      localStorage.setItem('flickkick.settings.v1', JSON.stringify({ language }));
    }, language);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/home');
    await expect(page.locator('.toy-menu__car [data-ready="true"]')).toBeVisible();
    const controls = page.locator('.toy-menu a, .toy-menu button, .stadium-wallet > a');
    for (const control of await controls.all()) {
      const rect = await control.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.width).toBeGreaterThanOrEqual(44);
      expect(rect!.height).toBeGreaterThanOrEqual(44);
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.y).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(height + 1);
    }
    await page.locator('.toy-play').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').locator('a')).toHaveCount(3);
    await page.getByRole('dialog').locator('a[href="/play/ai"]').click();
    await expect(page).toHaveURL(/\/play\/ai$/);
    await page.goto('/home');
    await page.locator('.toy-garage').click();
    await expect(page).toHaveURL(/\/locker$/);
    expect(errors).toEqual([]);
  });
}
