# Rendering checkpoints

Branch: rendering-checkpoints
Foundation: Masakazu's UI merged on main at 185270f.
Scope: Sandy's editing, morphing, export and integration role. Offline fixtures first.

| Checkpoint | Acceptance | Status |
| --- | --- | --- |
| 0. Adopt merged UI | Build and TypeScript pass on merged baseline; no replacement UI | Complete |
| 1. Mask-safe correction | Use actual mask alpha, preserve every outside RGBA pixel, attach verification to revision, reject failed/no-op edits | Implemented; five targeted tests pass |
| 2. Transition preview | Deterministic dissolve, available mask selection hold; playback and scrubbing | Complete offline; see LOCAL_VALIDATION.md |
| 3. Local video provider | Replaceable render adapter; benchmark representative shot on available GPU | Pending |
| 4. Export | FFmpeg assembles frames and audio into playable MP4; duration and streams verified | Pending |
| 5. Integration | Wire generation, correction, preview and export into the merged UI; demo a complete story | Pending |

## Current evidence
- RTX 3050 Laptop GPU: 4096 MiB VRAM. Model choice must follow a measured feasibility test.
- Python 3.10 and FFmpeg executable available. No model downloaded or GPU inference proven.
- Corrections operate on offline generated alpha masks, not live SAM inference.
- Verification compares decoded canvas RGBA buffers before PNG export. It proves mask containment, not semantic correctness or cross-shot identity.
- Five Node tests cover mask holes, outside RGB/alpha mutations, dimensions, invalid masks, no-op rejection and transparent pixels.
- No API spending or existing Fylmer changes.

## Reproduce
Run npm run lint, npm run test:rendering and npm run build.
Open the local preview, wait for four shots, apply the shot 2 blue-cup correction, and export JSON. The new revision includes pixelVerification.
- Browser smoke check passed: shot 2 correction created revision 2 and changed the sequence from 3 consistent/1 discrepancy to 4 consistent/0 discrepancy.

GPU encoding and measured image/video validation now pass for all three fixtures. See LOCAL_VALIDATION.md for evidence and explicit limits; neural inference and audio export remain pending.
