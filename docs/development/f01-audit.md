# F01 structured review implementation audit

Date: 2026-11-13, Asia/Singapore. Audited code: `adfce4eca88d887ca0a02f4dfeb3d5fb0d16bd3e`
on `structured-review`; comparison base: `origin/main` at
`e4885b0378a0cd88b703133f435fd47383cff64a`. Scope: the F01 requirements and R01–R09
in [the agreed plan](codex-first-batch-plan.md), including the primary CLI,
mini/fullscreen TUI, production browser App and rebuilt macOS Desktop.

**Conclusion: the main implementation exists and its ordinary flows work, but
F01 is not completely accepted. Six confirmed defects remain, including one P1.**
This audit changed documentation only; it did not implement fixes, change the
production architecture, commit, push or merge. The existing implementation PR
[is still draft #206](https://github.com/cluster1900/apexo-code/pull/206).

## Confirmed findings

| Priority | Finding | Evidence and affected code | Minimal correction |
| --- | --- | --- | --- |
| P1 | Omitted CLI selection ignores the configured default model and agent. | A local-only run configured for `reviewfixture/z-preferred` and `reviewer` actually admitted and called `a-first` with `build`. Explicit flags worked. [BUG-20261113-001](../testing/runtime/structured-review-cli-selection.md#bug-20261113-001-native-review-overrides-configured-defaults-with-the-first-catalog-entries); `packages/apexo/src/cli/native-code-review.ts:134`. | Reuse native configured-default resolution instead of treating catalog order as a default. |
| P2 | App/Desktop passive refresh disables cancellation and history. | A held background GET disabled Cancel, Start, Refresh and report history in the browser and an actual Electron window. Releasing only the GET restored them. [Reopened App/Desktop portion of BUG-20261112-024](../testing/ui/structured-review-interface.md#2026-11-13-audit-follow-up-to-bug-20261112-024-appdesktop-still-block-actions); `packages/app/src/components/code-review-dialog.tsx:148`. | Reuse the terminal's separate passive-refresh state and response fencing. |
| P2 | Captured patches for wildcard-like filenames contain other files. | `[id].tsx` included `i.tsx`; its unchanged line 28 was falsely classified `inHunk` without a snippet. `star*.ts` also included a sibling patch. [BUG-20261113-002](../testing/runtime/structured-review-capture.md#bug-20261113-002-per-file-capture-interprets-literal-filenames-as-git-pathspecs); `packages/core/src/session/code-review-capture.ts:256`. | Use literal paths consistently in existing per-file Git commands. |
| P2 | A non-owner process can falsely acknowledge cancellation. | Backend B returned `cancelled`; A's actual child receipt remained `active` and later became `completed`, with an assistant report and 120 tokens. [BUG-20261113-003](../testing/runtime/structured-review-ownership.md#bug-20261113-003-a-peer-process-acknowledges-cancellation-without-stopping-the-owner); `packages/core/src/session/code-review.ts:376`. | Reject an active foreign-owner cancellation unless the actual owner can be stopped and joined. Distributed scheduling is unnecessary. |
| P2 | A nonexistent explicit agent is silently accepted. | `--agent missing-review-agent` completed with exit 0 and real local provider execution, although the catalog contained no such agent. [BUG-20261113-004](../testing/runtime/structured-review-cli-selection.md#bug-20261113-004-a-nonexistent-explicit-review-agent-is-accepted). | Validate explicit agent selection before admission, using existing rules. |
| P2 | Fullscreen PageDown closes the review dialog. | One PageDown after the completed/ready state returned to the composer, at normal 120×40 size and in the 80×24 investigation. [BUG-20261113-005](../testing/ui/structured-review-interface.md#bug-20261113-005-fullscreen-review-pagedown-dismisses-the-dialog); `packages/tui/src/component/code-review-browser.tsx:143`. | Capture scroll keys through existing higher-priority modal bindings, as Task and Goal dialogs do. |

All six findings were unresolved at the audited revision. Browser and Desktop reproductions of the same
refresh lock are one defect; they are not invented historical recurrence counts.
No new recurring rule or generalized infrastructure is proposed.

## Requirement-by-requirement assessment

| Acceptance | Assessment | Evidence and limits |
| --- | --- | --- |
| R01 — target capture | Pass for tested normal targets | Staged/unstaged/untracked, ignored tracked/forced files, split indexes, base and commit tests pass. Additional real Git probes verify a root commit and first-parent merge semantics. Real authenticated PR #206 capture resolves the audited head, captures 88 files with no exclusions and removes temporary refs. The actual clean Apexo checkout captures zero changes without changing index bytes or HEAD. |
| R02 — file types and limits | Partial | Rename, deletion, additions, external symlink entries, conflicts, submodules, binary and oversized exclusions pass. Additional probes verify the 500-file and 5 MiB limits. Literal wildcard-like names fail as described above. |
| R03 — read-only role | Verified shared boundary | The actual fabricated Bash call is rejected and does not create its marker. Code inspection confirms only `review_diff` and `review_read` are advertised/settled; other tool names use the same rejection branch. Clean/process-filter nonexecution and real-index preservation tests pass. No separate execution engine or external Grok/Codex runtime dependency was introduced. |
| R04 — report normalization | Partial | Malformed output gets one tool-free repair; exhausted repair budgets fail. Invalid paths are isolated, invalid ranges become file anchors, exact duplicates are removed and ordinary outside-hunk snippets work. The filename defect can produce false hunk membership. |
| R05 — frozen evidence | Pass for tested cases | Snapshots-disabled fixtures retain captured untracked content after edits, detect stale state and do not substitute the live file. Reload does not sample again. Missing captured content is excluded/downgraded; an additional probe removes the actual captured blob after a live edit to verify no live fallback. |
| R06 — lifecycle | Partial | Exact/conflicting retries, parent deletion, bodyless cancellation, dead-owner recovery and live-owner preservation pass. A shared-database peer can falsely acknowledge cancellation. No clustered execution support is required to reject that case honestly. |
| R07 — CLI outputs and budgets | Pass for tested execution paths | Text/JSON/streaming, priority threshold, export, ephemeral cleanup, invalid output, missing usage, turn/token/cost limits, native fallback and SIGINT/SIGTERM handling pass in the focused and neighboring runner suites. Signals produce confirmed cancelled runs and exits 130/143. |
| R08 — interfaces | Partial | All four surfaces can start, configure targets/focus, view history/findings and cancel in ordinary operation. Browser and Desktop show real line highlights, outside-hunk snippets, file-level anchors and stale state without replay. The App refresh lock and fullscreen PageDown conflict remain. Machine evidence is rendered through the existing frozen review panel, separately from human-comment callbacks. |
| R09 — CLI compatibility | Partial | Attached execution, auth rejection before admission, explicit model selection, client-local export, cleanup and generic output-schema compatibility pass. Default selection and nonexistent agent handling violate the stated selection contract. Multi-host deployments and every provider-specific variant were not certified. |

## Actual verification

All commands below were run from their package directories unless the root is
explicitly named. Programmable local providers exercised real Apexo execution;
they do not establish the quality of a live model's code review.

| Check | Result |
| --- | --- |
| `bun test --timeout 60000 test/v2/code-review.test.ts test/cli/code-review.test.ts test/cli/run-review-options.test.ts` in `packages/apexo` | 21 passed, 149 assertions. |
| Native headless runner, output, guardrails, event manifest and slash regressions (six files) | 25 passed, 278 assertions. |
| `packages/sdk/js`: `bun test --timeout 30000 test/code-review.test.ts` | 1 passed, 6 assertions; real local HTTP capability/auth responses. |
| App pure structured-review slash test | 1 passed, 3 assertions. The neighboring component-bearing slash test fails to import `jsxDEV`; see the limitation below. |
| `bun script/code-review-tui.mjs --large` | Mini 120×40: 14 checks passed, including single-key cancel during a held passive refresh. |
| `bun script/code-review-tui.mjs --fullscreen --large` | Fullscreen 120×40: the same 14 ordinary-flow checks passed. The supplementary PageDown test exposes the missing shortcut boundary. |
| Audit extensions of the PTY flow | Mixed-host mini and fullscreen: 14 ordinary-flow checks each. Mini 80×24: 14 checks. Fullscreen 80×24 exposed the scrolling defect; it is not recorded as a pass. |
| `bun script/code-review-ui.mjs mixed` | Production browser on normal mixed host: 18 checks passed. |
| `bun script/code-review-ui.mjs builtin` | Rebuilt Electron window using its own authenticated sidecar: 18 checks passed. No external backend substitution in this check. |
| Browser/native held-refresh probes | Both reproduced the disabled Cancel/Start/Refresh/history state; releasing the GET restored operation. Native probe uses the controlled backend to hold that exact response. |
| `bun script/code-review-process-isolation.mjs` | All 3 original live-owner preservation checks passed. The supplementary peer-cancel probe exposes the separate defect. |
| `bun script/code-review-signals.mjs` | SIGINT/130, SIGTERM/143 and auth rejection before admission passed. |
| `bun script/code-review-live-pr.mjs https://github.com/cluster1900/apexo-code/pull/206` | Completed at audited head `adfce4ec`, 88 files, no exclusions, no remaining temporary refs. Read-only remote operation. |
| `bun script/code-review-status-performance.mjs` | 6,279 tracked fixture files; 20 ordinary polls: median 3.83 ms, p95 5.87 ms. Explicit workspace comparison: 7,757 ms under concurrent audit load; it detected a subsequent edit. This is a measurement, not a performance guarantee or an independently diagnosed regression. |
| App and Desktop production builds | Both passed. Desktop used the supported local `MODELS_DEV_API_JSON` catalog input. |
| Root: `bun turbo typecheck --concurrency=2` | 21/21 successful, all valid Turbo cache hits. Direct `bun typecheck` also passed in Apexo, Core, TUI, App and Desktop. |
| Root: `GITHUB_ACTIONS=false bun turbo test --concurrency=2` | 6/6 tasks successful, 4 cached. Apexo's 18-batch success was a cache replay, not a fresh whole-suite run in this audit. The focused runtime tests above were freshly executed. |
| `bun run check:generated` in Client, then legacy JS SDK | Both exited 0; no generated-source drift. Writers were completed before subsequent SDK runtime checks. |
| `bun run test:httpapi` in `packages/apexo` | Completed successfully: coverage inventory 354, authentication 354 and Effect 354; zero failed, skipped, missing or extra scenarios in each mode. |
| Focused Effect HTTP review routes with progress/trace | All 5 review scenarios passed. Successful start/result/cancel behavior was additionally exercised by the real CLI/UI fixtures. |

The existing PR's required `typecheck` and `unit (linux)` checks were green at the
audited head when queried. Green CI does not cover the six supplementary failure
cases above and is not grounds to merge around them.

## Evidence handling and limits

- [Normalized machine-readable evidence](f01-audit-evidence.json) retains the selection, pathspec, cancellation, UI-lock, scrolling, target/limit and timing observations without temporary paths or credentials. The records above describe their reproductions using the existing fixture exports and actual Core services.
- The previously recorded [App `jsxDEV` unit-runner limitation](../testing/test-fixtures/structured-review-fixtures.md#bug-20261112-015-the-optional-app-unit-runner-cannot-import-solid-jsx) remains unresolved. This audit reproduced one affected entry point. Production Vite and Electron rendering are separately verified; no successful pre-feature App unit baseline is claimed.
- Initial sandbox listener denials and inability to write frozen Git objects in the repository were resolved by running those probes with the required local permissions. They are not product bugs. The clean-checkout capture then verified unchanged index bytes and HEAD.
- The complete serial HTTP Effect run took substantial CPU time but finished successfully. Its earlier lack of per-scenario output was not recorded as a product hang. Likewise, the small-terminal snippet timeout was investigated before identifying the actual PageDown conflict.
- Verification is macOS source/rebuilt-product acceptance. Linux/Windows GUI behavior, signed installers and live provider review quality are outside the evidence obtained here. Test-owned servers/windows were shut down; existing user app/server processes were not restarted.

Recommended next step: make the six bounded corrections above, add focused
regressions at their existing boundaries, and repeat the affected acceptance
cases. No new orchestration layer, persistence table, cluster coordinator or
general-purpose UI state framework is needed.

## Remediation after the audit (2026-11-13)

The six findings above were corrected after the audited `adfce4ec` revision. The audit observations and normalized evidence remain historical; they are not evidence that the final fixes were present in that revision.

| Finding | Correction and new evidence |
| --- | --- |
| Configured defaults | CLI leaves omitted model/agent choices to native resolution; local and attached requests select a non-first configured model and the configured agent system marker. Variant-only and explicit overrides pass. |
| App/Desktop refresh lock | Separate passive state and response fencing; production browser and rebuilt own-sidecar Desktop each pass 22 checks, including actual cancel, history selection and new admission while a GET is held, then release without losing the new selection. |
| Fullscreen PageDown | Existing high-priority modal bindings own PageUp/PageDown. Mini/fullscreen 120-by-40 and fullscreen 80-by-24 each pass 16 real PTY checks using overflowing captured evidence. |
| Literal filenames | All capture Git commands use literal pathspecs. A real Git regression isolates `[id].tsx` and `star*.ts` patches and preserves an outside-hunk snippet instead of a false hunk anchor. |
| Foreign-owner cancellation | A peer returns 409 before changing active durable state. Six process-isolation checks verify the actual owner stays active and later completes, while terminal cancellation remains idempotent. No distributed scheduler was added. |
| Missing explicit agent | Both CLI and Core validate before admission; native tests require zero new review rows and zero provider work. |

The final focused native/CLI/compatibility command passes 22 tests / 172 assertions. Fresh production composer measurements are 221 ms median before and 167.5 ms after; see the performance record for all samples and limits. Final mandatory repository gate results are recorded in [the implementation checkpoint](first-batch-implementation.md). The existing App `jsxDEV` runner limitation and live-model-quality limitation remain. The PR remains draft and must not be merged without user review.
