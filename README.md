# Frame lab — working title: Framelock

A separate object-editing prototype for the Meta hackathon. The final product name is undecided. Change `src/brand.ts` when the team chooses it; the current repository name is also provisional.

The first slice is **select an object → preview a colour correction → approve or discard → export or undo**. It does not yet generate films, understand spoken directions, or detect continuity errors automatically.

## Run locally

Use Node.js 22.12+ (Node 24 was used for verification) and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4317**. No API key is needed for the sample.

1. Select **Use sample selection**. The highlighted cup uses an original, hand-authored mask, **not SAM output**.
2. Choose Cobalt or another colour, then **Preview correction**.
3. Compare Original, Selection and Correction. The pixel report measures changes against the normalized source frame.
4. **Approve** to unlock **Export PNG** and **Save evidence**. Or discard the proposal.
5. **Undo correction** restores the original. Changing the source clears selections and approvals.

The sample illustration and mask were authored for this prototype. They are deliberately reproducible, do not make model calls, and cannot be applied to arbitrary uploads. Uploading another image requires the live SAM connector to select an object. PNG/JPEG files are normalized to PNG and fitted within 1600 × 1600 pixels before editing. The original retained in the editor is this normalized working frame.

Edits are held in memory. Export to keep the result; refreshing starts a new session. Export is currently a still PNG, not a video.

## Connect SAM later

Live Meta calls were deferred at the owner's request. The connector is implemented and tested with a documented parser fixture and a stubbed HTTP transport; account access, model quality and live latency remain unverified.

Copy `.env.example` to `.env.local` and enter your key locally:

```dotenv
META_API_KEY=your-key-here
SAM_MAX_REQUESTS=10
PORT=4317
```

The key is server-only. Never use a `VITE_` prefix for it, put it in source code, or commit `.env.local`. Open **SAM not connected → Check connection** after saving. A configured key is not proof of successful authorization. Only selecting **Find object with SAM** sends the displayed image and object name to Meta. The health check makes no Meta request.

The server uses `sam-3.1` at `https://api.meta.ai/v1/responses` with Meta's `@meta-sam/parser`. It accepts one object concept and pairs decoded, cropped masks with source-pixel bounds. A completed zero-match response asks the user to try a different selection; it is not proof that an object is absent. Incomplete, malformed and mismatched results are rejected. Multiple matches require an explicit object choice.

The app applies colour locally using the mask and source HSL lightness. SAM does not repair the image. The outside-mask pixel comparison checks edit containment, not semantic correctness of the chosen mask. Object IDs belong to a single SAM response and are not cross-shot identity guarantees.

This prototype binds to loopback only, checks the request origin and a session token, limits calls per server process, and disables SDK retries. The request count is not a monetary spending cap; restarting resets it. Images and keys are not written by the API. Review and harden authentication, persistent budgets, storage and deployment settings before hosting it for other people.

## Verification

```sh
npm run check
npm run test:e2e
npm run format:check
```

The browser suite uses installed Google Chrome. If it is unavailable, install Chrome or change the Playwright browser configuration. The tests use synthetic/local data and do not call Meta.

- Unit and API tests cover source hashes, mask placement and holes, HSL correction, outside-mask changes, stale proposals, approval/undo, request limits and the official parser/SDK request format.
- Browser tests cover the offline workflow, actual downloaded PNG pixels, upload reset, keyboard controls and desktop/tablet/mobile accessibility checks.
- Generated screenshots, downloads and traces are stored under ignored `.artifacts/` and `test-results/` folders.

For the production bundle:

```sh
npm run build
npm start
```

## Project map

| Path                                           | Responsibility                                                |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `src/App.tsx`, `src/components/FrameStage.tsx` | Accessible editing controls and visual comparison             |
| `src/lib/correction.ts`                        | Mask placement, colour correction and pixel verification      |
| `src/lib/session.ts`                           | Source-bound proposals, approval and undo                     |
| `src/lib/sample.ts`, `src/lib/media.ts`        | Original sample and browser image handling                    |
| `server/sam.ts`                                | Input validation, real SAM request and official mask decoding |
| `server/app.ts`                                | Local API, request admission and errors                       |
| `docs/BUILD_NOTES.md`                          | First-build evidence, limits and team handoff                 |

All application code and sample artwork in this replacement project were newly authored for this build. Existing Fylmer application modules, user data and assets were not copied. Dependency terms are listed in `THIRD_PARTY_NOTICES.md`. The repository's existing Apache 2.0 project license is retained.

Primary technical references: [SAM prompting](https://dev.meta.ai/docs/sam/segmenting), [output semantics](https://dev.meta.ai/docs/sam/reading-segmentation), [official client libraries](https://dev.meta.ai/docs/sam/client-libraries).
