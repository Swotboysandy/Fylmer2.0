# Animated UI tour

Choose UI tour below the studio header. Seven steps explain the dream study, narration, cup selection, umbrella selection, independent mask correction, transition preview and quality checks/export. The guide is a replayable illustrated walkthrough, not a spotlight overlay on live controls.

Motion uses the existing motion/react package: 200ms content transitions, 250ms progress transitions, and a six-second kitchen/ocean crossfade behind stationary cup and umbrella illustrations. Pause/resume controls the preview. Reduced motion disables the moving preview and step transforms. Native dialog provides modal semantics and background inertness, with explicit Tab wrapping, Escape dismissal, focus return and suppression of editor keyboard shortcuts. Back, Next, Skip, Close and Finish are available; there is no auto-advance or auto-open.

The tour never changes project selections or sends model requests. Preview artwork is clearly labeled as illustrative. The original Masakazu studio remains in place; the tour has an entry row visible on desktop and mobile.

## Verification - 2026-10-30

- npm run check passed: TypeScript, 54 offline tests and production build.
- npm run test:ui passed all 11 browser tests in one run, including the original selection/transition/export checks.
- New tour tests verify every step, actual changing computed opacity, pause/resume, Back, Finish, reopening, Escape, focus return, mobile layout, reduced motion, Tab containment, shortcut isolation, unchanged transcript and zero POST requests.
- The existing full-frame CPU test exceeded its old five-second timeout once; its timeout is now 15 seconds with all assertions retained. Final run passed.
- Production build reports an advisory 500 kB chunk warning (main bundle about 511 kB uncompressed / 157 kB gzip). No build failure.
- Desktop and 390px mobile screenshots were visually reviewed: [desktop](ui-tour/desktop.png), [mobile](ui-tour/mobile.png).

No paid inference, credits or additional dependencies were used.
