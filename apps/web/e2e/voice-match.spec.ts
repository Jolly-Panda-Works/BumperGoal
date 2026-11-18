import { devices, expect, test, type Browser, type Page } from '@playwright/test';

const COMMS = process.env.E2E_COMMS_URL ?? '';
const COMMS_KEY = process.env.E2E_COMMS_SERVER_KEY ?? '';
const ADMIN_USER = process.env.E2E_ADMIN_USERNAME ?? '';
const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD ?? '';

test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      ...(process.env.E2E_FAKE_AUDIO ? [`--use-file-for-fake-audio-capture=${process.env.E2E_FAKE_AUDIO}`] : []),
    ],
    executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
  },
});

test.beforeEach(async ({ request }) => {
  test.skip(!COMMS || !COMMS_KEY, 'set E2E_COMMS_URL and E2E_COMMS_SERVER_KEY (real comms + LiveKit)');
  const up = await request
    .get('http://127.0.0.1:7350/healthcheck', { timeout: 3000 })
    .then((r) => r.ok())
    .catch(() => false);
  test.skip(!up, 'Nakama is not running');
});

interface Voice {
  status: string;
  mic: string;
  me: { id: string; speaking: boolean } | null;
  peers: { id: string; name: string; speaking: boolean; silenced: boolean; microphone: boolean }[];
}

const voice = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fkMatch: { voice: () => Voice } }).__fkMatch.voice());
const matchId = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __fkMatch: { state: () => { matchId: string } } }).__fkMatch.state().matchId,
  );

const liveAudio = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLAudioElement>('#voice-audio audio')].filter((el) => {
        const track = (el.srcObject as MediaStream | null)?.getAudioTracks()[0];
        return track !== undefined && track.readyState === 'live' && !track.muted;
      }).length,
  );

async function phone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ ...devices['Pixel 7'], permissions: ['microphone'] });
  return context.newPage();
}

async function guest(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Your player name').fill(name);
  await page.getByRole('button', { name: 'Start playing' }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await expect(page.getByRole('link', { name: 'Coins' })).toHaveText('500', { timeout: 15_000 });
}

async function findMatch(page: Page) {
  await page.goto('/play/online');
  await page.locator('.arena', { hasText: 'Park Pitch' }).getByRole('button', { name: 'Find match' }).click();
  await expect(page).toHaveURL(/\/play\/online\/search\?arena=park/);
}

async function room(match: string) {
  const res = await fetch(`${COMMS}/v1/server/game-rooms/${encodeURIComponent(match)}`, {
    headers: { Authorization: `Bearer ${COMMS_KEY}` },
  });
  return (await res.json()) as { state: string; players: { id: string; connected: boolean; name: string }[] };
}

test('two players of a ranked match talk, silence, report and lose the room when the match ends', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const tag = Date.now().toString(36).slice(-4);
  const alpha = `Alpha ${tag}`;
  const beta = `Beta ${tag}`;
  const a = await phone(browser);
  const b = await phone(browser);
  await guest(a, alpha);
  await guest(b, beta);
  await findMatch(a);
  await findMatch(b);
  await expect(a).toHaveURL(/\/match$/, { timeout: 20_000 });
  await expect(b).toHaveURL(/\/match$/, { timeout: 20_000 });

  const micA = a.getByTestId('voice-mic');
  const micB = b.getByTestId('voice-mic');
  await expect(micA).toBeVisible({ timeout: 20_000 });
  await expect(micB).toBeVisible({ timeout: 20_000 });
  await expect(micA).toHaveAttribute('aria-pressed', 'false');
  await expect(micB).toHaveAttribute('aria-pressed', 'false');
  await expect(micA).toHaveAccessibleName('Turn microphone on');

  const match = await matchId(a);
  expect(await matchId(b)).toBe(match);
  const opened = await room(match);
  expect(opened.state).toBe('open');
  expect(opened.players.map((p) => p.name).sort()).toEqual([alpha, beta]);
  await expect.poll(async () => (await room(match)).players.every((p) => p.connected), { timeout: 15_000 }).toBe(true);
  expect(await liveAudio(b)).toBe(0);
  await a.screenshot({ path: 'test-results/screens/voice-muted.png' });

  const idA = (await voice(a)).me!.id;
  const idB = (await voice(b)).me!.id;

  const t0 = Date.now();
  await micA.click();
  await expect(micA).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => liveAudio(b), { timeout: 10_000 }).toBeGreaterThan(0);
  const heardMs = Date.now() - t0;
  await expect
    .poll(async () => (await voice(b)).peers.find((p) => p.id === idA)?.speaking ?? false, { timeout: 15_000 })
    .toBe(true);
  await expect(b.getByTestId(`voice-badge-${idA}`)).toHaveAttribute('data-state', 'speaking');
  await b.screenshot({ path: 'test-results/screens/voice-opponent-speaking.png' });

  await micB.click();
  await expect(micB).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => liveAudio(a), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect
    .poll(async () => (await voice(a)).peers.find((p) => p.id === idB)?.speaking ?? false, { timeout: 15_000 })
    .toBe(true);

  await b.getByTestId('voice-peer').click();
  const dialog = b.getByRole('dialog', { name: `Voice: ${alpha}` });
  await expect(dialog).toBeVisible();
  await b.screenshot({ path: 'test-results/screens/voice-dialog.png' });
  await dialog.getByRole('switch').click();
  await expect.poll(() => liveAudio(b), { timeout: 10_000 }).toBe(0);
  expect((await voice(b)).peers.find((p) => p.id === idA)?.silenced).toBe(true);
  expect(await liveAudio(a)).toBeGreaterThan(0);

  await dialog.getByRole('radio', { name: 'Abuse' }).click();
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(b.getByText('Report sent. Thank you.')).toBeVisible();
  await expect(dialog).toBeHidden();
  await b.getByTestId('voice-peer').click();
  await expect(b.getByText('You reported this player.')).toBeVisible();
  await b.getByRole('dialog').getByRole('switch').click();
  await expect.poll(() => liveAudio(b), { timeout: 10_000 }).toBeGreaterThan(0);
  await b.getByRole('button', { name: 'Close' }).click();

  await micA.click();
  await expect(micA).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(async () => (await voice(b)).peers.find((p) => p.id === idA)?.microphone ?? true, { timeout: 10_000 })
    .toBe(false);
  await expect(b.getByTestId(`voice-badge-${idA}`)).toHaveCount(0, { timeout: 10_000 });

  await a.getByRole('button', { name: 'Pause' }).click();
  await a.getByRole('button', { name: 'Leave match' }).click();
  await a.getByRole('dialog', { name: 'Leave this match?' }).getByRole('button', { name: 'Leave match' }).click();
  await expect.poll(async () => (await room(match)).state, { timeout: 15_000 }).toBe('closed');
  await expect(a).toHaveURL(/\/result$/, { timeout: 15_000 });
  await expect(b).toHaveURL(/\/result$/, { timeout: 15_000 });
  await expect(b.getByTestId('voice-mic')).toHaveCount(0);
  test.info().annotations.push({ type: 'heard-after-mic-ms', description: String(heardMs) });

  if (ADMIN_USER && ADMIN_PASS) {
    const admin = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await guest(admin, `Admin ${tag}`);
    await admin.goto('/admin');
    await admin.getByLabel('Username').fill(ADMIN_USER);
    await admin.getByLabel('Password').fill(ADMIN_PASS);
    await admin.getByRole('button', { name: 'Sign in' }).click();
    await admin.getByRole('button', { name: 'Voice reports' }).click();
    const row = admin.locator('.ad-reports tbody tr').first();
    await expect(row).toContainText('Abuse', { timeout: 15_000 });
    await expect(row).toContainText(alpha);
    await expect(row).toContainText(beta);
    await admin.screenshot({ path: 'test-results/screens/voice-admin-reports.png' });
  }
});
