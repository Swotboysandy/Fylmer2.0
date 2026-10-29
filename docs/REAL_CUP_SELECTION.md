# Real cup selection and mask correction (local)

Open the existing Dream study, choose **Select real cup**, then upload a PNG/JPEG/WebP or choose **Use real cup sample**. Trace a polygon around the cup and close it. Add and erase brushes refine the selection, including holes. Undo restores the preceding complete stroke; up to 20 snapshots are retained. The sample has an explicitly labeled rough starter polygon.

The source photo and cutout preview are both shown. **Apply cup to dream** approves the current nonempty selection, fits it into the existing foreground position, removes the illustrated cup, and uses the same protected-pixel compositor for preview, PNG and WebM. Editing a mask pauses playback, disables checks/exports and clears stale quality results. Cancel keeps the previously approved scene. Restore illustrated cup returns the baseline fixture.

Photos are decoded and edited in the browser. Uploads are restricted to 8 MB and 24 MP; the working copy is fit within 800 x 600. Fully opaque selected pixels are sampled into a fixed foreground footprint; transparent/semitransparent pixels are excluded. Masks are binary and resampling uses nearest-neighbor sampling to preserve holes. This can leave hard edges. Selection accuracy is reviewed by the user, not inferred from a zero-drift score.

Keyboard editing: arrows move the canvas cursor, Shift moves 10 pixels, Space places an outline point or applies a brush dab, Enter closes the polygon. Mask changes support touch/pointer strokes with pointer capture. Uploaded images and masks remain in memory for this session; they are not persisted across page reloads. Download PNGs and the protection mask to retain outputs.

## Provenance

This checkpoint uses local manual selection. No SAM model, Meta API, Baseten or paid inference is invoked. The real sample is the CC0 coffee photograph by Rachel Michetti, courtesy of Pikolo Espresso Bar, from scikit-image v0.25.2. Source and license references are in `public/dream/provenance.json`.

## Reproducible checks

- `npm run check`: typecheck, rendering/local API/unit suites, production build.
- `npx playwright test tests/browser/cup.spec.ts tests/browser/dream.spec.ts`: real photograph, sample outline, brush undo, approval, revision change, cleared-mask rejection, report invalidation, photo upload/invalid files/size limit, mobile canvas geometry, polygon tracing, downloads, original dream controls and reduced motion.
- `.artifacts/local-ai/venv/Scripts/python.exe scripts/verify_cup_export.py`: reads the actual downloaded mask, PNGs and WebM. Checks exact uncompressed protection, changing background, decoded dimensions/duration, frame timestamps, and lossy cup-region error at five points. Requires NumPy, Pillow, ffmpeg and ffprobe.

Browser evidence is under `.artifacts/cup-tests/`. Exact preservation is measured on 289 uncompressed frames. WebM uses lossy compression and must not be described as pixel-exact. The transition remains the existing ripple/reveal, not generated image-to-video motion.

## Verified result (2026-10-29)

47 offline tests and 5 browser tests passed, with typecheck and production build passing. The tested photo mask protects 21,041 compositor pixels with zero changes across 289 sampled frames. The downloaded video is 800 x 450, about 12 seconds, with strictly increasing timestamps. Five decoded samples have protected-region mean channel error under 3/255, due to lossy encoding. See `REAL_CUP_RESULTS.json`. No POST requests occurred during the photo selection/export browser test.

## Included review evidence

The validated sample run is saved in `docs/real-cup-demo/`: [exported video](real-cup-demo/cup.webm), [mask editor](real-cup-demo/editor.png), [transition preview](real-cup-demo/transition.png), first/last PNG frames, the protection mask, and raw quality/export reports. These use the bundled CC0 sample photo; no private uploads or credentials are included.
