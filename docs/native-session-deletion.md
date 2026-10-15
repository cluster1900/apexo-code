# Native Session deletion

The implementation is integrated. Scoped native CLI and rebuilt Desktop backend acceptance passed; UI acceptance passed; complete repository verification is still in progress.

## Contract and ownership

`SessionV2.remove(id)` retires the current Session incarnation, cancels and joins its registered owners, removes its descendants and durable Session aggregate, invalidates its Hook snapshot, and settles required Goal cleanup receipts. Missing and repeated deletion succeed. The native HTTP endpoint returns 204 and owns stored Location resolution; it does not require an existing Session in request middleware.

A process-global lifecycle service separates short mutation admission from long-running ownership. Closing rejects new admission; already admitted writes settle before owner cancellation. Model drains, idle compaction, background jobs, Memory work and side questions register concrete cancel-and-join actions without holding a write lease across provider work. Ordinary interruption retains its existing behavior. Session execution remains process-global and discovers Location placement when draining.

Captured identities prevent delayed controls, snapshots, child setup, finalizers and reply readers from targeting a replacement that reuses a Session ID. Recursive removal captures each enumerated child's incarnation and rechecks parent ownership. Retired entries are removed after successful cleanup; there is no permanent tombstone. Failed partial retirement stays closed and retryable. Request cancellation stops waiting for deletion, while the service-owned retirement continues.

## Durable ownership

The original Session Created event identifies durable ownership across restarts and compaction. New Memory capture jobs and Scheduler records retain that evidence. A reused Session ID cannot authorize jobs admitted by its predecessor. Memory rollover archives old pending receipts and cursors, preserves committed notes, and namespaces new job and observation identities. Proven legacy capture snapshots receive durable evidence without rewriting their source bytes, so later compaction does not invalidate them.

Historical capture history with only receipts or cursors and no attributable jobs cannot be safely assigned an owner. It remains unchanged and manual capture returns `{status: "conflict", reason: "historical_capture_ownership"}`. The UI directs the user to a new Session. This is an explicit unsupported historical migration boundary, not automatic recovery or permission to discard notes. Other capture failures keep their existing result semantics.

Scheduler ownership validation is integrated with the shared lifecycle: new records retain the Created event; legacy recovery requires a matching completed scheduling tool receipt. Unproved records remain inactive, and ownership is checked again before each fire.

## Evidence and limits

Off-tree package verification passed 52 tests with 247 assertions across lifecycle/coordinator, recursive removal, background jobs, side questions, Memory rollover and Scheduler ownership, followed by 3 child-retirement tests with 15 assertions. Core and Apexo package typechecks passed. Real CLI historical Memory acceptance passed four checks: explicit conflict, repeat, restart preservation, and a fresh-Session positive capture. The existing real CLI Memory capture fixture passed 16 checks earlier in the draft.

Separate real CLI side-question cases verified delayed snapshot rejection and late-answer isolation through ID reuse and restart. The original provider socket-close assertion did not pass; cancellation/join and durable isolation do not establish physical HTTP connection closure. Installed Grok deletion evidence establishes cancellation settlement and durable removal after restart, not TCP teardown. See the [reference fixture limitation](testing/test-fixtures/reference-session-delete-socket-expectation.md).

Integrated verification passed 58 tests with 259 assertions across 16 focused files, including real native HTTP deletion and the additive Memory result contract. All 21 typecheck tasks passed. Client and legacy SDK generation completed, and Client generated-code reproducibility passed using an isolated Git index without changing the real index.

Real native CLI and rebuilt Desktop backend deletion each passed seven scenarios with three provider requests: idle admitted-input cleanup, repeated/missing deletion, ID reuse without old history, active cancellation and pending steer revocation, unrelated Session preservation, late-provider-response isolation, and restart persistence. Installed Grok 1.0.52 previously passed four corresponding deletion/cancellation checks with four provider requests; it is behavioral reference evidence, not execution of Apexo code.

The real Memory historical-owner fixture passed four checks on both CLI and rebuilt Desktop. Ambiguous history produced zero extraction requests; the fresh-Session positive control produced one. The seed uses production store writers in an isolated child with the fixture environment installed before Core imports; every seed and backend process was reaped. Mini and fullscreen terminals each passed three additional actionable-message, retry/reopen, and preserved-history checks. Browser and actual Desktop windows each passed six historical-Memory guidance/preservation checks across English, Simplified Chinese and Traditional Chinese, with zero extraction calls. Screenshots were inspected. These localized checks cover the new message; existing Traditional Chinese English fallback text elsewhere is not claimed as translated by this slice.

Native deletion UI acceptance passed seven checks in both browser and actual Desktop windows across the same three locales: cancelled confirmation preserves the Session, confirmed deletion removes and navigates away, and traffic contains exactly three native DELETE204 requests with zero provider calls.

[Scheduler durable ownership](native-scheduler-ownership.md) passed six checks each in CLI and rebuilt Desktop, with exactly two valid scheduled provider executions and zero stale/unknown-owner executions. The complete HTTP gate passed all 285 scenarios in each of coverage, authorization and Effect-handler modes, with zero failures, skips, missing routes or extras; all 264 Effect routes are covered. The complete unit gate finished with 3,997 passes, 19 skips, one todo and two failures: a compatibility missing-session response regression and a fixture that replaced lifecycle-aware execution with an unregistered coordinator. Both were corrected: the compatibility HTTP file passed 21 tests / 111 assertions, and the native lifecycle suite passed 20 tests / 69 assertions. The final aggregate gate, including the subsequent MCP preferences, Workflow model and compaction Hook slices, passed 4,017 tests with zero failures, 19 skips, one todo, 53 snapshots and 13,249 assertions across 348 files; all six Turbo tasks exited successfully. The final HTTP gate passed all 286 scenarios in each of three modes across 265 routes. This draft does not add crash recovery that retries model execution. Relevant prior fixes remain documented in [native execution cleanup](testing/runtime/native-session-delete-ownership.md) and [detached jobs](testing/runtime/session-delete-detached-jobs.md); their accepted evidence is distinct from this broader admission fence.

## Presentation and localization review

The new historical-ownership message uses the existing Apexo terms for Session
and capture. Terminology was checked against the maintained
[VS Code Simplified Chinese corpus](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-zh-hans/translations/main.i18n.json),
[Traditional Chinese corpus](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-zh-hant/translations/main.i18n.json),
[Mozilla History API documentation](https://developer.mozilla.org/zh-CN/docs/Web/API/History_API/Working_with_the_History_API),
and [Mozilla Traditional Chinese restoration corpus](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-TW/browser/browser/aboutSessionRestore.ftl).
The language-authority check for attribution used the
[MOE definition of 歸屬](https://dict.concised.moe.edu.tw/dictView.jsp?ID=17230&la=0&powerMode=0).
The complete attribution phrase remains a useful native-speaker review target;
no plural selection or untranslated code/product term is introduced.

The pre-change production composer sample had median 131 ms / warm-sample
p95 148 ms. The first post-change sample had median 143 ms / p95 378 ms, with one
outlier and no browser Long Task entries. Host load differed (approximately2.7
before versus9.0 during the first post-change sample), so this observation does
not isolate a product regression or establish its absence. A confirmation after the full unit run measured median 132.5 ms / p95 181 ms,
with samples `[140,132,138,176,128,137,109,113,120,181]`, no Long Task entries,
and host load about 6.9–7.3. The median is close to the original baseline,
but load remains higher and these small samples do not establish the cause of
tail-latency variance. All original measurements are retained.
