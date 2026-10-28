# First working slice — 28 October 2026

Working title: Framelock. Final naming is not decided. The four-person team is entering the Indie Developer track.

## Implemented

- A standalone React/TypeScript app and local Express server, with independent dependencies.
- An original sample scene and explicit offline mask, plus PNG/JPEG upload.
- Live SAM 3.1 connector using the Responses API and official Meta parser. No automatic model calls.
- Object selection, overlay, cropped-mask placement, ambiguity handling and source revision checks.
- Local masked colour correction, original/preview comparison, explicit approval/discard, undo and PNG export.
- Exportable evidence with the source hash, mask provenance, correction parameters and measured changed-pixel counts.
- Keyboard controls, status/error announcements, optional browser speech output, reduced motion and responsive layouts.

The user requested offline development for now. There has been **no live Meta model validation and no Meta spend in this build**. The sample must never be presented as a model-generated segmentation.

## Evidence

- TypeScript check and production build pass.
- 20 unit/API/SDK contract tests pass using local fixtures and a stubbed network transport.
- 7 Chrome browser tests pass, including 1440 px desktop, 768 px tablet and 390 px mobile layouts.
- The actual downloaded sample PNG changes 42,848 pixels inside the supplied cup mask and zero outside it.
- No browser page errors occurred during the full edit/export/undo test.
- Axe reported no violations for the checked WCAG 2 A/AA and 2.1 AA rules after the contrast fixes. Automated checks and a keyboard walkthrough do not establish complete accessibility or user research; a screen-reader and blind/low-vision user walkthrough remains to be done.

Local artifacts are intentionally untracked. Tests recreate them in `.artifacts/`.

## Scope still to build

1. Verify one live SAM call with a user-provided key and explicit permission to use it. Test real images, multiple objects, empty results, occlusion and imperfect masks.
2. Add voice transcription and a structured directing agent. Current speech output reads authored/status text; it is not scene understanding.
3. Add three-shot planning, image generation, approved continuity rules and visible mismatch checks.
4. Persist projects and approvals, then add narrated animatic/MP4 export.
5. Only after the still workflow is reliable, try tracked correction on a short imported clip.

## Four-person handoff

| Owner              | Next work                                                              |
| ------------------ | ---------------------------------------------------------------------- |
| Director agent     | Transcription, validated shot/rule schema and approved tool actions    |
| SAM and checks     | Real-provider validation, ambiguous objects and review evidence        |
| Editing and export | Mask edge quality, persistence and later animatic/video assembly       |
| Interface and demo | Screen-reader/user testing, clear descriptions and honest demo capture |

Keep shared identifiers tied to immutable sources. A new source must invalidate old selections and proposals. Changing a colour invalidates a pending proposal. Never automatically accept a repair because the pixel containment test passes.
