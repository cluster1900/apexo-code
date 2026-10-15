# Feedback Draft Review

This feature uses Apexo's own Session database, permissions, canonical native tool registry, compatibility tool registry, App and terminal interfaces. Grok Build is a behavioral comparison, not a product runtime dependency.

Session feedback is local until the user submits the prepared GitHub issue themselves. Both App composer layouts provide a Feedback button and `/feedback`; the dialog lists saved drafts, creates or edits title/details/type and optional classification, saves a revision, previews the exact prepared issue, and confirms deletion. Editing after review removes the preview. A stale save or delete fails without overwriting the newer revision, and typed text remains available for recovery.

Review saves the current fields and requests the prepared issue for that exact saved revision. Opening the GitHub form does not mark a draft submitted or delete it. The preview exposes copy and Markdown download; oversized drafts explain that the body must be copied or downloaded into the external form. The application never sends a real issue automatically.

Mini and fullscreen terminal clients use the same stable-root draft panel through a local `/feedback` command, without invoking the main model. It supports list/load/new, title/details/product-area editing, type/task/failure classification, save/review, exact-revision deletion, copying, and Markdown export. Local file export uses exclusive creation and never overwrites an existing file. Only an explicit open-form key opens GitHub; the panel retains the local draft afterward.

## Verification

- App and TUI package typechecks passed. Parent integrated typecheck passed all 21 tasks.
- `bun script/grok-profile-desktop.mjs` from `packages/apexo`: native profile lifecycle and actual CLI/provider contract verification passed with feedback included in the Grok profile.
- `bun script/grok-feedback-tui.mjs`: 11 real mini PTY checks passed, including clearing optional metadata for a new draft, exact-revision editing, Markdown export, stale-editor conflict recovery, cancel/confirm deletion, and zero main-model turns or external submissions.
- `bun script/grok-feedback-tui.mjs --fullscreen`: all 11 corresponding real fullscreen PTY checks passed.
- `bun script/grok-feedback-ui.mjs native` and `bun script/grok-feedback-ui.mjs desktop`: each passed 12 checks against the corrected production build, covering actual native Electron and browser/App with bundled Desktop backend. Both exercise create/save/type selection, reload persistence, exact-revision edit/review, actual Markdown download, review invalidation on edit, stale-revision recovery, cancel/confirm deletion, and large-draft fallback. The tests intentionally never click the external issue-form action. [BUG-20261014-049](testing/ui/feedback-dialog-scroll.md) records the corrected scrolling and fixture interaction.
- The fresh before/after composer benchmark is recorded separately in [the performance report](testing/performance/feedback-composer-baseline.md). The feedback dialog is dynamically imported only when opened.

Fixture corrections and verified type-boundary fixes are recorded under [BUG-20261014-044](testing/types/feedback-ui-wire-types.md), [BUG-20261014-045](testing/test-fixtures/feedback-terminal-screen.md), [BUG-20261014-046](testing/test-fixtures/feedback-terminal-emulator.md), and [BUG-20261014-047](testing/test-fixtures/feedback-export-completion.md).

## Localization review

English and Simplified Chinese copy cover every visible App control, error, status, and enum label. GitHub, Markdown, and Shell are retained as product/format/established developer terms. Draft/save/review/submit wording was cross-checked against [Microsoft Q&A's localized draft documentation](https://learn.microsoft.com/zh-cn/answers/support/drafts), [Microsoft's localized designer controls](https://learn.microsoft.com/zh-cn/power-automate/flows-designer), [GitHub's localized debugging documentation](https://docs.github.com/zh/get-started/learning-to-code/learning-to-debug-with-github-copilot), and the [Firefox Simplified Chinese preferences corpus](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-CN/browser/browser/preferences/preferences.ftl). Product-specific model-failure classifications such as overcorrection and subagent overspawn remain candidates for native-speaker terminology review. Terminal copy follows the existing English terminal UI convention.

## Shared store and API contract

The `send_feedback` tool saves a draft belonging to its own Session after leaf permission authorization. An explicit `draft_id` updates exactly that draft; a missing ID fails without appending a replacement. The store strips repeated draft IDs from user-facing fields while preserving intentional blank lines. Native V2 execution uses canonical `Tool.make` with captured database/permission services and never bridges through the compatibility prompt loop.

Drafts have title, details, type, optional product area/task category/failure mode, timestamps and revision. Transactions preserve identity and reject stale expected revisions. Each text field is limited to 64 KiB of UTF-8, with 1000 drafts and an 8 MiB serialized limit per Session. Deleting a Session cascades only its own drafts. A persisted Session's location takes precedence over a directory hint; draft ownership is always checked against the target Session.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/session/:sessionID/feedback` | List local drafts |
| POST | `/session/:sessionID/feedback` | Save fields; optional `draft_id` and expected `revision` |
| POST | `/session/:sessionID/feedback/:draftID/review` | Require `{ revision }`; prepare exact title/body/URL without sending |
| DELETE | `/session/:sessionID/feedback/:draftID` | Require `{ revision }`; remove only the reviewed version |

The native Server exposes these operations under `/api/session/`; image snapshots add the exact-revision operation documented in [Feedback images](feedback-images.md).
They share the Core draft store and resolve the persisted Session's Location
through native middleware. Draft management does not create a user prompt,
start execution, or invoke the model's tool permission flow. The App selects
the native or compatibility client from the detected server protocol.

Review never automatically attaches a transcript, credentials, Session ID or draft ID. An oversized prepared URL falls back to the plain issue form while retaining the complete body for export/copy. Opening the form does not mark the draft submitted or remove it.

## Backend and comparison evidence

With pinned Bun 1.3.14, from `packages/apexo`:

- Native management checkpoint: `bun test test/e2e/v2-feedback-management.e2e.test.ts test/e2e/v2-feedback.e2e.test.ts` passed 3 tests and 38 assertions against native-only routes, including an explicit 404 check for the legacy route. The same tests passed again after Hook service integration.
- `bun script/grok-feedback-parity.mjs cli --native` passed eight scenarios with six provider requests, including real process death/reopening. A fresh `grok-feedback-official.mjs` comparison passed three scenarios with ten requests. `bun script/grok-feedback-parity.mjs desktop --native` passed the same eight scenarios/six requests after the shared production build. The subsequent native macOS Electron window passed twelve checks after correcting the shared native CORS boundary.
- The production browser passed twelve native-only Feedback actions, and the compatibility browser passed twelve regression actions after protocol routing changed. The native window also passed twelve checks; browser and window evidence remain distinct.
- `bun script/grok-feedback-parity.mjs cli` and `bun script/grok-feedback-parity.mjs desktop`: eight cases each, including real model save/update/missing-ID failure, review without sending, foreign-Session denial, stale deletion, actual process death/reopen, and reviewed deletion. Each used five provider requests.
- `bun test test/e2e/v2-feedback.e2e.test.ts`: two native HTTP/runner tests and 19 assertions covering allowed storage, denied visibility/execution, failure continuation and native Session review.
- Eight store tests passed with 36 assertions. The affected four-file store/HTTP/registry suite passed 43 tests and 120 assertions. The complete HTTP API coverage/auth/effect gate subsequently passed 247 scenarios per phase.
- `bun script/grok-feedback-official.mjs`: installed Grok 1.0.52 passed three local-draft comparisons with ten provider requests, with host home, Grok home and XDG directories isolated. The pinned upstream `send_feedback` source filter passed ten tests; those establish reference behavior, not Apexo test coverage.

[Image attachments](feedback-images.md) now use Apexo-owned database snapshots and portable exports. The official direct-submission endpoint and raw draft-file format remain differences. This project deliberately prepares an editable issue in its own issue tracker; it does not send feedback to the official service. Complete Windows/Linux acceptance remains open. The earlier [HTTP teardown investigation](testing/test-stability/feedback-http-teardown.md) retains its unconfirmed root-cause status even though later suites passed.
