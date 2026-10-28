import { describe, expect, it } from 'vitest';
import { brand } from '../src/brand';
import {
  getTargetObjectBox,
  resolveColorPalette,
  verifyMaskedPixelDiff,
} from '../src/services/canvasEngine';
import { DIRECTOR_PRESETS, metaModelClient } from '../src/services/metaModels';

describe('AnchorShot Voice Studio — Local 4-Role Pipeline Verification', () => {
  it('verifies finalized AnchorShot brand identity', () => {
    expect(brand.name).toBe('AnchorShot');
    expect(brand.provisional).toBe(false);
  });

  it('Role 1 (Director Agent): extracts versioned continuity rules from transcript', async () => {
    const preset = DIRECTOR_PRESETS[0];
    const rules = await metaModelClient.extractContinuityRules(preset.transcript);
    expect(rules.length).toBeGreaterThanOrEqual(2);
    expect(rules[0]).toMatchObject({
      id: 'rule-cup-color',
      targetObject: 'cup',
      property: 'color',
      expectedValue: 'blue',
      revision: 1,
    });
  });

  it('Role 2 (SAM & Checks): computes deterministic target bounding boxes across camera angles', () => {
    const wideBox = getTargetObjectBox('wide', 'cup');
    const closeupBox = getTargetObjectBox('closeup', 'cup');
    expect(wideBox.width).toBeGreaterThan(0);
    expect(closeupBox.width).toBeGreaterThan(wideBox.width);
    expect(resolveColorPalette('emerald').primary).toBe('#10B981');
  });

  it('Role 3 (Editing & Export): proves 0 outside-mask pixel drift on masked continuity repair', () => {
    const width = 80;
    const height = 45;
    const before = new Uint8ClampedArray(width * height * 4).fill(40);
    const after = before.slice();

    const box = { x: 25, y: 20, width: 25, height: 40 }; // px: x=[20..40), y=[9..27)
    // Modify pixels strictly inside the SAM 3.1 mask box
    for (let y = 10; y < 25; y++) {
      for (let x = 22; x < 38; x++) {
        const idx = (y * width + x) * 4;
        after[idx] = 37;
        after[idx + 1] = 99;
        after[idx + 2] = 235;
      }
    }

    const report = verifyMaskedPixelDiff(
      before,
      after,
      width,
      height,
      box,
      'sam-3.1:cup-shot-2:v1',
      2
    );

    expect(report.maskRef).toBe('sam-3.1:cup-shot-2:v1');
    expect(report.ruleRevision).toBe(2);
    expect(report.changedInsideMask).toBe(15 * 16);
    expect(report.changedOutsideMask).toBe(0);
    expect(report.outsideDriftPercent).toBe(0);
  });
});
