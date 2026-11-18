import { expect, test } from '@playwright/test';
import type { MatchState } from '@flickkick/rules';

test('the shared message popup closes without dismissing the dialog underneath it', async ({ page }) => {
  await page.goto('/shop');
  await page.locator('[data-item-state="locked"] button').first().click();
  await expect(page.locator('.dialog')).toHaveCount(1);
  await page.evaluate(async () => {
    const { toast } = await import('/src/ui/toast.tsx' as string);
    toast('Please check your selection.', 'warning');
  });
  await expect(page.locator('.message-popup--warning .dialog')).toBeVisible();
  await expect(page.locator('.dialog')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.message-popup')).toHaveCount(0);
  await expect(page.locator('.dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.dialog')).toHaveCount(0);
});

declare global {
  interface Window {
    __fkMatch?: { state(): MatchState; canAim(): boolean };
  }
}

test('local invite connects two browsers, synchronizes a shot and delivers results', async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    const host = await hostContext.newPage(),
      guest = await guestContext.newPage();
    const errors: string[] = [];
    for (const page of [host, guest]) {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${baseURL}/play/local`);
      await page.locator('.segmented button').nth(1).click();
    }
    await host.locator('.friend-invitation button').first().click();
    await expect(host.locator('.friend-code')).toBeVisible();
    const code = (await host.locator('.friend-code').textContent())!.trim();
    await guest.locator('input[maxlength="12"]').fill('000000000000');
    await guest.locator('form button[type=submit]').click();
    await expect(guest.locator('.message-popup--error .dialog')).toBeVisible();
    await guest.keyboard.press('Escape');
    await expect(guest.locator('.message-popup')).toHaveCount(0);
    await guest.locator('input[maxlength="12"]').fill(code);
    await guest.locator('form button[type=submit]').click();
    for (const page of [host, guest]) {
      await expect(page).toHaveURL(/\/match$/);
      await page.waitForFunction(() => window.__fkMatch?.state().players.length === 2);
    }
    const initial = await host.evaluate(() => window.__fkMatch!.state());
    expect(await guest.evaluate(() => window.__fkMatch!.state())).toEqual(initial);
    const shooter = initial.turn.side === 'L' ? host : guest;
    await shooter.evaluate(async (state) => {
      // Exercise the same transport as player input, through the actual local authority.
      const { localFriendRequest } = await import('/src/dev/localFriendsClient.ts' as string);
      await localFriendRequest('command', {
        matchId: state.matchId,
        op: 1,
        data: JSON.stringify({
          seq: state.turn.seq,
          discIndex: state.turn.side === 'L' ? 0 : state.discsPerTeam,
          ix: 0,
          iy: 0.8,
        }),
      });
    }, initial);
    for (const page of [host, guest]) await page.waitForFunction(() => window.__fkMatch?.state().shotCount === 1);
    expect(await host.evaluate(() => window.__fkMatch!.state())).toEqual(
      await guest.evaluate(() => window.__fkMatch!.state()),
    );
    await host.evaluate(async (id) => {
      const { localFriendRequest } = await import('/src/dev/localFriendsClient.ts' as string);
      await localFriendRequest('command', { matchId: id, op: 6 });
    }, initial.matchId);
    for (const page of [host, guest]) await expect(page).toHaveURL(/\/result$/);
    expect(errors).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
