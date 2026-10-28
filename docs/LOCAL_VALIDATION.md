# Offline scene and GPU validation

Keep work on rendering-checkpoints. Masakazu's components/layout remain the UI foundation.

## Run
1. Start npm run dev -- --host 127.0.0.1 --port 4317.
2. Choose a fixture, correct its flagged shot, and open Animatic Monitor.
3. Play, pause or scrub the timeline. Transitions dissolve over the final second (half the shot for shots under two seconds). Disable the checkbox for hard cuts. Reduced motion uses cuts.
4. Export local test bundle. It includes images, mask, revisions, timings and transition preference.
5. Run:
   python scripts/validate_local_video.py "PATH-TO-DOWNLOADED-BUNDLE.json" --output .artifacts/local-validation/my-run
6. Read scores.json and play storyboard-nvenc.mp4 in that folder.

Requirements: Python with numpy and Pillow, FFmpeg/ffprobe with h264_nvenc, working NVIDIA driver. No model weights or model API calls. The runner refuses non-embedded PNG input and does not fall back to a CPU encoder.

The browser ignores model credentials and restricts connections to itself and local development sockets. Fonts are bundled locally. Existing model names in controls/logs identify fixture interfaces, not live inference.

## Measurements on 2026-10-28
RTX 3050 Laptop, 4 GB VRAM. Each scene: 4 images at 800x450, 14.5 seconds, 435 frames at 30 fps.

| Fixture | Outside mask preserved | Edited pixels | Encode pipeline fps | PSNR dB | Mean absolute channel error |
| --- | --- | --- | --- | --- | --- |
| Diner / cup | 100% | 6843 | 159.76 | 42.141 | 1.111 |
| Harbor / umbrella | 100% | 46065 | 151.47 | 41.903 | 1.130 |
| Courier / jacket | 100% | 37605 | 164.99 | 43.723 | 1.074 |

All 1305 encoded frames decoded and were compared with their intended composition; durations and frame counts matched.
All 12 images decoded and were nonblank. All 9 transitions were sampled at their midpoint; each of the 3 available fixture-mask selections preserved its source pixels exactly at that midpoint.
GPU memory observations are device-wide samples, not process allocations or a guaranteed peak (638 / 648 / 735 MiB maximum sampled in these final runs). Other applications affect results.
Browser checks passed for corrections in all fixtures, transition toggling, forward scrubbing, pause, completion at 14.5 seconds and replay from the end. Browser error/warning log was empty during the test.

## What the scores mean
- Mask preservation compares PNG-decoded RGBA before and after correction, independently of the UI's stored score.
- PSNR and channel error compare decoded compressed video to expected local composition. They measure encoding fidelity, not cinematic quality.
- Luma deviation/nonblank checks catch empty output; they do not assess prompt adherence.
- Composition is CPU numpy; encoding is actual NVIDIA NVENC. This is not neural-network GPU inference.
- A fixture mask is a rounded bounding region. It is not a measured SAM segmentation. Only shots with masks get selection hold.
- Selection holds for 75% of the dissolve, then blends out over the final 25% to avoid a jump at the next shot. It does not guarantee cross-shot identity.
- The MP4 is silent. Browser narration is not an exported audio track.
- No trained image/video model, live SAM quality, semantic scene score or hackathon API integration has been validated.
- Browser CSS and the Python compositor follow the same blend formula; pixel-exact browser-to-export equivalence has not been measured.

## Remaining checkpoints
Trained local provider feasibility, audio assembly, UI-triggered MP4 export, and a complete generated-story demo remain pending. No paid credit should be used as a substitute for those checks.
Narration selects installed local voices only; it stays silent if none are available. Dependencies retain the existing Vite/esbuild peer mismatch; font installation used --legacy-peer-deps without changing those versions.
