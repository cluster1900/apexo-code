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
