import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile } from 'node:fs/promises';

test('dream scenes change while the opaque mug interior remains identical', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/dream');
  await expect(page.getByRole('button', { name: 'Play dream', exact: true })).toBeEnabled();
  const pixels = () =>
    page
      .locator('canvas')
      .evaluate((canvas) =>
        Array.from(
          (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(130, 480, 100, 70).data,
        ),
      );
  const first = await pixels();
  await page.getByRole('button', { name: 'Show An endless ocean' }).click();
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', /endless ocean/);
  expect(await pixels()).toEqual(first);
  await page.getByRole('button', { name: 'Show Under another moon' }).click();
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', /another moon/);
  expect(await pixels()).toEqual(first);
  await page.getByRole('checkbox', { name: 'Keep the red mug' }).uncheck();
  expect(await pixels()).not.toEqual(first);
  await page.getByRole('checkbox', { name: 'Keep the red mug' }).check();
  expect(await pixels()).toEqual(first);
  expect(errors).toEqual([]);
});

test('pause, scrubbing, captions and plan persistence work without generation', async ({
  page,
}) => {
  await page.goto('/dream');
  await page.getByRole('button', { name: 'Play dream', exact: true }).click();
  await expect
    .poll(async () => Number(await page.getByLabel('Dream playhead').inputValue()))
    .toBeGreaterThan(0.5);
  await page.getByRole('button', { name: 'Pause dream', exact: true }).click();
  const paused = await page.getByLabel('Dream playhead').inputValue();
  await page.waitForTimeout(180);
  expect(await page.getByLabel('Dream playhead').inputValue()).toBe(paused);
  await page.getByLabel('Dream playhead').focus();
  await page.keyboard.press('End');
  await expect(page.getByLabel('Dream playhead')).toHaveValue('20');
  await page.getByRole('button', { name: 'Restart dream' }).click();
  await expect(page.getByLabel('Dream playhead')).toHaveValue('0');
  await page.getByLabel('Your dream notes').fill('I remembered a doorway and a red mug.');
  await page.getByLabel('Caption for An endless ocean').fill('The sea was completely still.');
  await page.getByRole('button', { name: 'Dissolve', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Your dream notes')).toHaveValue(
    'I remembered a doorway and a red mug.',
  );
  await expect(page.getByLabel('Caption for An endless ocean')).toHaveValue(
    'The sea was completely still.',
  );
  await expect(page.getByRole('button', { name: 'Dissolve', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await mkdir('.artifacts/dream', { recursive: true });
  await (await pending).saveAs('.artifacts/dream/plan.json');
  const plan = JSON.parse(await readFile('.artifacts/dream/plan.json', 'utf8'));
  expect(plan.provenance.modelCalls).toBe(0);
  expect(plan.captions[1]).toBe('The sea was completely still.');
});

test('exports an actual playable silent WebM and supports cancellation', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('/dream');
  await expect(page.getByRole('button', { name: 'Export WebM', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Export WebM', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel export' }).click();
  await expect(page.getByRole('status')).toContainText('Export cancelled');
  const downloaded = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Export WebM', exact: true }).click();
  await expect(page.getByLabel('Your dream notes')).toBeDisabled();
  await mkdir('.artifacts/dream', { recursive: true });
  await (await downloaded).saveAs('.artifacts/dream/journey.webm');
  const bytes = await readFile('.artifacts/dream/journey.webm');
  expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  expect(bytes.length).toBeGreaterThan(50_000);
  await page.route('**/test-dream.webm', (route) =>
    route.fulfill({ contentType: 'video/webm', body: bytes }),
  );
  // A downloaded file is fully local; use a Blob URL rather than a mock HTTP server without byte-range support.
  const metadata = await page.evaluate(async () => {
    const url = URL.createObjectURL(await (await fetch('/test-dream.webm')).blob());
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    document.body.append(video);
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Video did not decode'));
    });
    await video.play();
    video.pause();
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = 10;
    });
    const result = {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      seek: video.currentTime,
    };
    video.remove();
    URL.revokeObjectURL(url);
    return result;
  });
  expect(metadata.width).toBe(1120);
  expect(metadata.height).toBe(700);
  expect(metadata.duration).toBeGreaterThan(19.5);
  expect(metadata.duration).toBeLessThan(21.5);
  expect(metadata.seek).toBe(10);
  await expect(page.getByLabel('Your dream notes')).toBeEnabled();
});

for (const [name, width] of [
  ['desktop', 1440],
  ['tablet', 768],
  ['mobile', 390],
] as const) {
  test(`dream ${name} layout and accessibility`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/dream');
    await expect(page.getByRole('button', { name: 'Play dream', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Show An endless ocean' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const checkbox = await page.getByRole('checkbox', { name: 'Gentle playback' }).boundingBox();
    expect(checkbox!.width).toBeLessThanOrEqual(20);
    expect(checkbox!.height).toBeLessThanOrEqual(20);
    expect(
      await page.locator('.dream-motion').evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);
    await page.locator('#dream-workspace').focus();
    await page.evaluate(() => window.scrollTo(0, 0));
    await mkdir('.artifacts/dream', { recursive: true });
    await page.screenshot({ path: `.artifacts/dream/${name}.png`, fullPage: true });
  });
}
test('reduced-motion preference defaults to gentle cuts and no autoplay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dream');
  await expect(page.getByRole('checkbox', { name: 'Gentle playback' })).toBeChecked();
  await expect(page.getByLabel('Dream playhead')).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Play dream', exact: true })).toBeEnabled();
});
