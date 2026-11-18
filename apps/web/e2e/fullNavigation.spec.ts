import { expect, test } from '@playwright/test';
for (const viewport of [
  { label: 'desktop', width: 1280, height: 800 },
  { label: 'phone @mobile', width: 393, height: 852 },
]) {
  test(`complete navigation, purchase and owned equipment (${viewport.label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.log('BROWSER ERROR', error.message);
    });
    await page.goto('/');
    await page.getByLabel('Your player name').fill('League Driver');
    await page.getByRole('button', { name: 'Start playing' }).click();
    await page.goto('/home');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link')).toHaveCount(5);
    for (const [label, route] of [
      ['League', 'league'],
      ['Profile', 'profile'],
      ['Assets', 'locker'],
      ['Shop', 'shop'],
    ]) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp('/' + route + '$'));
      await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
    }
    await page.getByRole('tab', { name: 'Balls', exact: true }).click();
    const neon = page.locator('.shop-product').filter({ has: page.getByText('Neon', { exact: true }) });
    await neon.getByRole('button', { name: 'Buy', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(neon.getByText('Owned', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Equip', exact: true })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Assets', exact: true }).click();
    await page.getByRole('tab', { name: 'Balls', exact: true }).click();
    const owned = page.locator('.shop-product').filter({ has: page.getByText('Neon', { exact: true }) });
    await owned.getByRole('button', { name: 'Equip', exact: true }).click();
    await expect(owned.getByText('Equipped', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buy', exact: true })).toHaveCount(0);
    await page.reload();
    await page.getByRole('tab', { name: 'Balls', exact: true }).click();
    await expect(
      page
        .locator('.shop-product')
        .filter({ has: page.getByText('Neon', { exact: true }) })
        .getByText('Equipped', { exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Avatars', exact: true }).click();
    const owl = page.locator('.shop-product').filter({ has: page.getByText('Owl', { exact: true }) });
    await owl.getByRole('button', { name: 'Equip', exact: true }).click();
    await expect(owl.getByText('Equipped', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
