# PR 3 integration review

Reviewed BZcreativ's SAM cup integration, original head bdd17e29f185693cd805671f5bb03d609dc49628.

## Changes made before merge
- Preserve Masakazu's studio and manual cup correction flow.
- Default the cup adapter and UI to offline mode: no health or segmentation request, even if a server key exists. The UI exposes an explicitly labeled synthetic starter shape. Live adapter support remains available to code through allowLive, but is not enabled in this UI.
- Do not present a fallback shape as SAM output or a measured confidence score. Live errors preserve the prior selection instead of silently creating a synthetic success.
- Lock editor tools while preparing a mask, ignore stale results after cancellation, and clear stale model metadata on manual mask changes.
- Reject fractional raster dimensions, nonfinite bounds, truncated rasters and nonbinary pixels. Report provenance in preservation results.
- Replace the author-specific live walkthrough with a portable, assertion-based local browser suite.
- Transfer the old dream test's mask as base64 rather than 360,000 separately serialized numbers to reduce test memory pressure.

## Verification
- npm run check: passed, including TypeScript, 8 rendering tests, 1 local generation API test, 41 Vitest tests, and the production build (50 tests total).
- Browser: all 7 current checks passed across targeted runs. Final full run passed both cup tests, both new SAM tests, and two dream tests; the remaining older export test timed out under local memory pressure. After reducing its serialization overhead, all 3 dream tests passed in 32.6 seconds. Assertions were retained.
- A concurrent TypeScript attempt ran out of virtual memory; the subsequent sequential check passed.
- New checks prove offline cutout sends no POST, synthetic provenance clears on correction, approved cup stays unchanged over 289 frames, mocked live raster decoding works, and malformed responses fail without replacing the mask.
- Both exported WebMs decoded successfully. Real cup PNGs preserve all 21,041 protected pixels exactly; video timestamps increase. WebM is lossy and real-time capture is variable frame rate, not guaranteed 24 fps.
- No Meta, Muse or Baseten requests or credits were used. No actual live SAM quality claim is made by this review. The PR author's live model claims were not independently rerun.
- No GitHub Actions runs, commit statuses, submitted reviews, or review threads existed for the original PR head.

See PR_3_RESULTS.json for the measured export results. Previous docs remain historical evidence from earlier commits.
