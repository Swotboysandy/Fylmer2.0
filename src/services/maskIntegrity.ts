export interface MaskVerificationReport {
  selectedPixels: number;
  changedInside: number;
  changedOutside: number;
  passed: boolean;
}

function validate(before: Uint8ClampedArray, after: Uint8ClampedArray, mask: Uint8Array) {
  if (!mask.length || before.length !== after.length || before.length !== mask.length * 4)
    throw new Error('Frame and mask dimensions must match.');
  if (mask.some(value => value !== 0 && value !== 1))
    throw new Error('The correction mask must be binary.');
}

export function verifyMaskedPixelDiff(
  before: Uint8ClampedArray, after: Uint8ClampedArray, mask: Uint8Array,
): MaskVerificationReport {
  validate(before, after, mask);
  let selectedPixels = 0, changedInside = 0, changedOutside = 0;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (mask[pixel]) selectedPixels++;
    const index = pixel * 4;
    const changed = before[index] !== after[index] || before[index + 1] !== after[index + 1]
      || before[index + 2] !== after[index + 2] || before[index + 3] !== after[index + 3];
    if (changed) {
      if (mask[pixel]) changedInside++;
      else changedOutside++;
    }
  }
  return { selectedPixels, changedInside, changedOutside, passed: selectedPixels > 0 && changedOutside === 0 };
}

export function recolorMaskedPixels(
  before: Uint8ClampedArray, mask: Uint8Array, rgb: readonly number[],
): { pixels: Uint8ClampedArray; verification: MaskVerificationReport } {
  validate(before, before, mask);
  if (rgb.length !== 3 || rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255))
    throw new Error('Invalid target colour.');
  const pixels = before.slice();
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!mask[pixel]) continue;
    const i = pixel * 4;
    if (!before[i + 3]) continue;
    const r = before[i], g = before[i + 1], b = before[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (saturation > 0.22 && luminance > 0.12 && luminance < 0.92) {
      const factor = Math.min(1.35, Math.max(0.45, luminance * 1.45));
      for (let channel = 0; channel < 3; channel++)
        pixels[i + channel] = Math.min(255, Math.round(rgb[channel] * factor));
    }
  }
  const verification = verifyMaskedPixelDiff(before, pixels, mask);
  if (!verification.passed) throw new Error('Mask verification failed. No correction was applied.');
  if (!verification.changedInside) throw new Error('No editable pixels changed inside the mask. The shot was not marked corrected.');
  return { pixels, verification };
}