# Native permission review terminal audit findings

Audited revision: `6f6f5b99a649f12cb7e959dc949fa17293839796`, branch `permission-review`.
The findings below describe the audited revision; the remediation section records subsequent fixes and verification. See the [F02 audit](../../development/f02-audit.md).

## BUG-20261113-F02-002: Fullscreen mode cache rejects a new backend incarnation

- **Priority / scope:** P2; fullscreen TUI `PermissionProvider` reconnect hydration.
- **Observed:** After showing `review` at revision 3, the TUI received `server.connected` and fetched the new backend's `{ mode: "manual", revision: 0 }`, but continued rendering review mode. Two mode reads completed. Repeated rendering while waiting for manual mode did not correct the state.
- **Expected:** A new backend incarnation starts in manual; reconnect hydration must replace the previous incarnation's cached state. A subsequent `/auto` should enable review on the new backend.
- **Reproduction:** Render the actual SDK, Route, Args and Permission providers against a controlled HTTP/SSE transport. Initially return review/revision 3. Change the GET response to manual/revision 0 and emit `server.connected`. Verify the second GET and inspect `usePermission().mode` after rendering.
- **Root cause:** The reconnect callback calls `hydrate()` without clearing `store.states`. The revision guard accepts only revisions at least as large as the old value, even though revisions are process/Session-incarnation state and reset after backend restart.
- **Minimal correction:** Clear or replace the old mode cache at the existing reconnect boundary before applying the authoritative response, while retaining ordering protection within an incarnation. The App already clears its cache on reconnect.
- **Verification:** An actual OpenTUI render of the production providers failed the expected `mode:normal` assertion: before `mode:review`, backend manual/revision 0, after `mode:review`. The test uses a controlled new-incarnation response; it does not restart any user app or backend.
- **Audit status:** Unfixed at `6f6f5b99`.

## BUG-20261113-F02-003: Default mixed-host attachment leaves native review on the compatibility path

- **Priority / scope:** P2; fullscreen TUI native Session attachment to the normal mixed server.
- **Observed:** Open a native Session with canonical admitted input using default `attach <url> --session <id>` against the mixed host. `/auto` displays `Auto-review on`, but the native endpoint remains `{ mode: "manual", revision: 0 }` and no native review is enabled.
- **Expected:** The native Session's review toggle and status must belong to the backend, while actual legacy Sessions retain the compatibility classifier.
- **Reproduction:** Start the existing permission fixture with `{ mixed: true }`, which creates a native Session and an admit-only native prompt. Attach the fullscreen TUI without overriding `--session-protocol`, wait for the composer, and submit `/auto`. Read that Session's native mode endpoint after the on-screen success toast.
- **Root cause:** Automatic terminal transport selection uses server-level legacy health. A mixed host answers that route, so the entire terminal selects compatibility without considering the selected Session's established native history. `PermissionProvider` consequently changes only its local review mode. This is separate from the App's already-fixed native identity detection.
- **Minimal correction:** Reuse existing Session identity/native-history evidence when selecting the terminal path for an established native Session. Keep explicit compatibility selection and actual V1 Sessions on their existing path; no second review engine is needed.
- **Verification:** The real fullscreen PTY showed the enabled toast while the backend remained manual/revision 0. Both mini and fullscreen passed all five original acceptance checks on the same mixed fixture when explicitly launched with `--session-protocol native`, establishing a working workaround.
- **Limit:** The supplementary default mixed mini probe timed out after submitting `/auto`; its screen did not establish a successful command outcome. That timeout is not counted as a separate confirmed defect or a passing acceptance case.
- **Audit status:** Unfixed at `6f6f5b99`. Explicit native selection was a workaround at that revision.

## Remediation (2026-11-14)

- **BUG-20261113-F02-002:** `PermissionProvider` clears the incarnation-scoped mode map when `server.connected` arrives, then hydrates from the authoritative backend. A small connection counter rejects responses from the old connection while the existing revision comparison still orders updates within the new one. The actual provider render now verifies revision 3/review to revision 0/manual, `/auto` enabling revision 1, and a stale revision 0 event not changing the next toggle's meaning.
- **BUG-20261113-F02-003:** Automatic transport selection accepts an optional known Session ID and consults its canonical native history when server-level health selects V1. Empty history and missing native routes preserve compatibility; authorization/provider errors do not silently select a different engine. Fullscreen startup and mini attach validation pass the selected Session ID into that existing selector. Explicit native/compatibility choices remain cached and do not probe history.
- **Real terminal verification:** `bun script/permission-review-tui.mjs --mixed` and `--mixed --fullscreen` now pass all **5 checks each** without a native override, including backend `/auto`, one reviewer, active manual approval and live fallback. The prior default mixed mini timeout is superseded by this direct passing verification.
- **Automated verification:** The combined review, scope, protocol, terminal-render, event and HTTP command passed **66 tests / 360 assertions**. The protocol cases cover native, legacy and missing native history plus 401/403/500 responses and preservation of explicit choices.

The first committed-fixture attempt imported Route/Permission providers through package subpaths that are not public exports, and typed an async fetch wrapper without Bun's `preconnect` member. The fixture was corrected to use direct source imports for those private providers and preserve `fetch.preconnect` on the wrapper. The original errors and typecheck failures were fixture preparation errors, not evidence of a product fix.

## BUG-20261114-F02-U1: Bottom-right feedback obscures permission actions and Tabs guidance

- **Scope:** App/Desktop toast placement; audit U1 and N2-02, one shared layout cause.
- **Observed:** At 1280×633 the center of Allow once hits the mode toast instead of its button. Desktop's first-run Tabs card also overlaps and truncates mode feedback.
- **Expected:** Permission actions remain clickable during mode feedback, and both toast text and Tabs guidance remain readable.
- **Reproduction:** Start an isolated browser/Desktop Session, enable `/auto`, immediately hold a pending review, inspect `elementFromPoint` at the Allow once center and click that exact coordinate. Keep the first-run Desktop Tabs card visible.
- **Root cause:** Toasts and permission actions share the lower-right screen area; the fixed Tabs card uses that area too. Raising z-index cannot make all three readable and clickable.
- **Fix:** Place App feedback at the upper inline end, below the title bar, through the existing application ToastRegion wrapper. Configure both legacy Kobalte and current Sonner regions; leave shared UI defaults alone.
- **Verification:** `GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true bun script/permission-review-ui.mjs browser`, `mixed`, `builtin` from `packages/apexo`: **14 / 16 / 13 checks**. A visible mode toast is required during the center hit test; an actual mouse-down/up settles the held request, and the Tabs card rectangles do not intersect the toast. Production screenshots were inspected. Desktop was rebuilt from the changed source with its own authenticated backend. No z-index or toast auto-dismiss workaround is used.

## BUG-20261114-F02-U3: Mini lacks documented agent and permission-mode controls

- **Scope:** Split-footer mini runtime and composer; audit U3.
- **Observed:** Tab, Shift+Tab and Ctrl+O do nothing; `/always-approve` has no matching command; the label always says BUILD.
- **Expected:** Tab selects primary agents; Shift+Tab cycles Normal → Plan → Auto-review → Always-approve; Ctrl+O and `/always-approve` toggle explicit full auto. Full auto replies once and does not invoke the reviewer or save grants.
- **Reproduction:** Attach mini to an established native Session and press the documented keys, then submit an ask-policy tool action.
- **Root cause:** Only variant cycling and `/auto` were wired through the mini footer. Agent state and explicit full-auto handling were absent.
- **Fix:** Wire the existing keymap actions and shared mode order to the runtime, use canonical native agent/mode methods, render the actual agent and permission mode, and send one existing permission reply per pending request in explicit full auto. Mode hydration/reconnect/events use the existing native stream.
- **Verification:** Production render regression verifies shortcuts and slash selection without prompt submission. `permission-review-tui.mjs` with no flags, `--fullscreen`, `--mixed`, and `--mixed --fullscreen` passes **11 checks each**, including real agent/mode keys and an actual full-auto command with zero reviewer calls. `permission-review-cli.mjs` additionally verifies native-local mini full auto and clean exit.

## BUG-20261114-F02-U4: App permission dock ignores Escape

- **Scope:** App/Desktop permission dock; audit U4.
- **Observed:** Escape leaves an actively reviewing permission pending even though the question dock and terminal provide keyboard rejection.
- **Expected:** Escape rejects the focused permission request once; responding, repeated and composing keystrokes cannot duplicate replies.
- **Reproduction:** Open a held native review in browser/Desktop and press Escape without clicking a button first.
- **Root cause:** The permission dock neither focuses an action on mount nor handles Escape.
- **Fix:** Focus its first action, handle Escape on the existing dock root, stop propagation, honor responding/repeat/composition guards, and expose the shortcut on Deny.
- **Verification:** Real browser, mixed App and rebuilt own-sidecar Desktop acceptance all press Escape immediately after the reviewing dock appears, assert no pending request, wait for the drain to stop and inspect the visible permission-denied result.

## BUG-20261114-F02-U6: Denied Bash looks completed or hides the policy reason

- **Scope:** Core Bash/runner error presentation, mini scrollback and native headless output; audit U6.
- **Observed:** Mini labels an error without an exit code `bash completed`; headless rejection says only `Unable to execute command`.
- **Expected:** Denial never implies process execution or successful completion; the operator sees the permission reason in text and machine output.
- **Reproduction:** Reject a real mini Bash prompt; separately run an ask-policy Bash action under native headless reject in default, JSON and streaming-JSON formats.
- **Root cause:** Bash's final label checks only exit metadata; its expected typed failure adapter erases PermissionV2.BlockedError. The runner uses a generic interrupted label for an explicit permission decline.
- **Fix:** Render failed Bash state before exit metadata, retain the typed blocked reason as `Permission denied; command was not executed`, and identify explicit permission decline when settling interrupted tools. Preserve ordinary interruption/question semantics and existing headless exit status.
- **Verification:** Regression checks failed versus completed labels. A real native headless test verifies the denial text, no marker file and no reviewer call. `permission-review-cli.mjs` passes **8 checks**, including all three headless formats and real local mini denial; all four attach PTY combinations also verify rejection. Browser/Desktop show the canonical declined-tool reason.
