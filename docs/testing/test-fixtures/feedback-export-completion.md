# Feedback Export Completion Assertion

## BUG-20261014-047 — Existing save notice satisfied the export wait

- **Status:** Fixed and verified.
- **Verified recurrence count:** 2.
- **Affected scope:** Feedback terminal acceptance export step.
- **Observed behavior:** The test tried reading the exported Markdown file before it existed.
- **Expected behavior:** The export action completes before the fixture validates its bytes.
- **Reproduction:** Save/review a draft, start its Markdown export, then wait for a generic `Saved ` screen substring.
- **Root cause:** The prior `Saved locally. Not submitted.` notice already matched that substring, so the test advanced before the asynchronous file creation completed.
- **Fix:** Wait for the specific output file to exist before reading and checking its content. Keep the original deadline and no-overwrite export implementation.
- **Verification:** Rerun pending. No production code changed.

Final verification: `bun script/grok-feedback-tui.mjs` and `bun script/grok-feedback-tui.mjs --fullscreen` from `packages/apexo`, Bun 1.3.14, both passed 10 checks. These runs exercised real PTYs, exact-revision save/review, Markdown export, conflict recovery, and confirmed deletion with zero model turns or external submissions.

## Independent image-export fixture occurrence

The first new mini image-export probe again waited for the generic `Saved ` notice. The earlier draft-save notice satisfied it before `feedback.html` existed, causing ENOENT in the fixture. This repeated the same fixture mistake; it did not establish an export defect. The new probe now observes actual file existence, export-editor closure and idle state before reading bytes. `bun script/grok-feedback-images-tui.mjs` and the same command with `--fullscreen` each passed seven checks, including exact original embedded bytes after the selected source changed and refusal to overwrite an existing export. Two independent episodes are recorded; no new recurring constraint is created.
