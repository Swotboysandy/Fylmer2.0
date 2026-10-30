# Clean studio UI

Built from the supplied layout sketches after inspecting Designeer and the shared conversation. Reference screenshots are in .artifacts/design-review (local, ignored).

## Direction
- Monochrome interface, self-hosted DM Sans, Radix accessible tabs, existing Motion interactions.
- Create: description/script input, large preview, transport and shot strip.
- Dream: existing independent cup and umbrella mask workflow, kept mounted across workspace switches.
- Review: existing continuity controls and inspector, revealed on demand.
- Updated animated tour instructions for the new navigation.

## Offline boundaries
Voice capture previously substituted a fixed demo command. Recording now reports unavailable transcription instead of pretending to interpret audio. Typed directions and the existing preset planner remain available. The sample storyboard does not represent arbitrary prompt-to-video generation. Dream exports and masks remain local; approved selections are session-only.

## Validation
- npm run check: TypeScript, 8 rendering tests, 1 local API test, 45 unit tests, production build passed.
- npm run test:ui: 13 browser tests passed, including two-object corrections and export, tab state preservation, keyboard navigation, mobile overflow checks, tour/reduced motion, and mocked SAM response validation.
- Desktop 1440px and mobile 390px screenshots inspected.
- No paid model calls. Build retains a bundle-size advisory (about 525 kB minified main JS).

This change is local and has not been committed or pushed.


## Published component follow-up
The custom input and control styling was replaced with published Prompt Kit PromptInput and shadcn/ui New York Tabs, Button, Slider, Textarea, and Tooltip. Component files match registry downloads exactly after import-path adaptation. Original markup and utility classes are retained. The prompt composer uses the upstream basic example composition with AnchorShot callbacks, labels, and disabled-state guards instead of its simulated timeout.

Sources, hashes, and MIT licenses: `docs/upstream-components/`. The surrounding AnchorShot layout and domain-specific shot thumbnails remain application code. The six reused controls are not described as a copied full application.

A neutral dark theme supplies the component tokens; previous bespoke control overrides were removed. The initial `--muted` variable collision was corrected. Prompt input, Shift+Enter, Enter submission, keyboard slider, and computed tab background are covered by a browser regression test.


## Creation-first follow-up
The first screen now contains the centered creation panel and persistent voice orb. Video, transport, shots and workspace navigation appear only after nonempty story context is submitted. Typing or testing the microphone alone does not reveal sample footage.

CreationComposer reuses Prompt Kit's complete components/blocks/prompt-input-actions.tsx block at pinned commit 5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a. Queries: PromptInputWithActions (ref-prompt-kit), handleRebuildFromTranscript (anchorshot). Adaptations: application callbacks and labels replace demo actions, unavailable review/tools are disabled before a story exists, and the outer placement wrapper uses normal flow instead of absolute positioning. Internal control styles remain upstream. The surrounding empty-state layout centers both axes and centers the heading/tabs without changing the composer styles. On the final spacing follow-up, XERJ was unavailable; the pinned reference file was inspected directly.

Latest follow-up: BeUI segment tabs copied from https://beui.dev/r/tabs.json into src/components/ui/beui-tabs.tsx with import adaptations only. The first screen has a viewport-contained centered composer, larger typography, clickable starting ideas, and hides project breadcrumbs until a story exists.
