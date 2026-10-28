import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { expandMask } from '../../src/lib/correction';
import type { ObjectMask } from '../../src/types';

test('offline selection, correction, approval, exported pixels and undo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Rain at the window' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeDisabled();
  const originalUrl = await page.locator('.source-image').getAttribute('src');
  await page.getByRole('button', { name: 'Use sample selection' }).click();
  await expect(page.getByText('Hand-authored mask · not SAM output')).toBeVisible();
  await page.getByRole('button', { name: 'Preview correction' }).click();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeDisabled();
  await mkdir('.artifacts', { recursive: true });
  await page.screenshot({ path: '.artifacts/desktop-correction.png', fullPage: true });
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  await (await pngDownload).saveAs('.artifacts/verified-correction.png');
  const evidenceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save evidence' }).click();
  await (await evidenceDownload).saveAs('.artifacts/verified-evidence.json');
  const evidence = JSON.parse(await readFile('.artifacts/verified-evidence.json', 'utf8')) as {
    segmentation: ObjectMask;
  };
  expect(evidence.segmentation.source).toBe('sample');
  const original = await sharp(Buffer.from(originalUrl!.split(',')[1], 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const corrected = await sharp('.artifacts/verified-correction.png')
    .ensureAlpha()
    .raw()
    .toBuffer();
  const mask = expandMask(evidence.segmentation);
  let inside = 0,
    outside = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!original.subarray(p * 4, p * 4 + 4).equals(corrected.subarray(p * 4, p * 4 + 4))) {
      if (mask[p]) inside++;
      else outside++;
    }
  }
  expect(inside).toBeGreaterThan(1000);
  expect(outside).toBe(0);
  await page.getByRole('button', { name: 'Undo correction' }).click();
  await expect(page.locator('.source-image')).toHaveAttribute('src', originalUrl!);
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeDisabled();
  expect(errors).toEqual([]);
  expect((await (await page.request.get('/api/health')).json()).requestsUsed).toBe(0);
});

test('discard and colour changes invalidate a pending correction', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample selection' }).click();
  await page.getByRole('button', { name: 'Preview correction' }).click();
  await page.getByRole('button', { name: 'Forest', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview correction' }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeDisabled();
  await page.getByLabel('Custom hex').fill('#bad');
  await expect(page.getByRole('button', { name: 'Preview correction' })).toBeDisabled();
});

test('uploading a new source clears masks and approved revisions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample selection' }).click();
  await page.getByRole('button', { name: 'Preview correction' }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const buffer = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#a02020' },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel('Upload a PNG or JPEG')
    .setInputFiles({ name: 'new-source.png', mimeType: 'image/png', buffer });
  await expect(page.getByRole('heading', { name: 'new-source.png' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Preview correction' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Use sample selection' })).toHaveCount(0);
});

test('keyboard path reaches the sample action, preview and approval', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Rain at the window' })).toBeVisible();
  async function tabTo(name: string) {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      if (
        await page
          .getByRole('button', { name, exact: true })
          .evaluate((node) => node === document.activeElement)
      )
        return;
    }
    throw new Error(`${name} was not keyboard reachable`);
  }
  await tabTo('Use sample selection');
  await page.keyboard.press('Enter');
  await tabTo('Preview correction');
  await page.keyboard.press('Enter');
  await tabTo('Approve');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Correction approved', { exact: true })).toBeVisible();
});

for (const [name, width] of [
  ['desktop', 1440],
  ['tablet', 768],
  ['mobile', 390],
] as const) {
  test(`${name} layout and automated accessibility checks`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Use sample selection' }).click();
    await page.getByRole('button', { name: 'Preview correction' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);
    await page.locator('#editor').focus();
    await mkdir('.artifacts', { recursive: true });
    await page.screenshot({ path: `.artifacts/${name}.png`, fullPage: true });
  });
}
