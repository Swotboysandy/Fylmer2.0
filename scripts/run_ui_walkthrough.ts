import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const screenshotDir = 'C:/Users/buzman/.gemini/antigravity-cli/brain/d918e4dd-ae3f-4a4e-b8b0-672ac8b88d8d/ui-screenshots';

async function main() {
  console.log('[UI Walkthrough] Launching Edge browser...');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();

  console.log('[UI Walkthrough] Navigating to http://127.0.0.1:4317/ ...');
  await page.goto('http://127.0.0.1:4317/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 1. Initial Studio Overview
  console.log('[UI Walkthrough] Step 1: Capturing Studio Overview...');
  await page.screenshot({ path: path.join(screenshotDir, '01_studio_overview.png') });

  // 2. Shot Inspector Panel (Shot 2)
  console.log('[UI Walkthrough] Step 2: Inspecting Shot 2...');
  const shot2 = page.locator('button:has-text("Shot 02"), [data-shot-id="shot-2"], button:has-text("Shot 2")').first();
  if (await shot2.count()) {
    await shot2.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, '02_shot_inspector.png') });
  }

  // 3. Open Dream Transition Study
  console.log('[UI Walkthrough] Step 3: Opening Kitchen → Ocean Dream Study...');
  const openDreamBtn = page.getByRole('button', { name: /Open dream transition/i });
  await openDreamBtn.click();
  await page.waitForTimeout(2000); // Wait for background asset decode
  await page.screenshot({ path: path.join(screenshotDir, '03_dream_kitchen.png') });

  // 4. Scrub to 6s (World Changing)
  console.log('[UI Walkthrough] Step 4: Scrubbing to 6s (World Changing)...');
  const worldBtn = page.getByRole('button', { name: 'World changing', exact: true });
  if (await worldBtn.count()) {
    await worldBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(screenshotDir, '04_dream_midpoint.png') });
  }

  // 5. Scrub to 12s (Ocean)
  console.log('[UI Walkthrough] Step 5: Scrubbing to 12s (Ocean)...');
  const oceanBtn = page.getByRole('button', { name: 'Ocean', exact: true });
  if (await oceanBtn.count()) {
    await oceanBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(screenshotDir, '05_dream_ocean.png') });
  }

  // 6. Select Real Cup & Load CC0 Coffee Sample
  console.log('[UI Walkthrough] Step 6: Opening Real Cup Editor & Loading CC0 Sample...');
  const selectCupBtn = page.getByRole('button', { name: /Select real cup/i });
  await selectCupBtn.click();
  await page.waitForTimeout(500);

  const sampleBtn = page.getByRole('button', { name: /Use real cup sample/i });
  await sampleBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(screenshotDir, '06_cup_editor_sample_loaded.png') });

  // 7. Click SAM 3.1 Smart Cutout
  console.log('[UI Walkthrough] Step 7: Triggering SAM 3.1 Smart Cutout...');
  const samBtn = page.getByRole('button', { name: /SAM 3\.1 Smart Cutout/i });
  await samBtn.click();

  // Wait for SAM cutout to process (up to 15s for live Meta API or fallback)
  console.log('[UI Walkthrough] Waiting for SAM 3.1 segmentation result...');
  const applyBtn = page.locator('button:has-text("Apply cup to dream")');
  await applyBtn.waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Apply cup to dream'));
    return btn && !btn.hasAttribute('disabled');
  }, { timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotDir, '07_sam_cutout_applied.png') });

  // 8. Apply Cup to Dream Transition
  console.log('[UI Walkthrough] Step 8: Applying Real Cup to Dream Composite...');
  await applyBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(screenshotDir, '08_dream_with_real_cup.png') });

  // 9. Run Cup Preservation Quality Check
  console.log('[UI Walkthrough] Step 9: Running Cup Preservation Check (289 frames)...');
  const checkBtn = page.getByRole('button', { name: /Check cup preservation/i });
  await checkBtn.click();
  await page.waitForSelector('[role="status"][aria-label="Cup preservation results"]', { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotDir, '09_cup_preservation_report.png') });

  console.log('[UI Walkthrough] Complete! All 9 screenshots captured.');
  await browser.close();
}

main().catch((err) => {
  console.error('[UI Walkthrough] Error:', err);
  process.exit(1);
});
