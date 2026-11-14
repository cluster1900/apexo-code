# BUG-20261113-001: Native permission review needed authoritative context and atomic settlement

- **Scope:** Native Core permissions, Bash execution scope, canonical Session inputs, Client/SDK contracts, mini/fullscreen TUI, App and Desktop.
- **Observed:** The native permission path had no backend contextual reviewer. Compatibility clients could classify requests independently, and manual settlement used interruption masking without serializing sibling, cancellation and automatic outcomes. User-role history did not distinguish operator intent from generated or imported input.
- **Expected:** Static policy stays authoritative; one backend review can approve only the exact live action once. Human settlement, new admissions, mode changes and interruption revoke late results. All native clients read the same state and retain active manual controls.
- **Reproduction:** With a native Session configured to ask for Bash, submit an operator instruction and a tool call, connect multiple clients and inspect pending permissions. Before F02 there was no native mode endpoint, review status or provenance-aware reviewer.
- **Root cause:** Frontend classifiers were a V1 compatibility mechanism. Native pending permissions had neither private execution evidence nor a Session settlement gate; canonical input admission did not persist origin.
- **Fix:** Store `session_input.origin` through the durable event/projector chain, defaulting old events to `unknown`. Capture exact Bash cwd/shell/command/environment policy and bounded Git push facts privately. Perform one isolated tool-free model request with bounded concurrency, time and token budgets. Coordinate final settlement and invalidation with the existing admission fence and one Session gate; join review fibers after releasing it. Expose native mode and live status; remove native frontend classifier calls.
- **Conservative boundaries:** Confined commands whose fixed environment is not attested by the host scope reader, unsupported tools without an authoritative action capture, dynamic/compound shell commands, wrappers, custom Git behavior and unresolved ref destinations remain manual. A reviewer never creates a saved grant or overrides a configured/inherited denial. Only the last five promoted, nonwithdrawn operator inputs still in effective context can authorize an action.

## Verification

All commands run from `packages/apexo`, unless explicitly stated otherwise:

- `bun test test/v2/permission-review.test.ts`: actual native runner, static policy, input provenance, admission/mode/manual/interruption races, sibling rejection, timeout/provider/malformed/budget fallback, exact retries and event replay. Git publication tests target only isolated local bare repositories.
- `bun test test/v2/permission-review-scope.test.ts`: resolved Git defaults, credentials redaction, changed HEAD/remote fingerprints and manual fallback for unsupported scope.
- `bun test test/e2e/v2-permission-review.e2e.test.ts`: **2 passed, 42 assertions**, using pure and mixed real HTTP hosts. Covers authoritative origin, mode revisions, concurrent-client/reload reads, active manual replies and forged external request metadata.
- `bun script/permission-review-tui.mjs` and `bun script/permission-review-tui.mjs --fullscreen`: **5 checks each**, including `/auto` backend toggles, one held provider review, a usable manual reply during streaming and live fallback reason.
- `bun script/permission-review-ui.mjs browser`: **8 checks**. `mixed`: **10 checks**. `builtin`: **8 checks**. Production App and rebuilt Electron Desktop with its own backend exercised mode toggles, all three enabled manual actions, reload without a second reviewer, streamed fallback reason and explicit approval.

The initial development runs caught a harmless `GIT_PAGER` environment false positive and ambiguous Git destination handling. `GIT_PAGER` is presentation-only and is accepted; execution-changing environment variables still require manual approval. Automatic Git capture supports branch destinations only and rejects unqualified deletion or non-branch targets instead of presenting guessed refs to the model. The actual scope tests retain these assertions.

The final focused native review/scope, normal retry and event-inventory command passed **41 tests / 244 assertions**. Task/operator-message, Schedule and Workflow origin regressions passed **8 tests / 127 assertions**. Full repository typechecking passed all 21 packages, and the complete unit gate passed all 18 batches. Client/SDK generated-source checks passed; the HTTP gate passed 360 scenarios each in coverage, auth and effect modes. The [F02 implementation report](../../development/f02-implementation.md) records the exact commands and production composer comparison. Controlled local providers verify behavior and isolation; they do not measure a real model's judgment quality.

## Bounded transport attempts

Source inspection found that `RequestExecutor` normally retries retryable HTTP status failures twice. One `llm.stream` call alone therefore did not establish the F02 no-retry guarantee. The executor now accepts a per-call `MaxRetries` context value while preserving its existing default; only permission review supplies zero. A real local 503 fixture asserts exactly one review HTTP attempt and a still-usable manual reply. Normal Session transport retry behavior remains covered by the existing native hardening regression. No pre-fix F02 503 execution is claimed from source inspection alone.

## BUG-20261113-003: Compatibility Sessions misidentified by mode endpoint availability

- **Observed:** In the real mixed-host browser, `/auto` on a legacy Session changed the native backend mode to `review`, rather than retaining the V1 review owner. The original browser assertion reported `review !== manual`.
- **Expected:** Native review uses the backend; legacy requests retain their compatibility classifier and preference.
- **Root cause:** Both runtimes share Session storage, and the mode endpoint can address either Session ID. A successful mode GET therefore does not prove native execution identity. A blank shared Session also has no native transcript yet.
- **Fix:** Reuse the selected protocol and existing native markers, and consult canonical native admission history for unclassified Sessions. Do not infer identity merely from the mode response. Keep shared blank records on the selected compatibility path until native use is established. The mixed/Desktop fixture explicitly admits native input without execution before opening a Session created outside the App; this establishes real native history without adding a new engine flag or model request.
- **Reproduction/verification:** `bun script/permission-review-ui.mjs mixed` retains the original failure evidence and subsequently passed **10 checks**, including two connected clients, native mode/full-auto separation and a legacy Session whose local review toggle leaves backend mode manual.

Review payloads also redact URL credentials from verified instructions and model reasons, in addition to resolved Git URLs. The final focused command passed **41 tests / 244 assertions**, including private-input and live-event assertions plus URL userinfo containing an additional `@` in the password.
