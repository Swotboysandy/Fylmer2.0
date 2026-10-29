# Kitchen to ocean: local transition checkpoint

Open http://127.0.0.1:4317/ and select **Open dream transition** above the existing storyboard toolbar. The existing Masakazu studio remains intact. The dream study has its own scrubber and export controls; it does not overwrite storyboard shots or the main animatic timeline.

## Implementation

- Two bundled 512px backgrounds were generated locally with SD1.5 on an RTX 3050 Laptop GPU. Model revision, prompts, seeds, timings and hashes are in `public/dream/provenance.json`.
- The initial mmap weight load crashed natively. Both successful generations used the optional `ANCHORSHOT_WEIGHT_LOADER=pread` override. Existing defaults are unchanged.
- The 800 x 450 compositor holds the kitchen for 2 seconds, performs an 8-second ripple/reveal, then holds the ocean for 2 seconds. No model runs while playing or exporting.
- An authored cup and shadow are composited once over the source; every selected RGBA pixel is copied unchanged into each output frame, including antialiased boundary pixels. This deliberately preserves a small source-colored edge footprint. It is not a live SAM mask.
- Preview, PNG and WebM use the same renderer. Overlay pixels are on a separate canvas and never exported. Scrubbing is deterministic in either direction. Reduced motion uses a cut in both preview and export.
- Exports are silent. WebM is captured in real time with a target of 24 fps, and can have variable frame timing; hiding the tab cancels export. PNG output is lossless; WebM is not.

## Verification

Run `npm run check`, then `npx playwright test tests/browser/dream.spec.ts` with Chrome installed. The browser suite saves the mask, frames, WebM, report and screenshots under `.artifacts/dream-tests`.

Run `.artifacts/local-ai/venv/Scripts/python.exe scripts/verify_dream_export.py` to decode the actual downloaded video with ffmpeg and compare its protected region with the uncompressed reference. Requires NumPy, Pillow, ffmpeg and ffprobe.

Results are recorded in `docs/DREAM_TRANSITION_RESULTS.json`: 43 offline tests, 3 browser tests, typecheck and production build passed. The compositor checks all 289 samples across 12 seconds: 14,802 protected pixels, zero changed protected pixels. Browser tests cover playback/pause, reverse seeking, cancel/retry, downloads, overlay exclusion, reduced motion, keyboard scrubbing, mobile width and missing-asset failure. No POST requests occurred during the dream browser flow.

The WebM decoded successfully at 800 x 450, approximately 12 seconds. Five decoded samples have mean protected-region channel error below 3/255 due to lossy encoding; do not label the encoded video zero-drift. Runtime metrics vary by device and load; see the JSON for measured values.

## Limits and next checkpoint

This is a deterministic ripple/reveal with locally generated backgrounds and an illustrated fixed cup. It is not an image-conditioned AI video morph, real-cup segmentation, relighting, perspective tracking, narration export or an editable dream planner. The next checkpoint is replacing the illustrated cup with a user-approved real selection, while retaining the same protection and export checks. No Baseten deployment or paid Meta call was made.

## Included review artifacts

The validated snapshot is committed in `docs/dream-demo/`: [demo WebM](dream-demo/dream.webm), [desktop preview](dream-demo/study.png), [mobile preview](dream-demo/mobile.png), three reference PNG frames, the overlay-exclusion PNG, exact mask bytes and measurement reports. These are generated sample assets, not user recordings. Downloaded model weights and temporary worker files remain local.
