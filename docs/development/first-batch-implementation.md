# First-batch implementation checkpoint

Branch: `structured-review`. Scope: F01 structured code review from [the development plan](codex-first-batch-plan.md). F04 and F02 are not part of this implementation.

## Implemented

- Canonical CodeReview input, finding, report and progress contracts, generated Promise/Effect/V2 SDK clients, one additive `session_code_review` table and a Core migration.
- Host-side uncommitted/base/first-parent commit/PR capture, private Git index, bounded patches, frozen reads, explicit coverage exclusions and inert repository filters.
- Native managed review children using the existing coordinator/provider runner, with only `review_diff` and `review_read`; host location validation, deduplication, outside-hunk snippets, file-level downgrade and one bounded tool-free JSON repair.
- Durable reports, exact retries, targeted cancellation, parent ownership and restart reconciliation without provider replay. Native HTTP start/list/get/diff/cancel routes retain bodyless cancellation.
- CLI text/JSON/streaming output, priority threshold exits, budgets/model selection, export, ephemeral cleanup and explicit compatibility dispatch.
- Mini and fullscreen `/review` (alias `/reviews`) actions: target/focus editing, start/status/cancel, paginated history, priority filtering, finding navigation and scrollable captured evidence. Compatibility servers receive an explanation instead of review admission.
- Browser and Desktop Code review button and `/review` / `/reviews` palette actions in both composer layouts. The dialog provides target selection, optional focus, durable history, status/cancel, coverage and priorities, report target details and the existing `ReviewPanelV2` for captured patches. Machine findings remain separate from editable human comments.
- Validated in-hunk line highlighting, captured snippets for outside-hunk evidence and file-level findings without fabricated line highlights. Historical preview has no live-file read fallback.
- Detail reads compare the current workspace with the captured HEAD/tree using an isolated private index and inert filters, returning `current`, `stale` or `unavailable` without replacing report evidence. In-flight UI requests are lifetime/selection fenced, and completed report browsing does not sample the model.
- All new App copy uses the typed English source dictionary and existing locale fallback. Unverified translations were not invented.

## Verification

| Check | Recorded result |
| --- | --- |
| Root `bun turbo typecheck --concurrency=2` | Passed, 21 tasks on the final sources |
| Native/CLI `bun test test/v2/code-review.test.ts test/cli/code-review.test.ts` | Passed, 10 tests / 76 assertions |
| `bun script/code-review-tui.mjs` | Passed, 11 checks in an actual attached mini PTY |
| `bun script/code-review-tui.mjs --fullscreen` | Passed, 11 checks in an actual attached fullscreen PTY |
| `bun script/code-review-ui.mjs browser` | Passed, 15 checks using the production App build |
| `bun script/code-review-ui.mjs native` | Passed, 15 checks in the rebuilt Electron Desktop window |
| `bun script/code-review-signals.mjs` | Passed: SIGINT/130, SIGTERM/143, targeted cancellation and remote authentication failure before admission |
| `bun script/code-review-live-pr.mjs https://github.com/cluster1900/apexo-code/pull/206` | Passed: authenticated host-side capture, 48 files, exact base/head IDs and zero remaining temporary refs |
| `bun run build` in `packages/app` | Passed |
| Desktop production build with the supported local `MODELS_DEV_API_JSON` input | Passed |
| Final root `GITHUB_ACTIONS=false bun turbo test --concurrency=2` | Passed, all 18 Apexo batches and 6 Turbo tasks |
| Final generated checks in `packages/client` and `packages/sdk/js` | Both passed with no regeneration drift |
| Final `bun run test:httpapi` in `packages/apexo` | Coverage, auth and effect modes each passed 354 scenarios; zero failed, missing or skipped |

The focused slash/parity regression passed five tests / 31 assertions after the first aggregate run identified missing alias wiring and an incorrect mini fallback classification. Both were fixed without parity exemptions.

The supplementary App unit command reports 85 passing tests and three Solid `jsxDEV` import errors; this unresolved runner limitation is recorded in the [fixture record](../testing/test-fixtures/structured-review-fixtures.md). It is not reported as a passing check.

The real Git fixtures cover staged/unstaged/untracked files, frozen reads, symlinks, base and first-parent commit selection, renames, deletions and binary exclusions. Native fixtures cover authority, budgets/usage, repair, restart, cancellation and parent deletion. The real interactive checks cover reopening/reloading without provider replay, captured evidence after a workspace edit, validated line highlighting, file-level highlight removal and cancelling a second review while retaining the first.

The live PR capture resolved base `e4885b0378a0cd88b703133f435fd47383cff64a` and head `14f11a69e86988babfbc63caca1cd3e756c8fcb2`. This was read-only verification of the existing PR; the current interface commit was not yet pushed at capture time.

The production composer median was 171.5 ms before and 189 ms after the final changes. Slow samples and correlated request delays are retained in the [performance comparison](../testing/performance/structured-review-composer.md); no claim of unchanged tail latency is made.

The final required gates were run in the prescribed order: root typecheck, root aggregate tests, Client generation check, SDK generation check, then the complete HTTP API command. All five passed.

Implementation failures and fixes are recorded under [capture/runtime](../testing/runtime/structured-review-capture.md), [CLI compatibility](../testing/runtime/structured-review-cli-compatibility.md), [types](../testing/types/structured-review-composition.md), [fixtures](../testing/test-fixtures/structured-review-fixtures.md) and [interfaces](../testing/ui/structured-review-interface.md).

The feature is submitted for review only. Keep PR #206 unmerged until the user has reviewed and authorized merging; required GitHub Actions checks must also pass before any merge.
