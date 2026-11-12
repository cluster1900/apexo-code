# First-batch implementation checkpoint

Branch: `structured-review`. Scope: F01 structured code review from [the development plan](codex-first-batch-plan.md). F04 and F02 remain out of scope. [PR #206](https://github.com/cluster1900/apexo-code/pull/206) remains draft and unmerged for user review.

## Implementation

- Canonical CodeReview contracts and generated Promise/Effect/V2 clients; one `session_code_review` table with additive migrations, including process ownership.
- Host-side uncommitted/base/first-parent commit/PR capture, bounded persisted patches/snippets, frozen reads and explicit coverage. The shared Git service copies the real index, expands split indexes and refreshes only eligible literal candidates. Staged deletions/renames and ignored tracked/forced files are retained; the real index and HEAD are unchanged. Repository clean/process filters stay inert; symlinks remain link entries.
- Native managed review children reuse the Session coordinator and provider runner with only `review_diff` and `review_read`. Independent child admission does not wait for a busy parent turn. Findings are normalized and validated individually, deduplicated and downgraded to file-level anchors when needed; invalid paths cannot discard valid findings. Output gets at most one tool-free repair.
- Durable reports, exact retries, timestamp-ordered history, cross-Session ID conflicts, targeted cancellation and parent ownership. Restart recovery reuses the existing conservative dead-process check and does not interrupt another live process or replay sampling.
- CLI text/JSON/streaming output, priority threshold exits, budgets, validated explicit models/fallbacks, safe specific provider errors, export and ephemeral cleanup. Compatibility errors identify the actual conflicting flag.
- Mini/fullscreen and browser/Desktop review actions provide targets/focus, history with time/target, priorities, frozen evidence and cancellation. The App retains one local read-only `/review` action and `/reviews` alias. Availability probes the actual route independently of Session transport, supporting normal mixed hosts and Desktop's own backend.
- Ordinary detail reads are persisted status reads. Only `compareWorkspace=true` requests advisory comparison; active polling omits it. Immutable targets display a frozen-revision label. TUI passive refresh does not hold the mutation lock and stale responses are fenced by identity. Actual in-hunk highlights, outside-hunk snippets and file-level findings use the existing diff panel, separate from human comments.
- All new App copy uses typed i18n keys with existing fallback. No unverified translations or separate orchestration engine were added.

## External review remediation verification

The initial completion claim was premature: its small fixtures and external-native Desktop backend missed real repository, default-host and multi-process defects. The following checks cover those reported failures on the remediation sources; they supersede the earlier interface verification.

| Check | Result |
| --- | --- |
| Native/CLI focused tests | 15 passed, 110 assertions; includes ignored/forced files, split index, staged deletion/rename, external symlink, safe paths, busy parent, model validation and dead/live ownership |
| CLI and compatibility regressions | 8 passed, 60 assertions |
| SDK real HTTP capability regression | 1 passed, 6 assertions, including 404/405 and authorization failure |
| App pure review routing regression | 1 passed, 3 assertions |
| `bun script/code-review-process-isolation.mjs` | Three checks passed: peer startup, separate local CLI, original result preservation; two provider calls |
| `bun script/code-review-ui.mjs mixed` | 18 checks passed using the final production App against normal mixed `apexo serve` |
| `bun script/code-review-ui.mjs builtin` | 18 checks passed using rebuilt Desktop's own authenticated sidecar; no external backend substitution |
| `bun script/code-review-tui.mjs --large` | 14 checks passed in a real mini PTY, including single-key cancellation during held passive refresh, target replacement and cancelled copy |
| `bun script/code-review-tui.mjs --fullscreen --large` | The same 14 checks passed in a real fullscreen PTY |
| `bun script/code-review-status-performance.mjs` | 6279 tracked files; 20 ordinary polls: 0.623 ms median, 0.902 ms p95; explicit comparison 1018 ms, detecting a subsequent edit |
| `bun script/code-review-capture.mjs` on the Apexo checkout | Passed on the final changes: 48 captured files, zero exclusions, 4633 ms; real index bytes and HEAD unchanged |
| App and Desktop production builds | Passed; Desktop uses the supported local `MODELS_DEV_API_JSON` catalog input |
| Production composer comparison | Final timing recorded in the [performance record](../testing/performance/structured-review-composer.md) |
| Root typecheck | Passed, 21/21 tasks on the remediation sources |
| Root aggregate tests | Passed, all 18 Apexo batches and 6/6 Turbo tasks |
| Client and legacy SDK generated checks | Both passed with no generation drift |
| Complete HTTP API command | Coverage/auth/Effect modes each passed 354 scenarios; zero failed, missing or skipped |

Provider execution uses a programmable local fixture without real model credentials. These checks prove Apexo behavior and request construction, not quality or availability of every live provider.

Earlier F01 checks also exercised real GitHub PR capture, first-parent/root commits, SIGINT/130 and SIGTERM/143, bodyless cancellation, fabricated mutation-tool denial, budgets, output repair and no-replay reload. The prior live PR capture was read-only and resolved the then-current head; it is not a capture of the remediation commit.

The supplementary App unit runner still has three Solid `jsxDEV` import errors, as recorded in the [fixture record](../testing/test-fixtures/structured-review-fixtures.md). It is separate from the five required gates and is not claimed as passing or fixed. Actual production browser and Electron rendering pass the checks above.

The five required gates ran sequentially in the prescribed order: root typecheck, root aggregate tests, Client generated check, legacy SDK generated check, then the complete HTTP API command. All passed on the remediation sources.

Bug evidence: [capture](../testing/runtime/structured-review-capture.md), [ownership/model errors](../testing/runtime/structured-review-ownership.md), [interfaces/performance](../testing/ui/structured-review-interface.md), [CLI compatibility](../testing/runtime/structured-review-cli-compatibility.md), [types](../testing/types/structured-review-composition.md), [fixtures](../testing/test-fixtures/structured-review-fixtures.md). No historical recurrence counts or new recurring constraints were invented.

Do not merge PR #206 until the user has reviewed and authorized it; required GitHub Actions checks must also pass before any merge.
