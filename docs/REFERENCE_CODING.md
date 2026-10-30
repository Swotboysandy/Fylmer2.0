# Local reference coding

XERJ v1.0.0-rc.100 is installed at `%LOCALAPPDATA%\Programs\xerj\xerj.exe` and added to the user PATH for new terminals. The Windows release archive was SHA-256 verified:
`a58f293c1002c4ce5ce1793afd6fa4d3e7a509916a34044c91a38d4a53937812`.
Official installation/reference: https://xerj.org/llms.txt (CLI help is authoritative).

## Commands (PowerShell 7, from this project)

```powershell
pwsh -File scripts/reference-coding.ps1 start
pwsh -File scripts/reference-coding.ps1 status
pwsh -File scripts/reference-coding.ps1 index -Corpus anchorshot
pwsh -File scripts/reference-coding.ps1 search -Corpus anchorshot -Query "applyDreamSelections"
pwsh -File scripts/reference-coding.ps1 search -Corpus ref-prompt-kit -Query "PromptInputTextarea"
pwsh -File scripts/reference-coding.ps1 search -Corpus ref-sam2 -Query "add_new_points_or_box"
```

`index -Corpus all` refreshes all six corpora; add `-DryRun` to estimate without indexing. Run `scripts/setup-reference-repos.ps1` to create missing pinned shallow/sparse clones. Existing checkouts are verified, never reset. Pins and checked-out scopes live in `reference-repositories.json`; updating pins is explicit.

## Storage and limits

Runtime cache: `F:\Sandy\S+Study\AnchorShot-reference-coding` (sibling of project). It contains `repos`, `data`, `state`, `logs`, `node.pid` and `xerj.toml`. Index data is outside every indexed source root. Service uses loopback ports 9237/9238/9239, no TLS/auth for local development. No Windows startup task was installed; use `start` after reboot. CLI workflow is configured; no claim is made that a live MCP tool was registered in this chat.

The initial C: location was moved because C: was nearly full. F: had about 4.7 GiB free. This dedicated node uses a 99% disk write-block threshold (retaining about 2.25 GiB on this volume), a 2 GiB memory-budget base, two indexing workers, and a 256 MiB estimated-index cap per corpus. Memory budget is not a hard OS RSS limit. Do not disable disk protection to expand this corpus. Revisit storage before indexing larger repositories.

Search is local BM25/identifier retrieval (`--no-semantic`, code analyzer). It is not neural semantic search. No embedding API, paid model, reranker, or feedback report is used. No model weights or repository dependency installers run. Repository search does not execute reference code.

## Sources and reuse

- Prompt Kit (MIT): prompt composition, submission, auto-sizing textarea.
- shadcn/ui (MIT): published accessible React UI components.
- OpenCut (MIT): editor organization and timeline; this pinned version includes a Rust desktop editor and a React web surface, so treat desktop patterns as architecture, not drop-in React components.
- Motion (MIT): animation lifecycle and reduced-motion handling.
- Meta SAM 2 (Apache-2.0): point/box correction, masks and video tracking. It is not an API-equivalent substitute for the hackathon SAM gateway.

Root licenses are retained in clones; check file-level notices before copying. Project source, tests, scripts and text docs are indexed including uncommitted UI changes. Credentials/dotfiles, public media, generated output, binaries, lockfiles and dependency trees are excluded via `.xerjignore` and built-in ignores. Reference corpora additionally omit JSON/YAML data, notebooks and media.

## Before coding

Follow AGENTS.md: refresh the local index, query both local code and the nearest reference, inspect the cited source, record pin/file/lines and the chosen adaptation, then implement and test. Search misses require narrower identifiers or direct source inspection, not invented retrieval results. `search` prints relative paths: resolve them against the project root or the corresponding cached checkout.


## Verified retrieval examples

All six corpora completed with exit 0, with no dataset refusals and zero junked code files. Initial indexed source counts: AnchorShot 111; Prompt Kit 167; shadcn/ui 93; OpenCut 87; SAM 2 272; Motion 729. Reference indices contain 7,894 searchable records (definitions and documents, not unique files). AnchorShot is refreshed again after this setup documentation.

| Corpus / query | Verified source | Why it matters |
| --- | --- | --- |
| anchorshot / applyDreamSelections | src/services/cupSelection.ts:224 | Independent masks are composed with overlap rejection; inspect before changing multi-anchor behavior. |
| ref-prompt-kit / PromptInputTextarea | components/prompt-kit/prompt-input.tsx:112 | Controlled input, sizing and submission live in the upstream component. |
| ref-shadcn-ui / TabsTrigger | apps/v4/registry/new-york-v4/ui/tabs.tsx:58 | Current v4 uses slot/variant selectors. Do not blindly replace the app's older New York components with it. |
| ref-opencut / timeline | apps/desktop/src/shell.rs:6 | Panels are instantiated once to preserve state; desktop Rust pattern is architectural only. |
| ref-sam2 / add_new_points_or_box | sam2/sam2_video_predictor.py:162 | Object-specific prompts; point/label validation and box ordering must be respected. |
| ref-motion / useReducedMotion | packages/framer-motion/src/utils/reduced-motion/use-reduced-motion.ts:37 | This pin snapshots the preference in state and contains a TODO for automatic updates, despite a broader comment above. Inspect implementation and installed-version behavior before assuming live preference changes. |

Pins in `reference-repositories.json` identify the source of every example. These are retrieval checks, not execution of the reference applications or models. No application code was changed for this tooling task. Previous uncommitted UI work remains intact.


## UI reference retrieval
UI work follows the same retrieval-first rule. Verified query `PromptInputWithActions` in `ref-prompt-kit` resolves to `components/blocks/prompt-input-actions.tsx:14` and its separate documentation example. The block combines a rounded composer, action row, voice button and submit control. It includes demonstration handlers, so integration must replace those callbacks without restyling the block. A whole editor replacement is a separate scope from using this composer block.

AGENTS.md now explicitly requires upstream visual inspection, component fidelity, original styling, functional action wiring and desktop/mobile screenshot comparison for UI tasks.
