# First-batch implementation checkpoint

Branch: `structured-review`. Scope: the first Core/CLI slice of [the development plan](codex-first-batch-plan.md).

## Implemented

- Canonical CodeReview input, finding, report and progress contracts, with generated Promise, Effect and existing V2 SDK clients.
- One additive `session_code_review` table and generated Core migration.
- Host-side uncommitted/base/first-parent commit/PR target capture, private Git index, bounded patches and explicit coverage exclusions.
- Native managed review children using the existing coordinator and provider runner. Only `review_diff` and `review_read` are exposed; fabricated mutation tools fail at settlement.
- Host validation, duplicate removal, outside-hunk snippets, invalid-line downgrade and at most one tool-free JSON repair using the same input budget.
- Durable reports, exact retry, targeted cancellation, parent lifecycle ownership and restart reconciliation without provider replay.
- Native review HTTP start/list/get/diff/cancel routes, including an empty-body cancellation request.
- CLI text/JSON/streaming output, threshold exit status, model options, inherited budget accounting, export, ephemeral cleanup and explicit compatibility dispatch.

## Verification

| Check | Recorded result |
| --- | --- |
| Root `bun turbo typecheck --concurrency=2` | Passed, 21 tasks |
| `bun test test/v2/code-review.test.ts test/v2/headless-runner.test.ts` in `packages/apexo` | Passed, 15 tests / 133 assertions |
| `bun test test/cli/run-review-options.test.ts test/cli/code-review.test.ts` in `packages/apexo` | Passed, 8 tests / 54 assertions |
| `bun run script/httpapi-exercise.ts --mode effect --include v2.codeReview --fail-on-missing --fail-on-skip` in `packages/apexo` | Passed, 5 scenarios; no missing or skipped routes |
| Root `GITHUB_ACTIONS=false bun turbo test --concurrency=2` | Passed, all 18 Apexo batches and 6 Turbo tasks |
| Core `bun run script/migration.ts --check` | Passed |
| `bun run check:generated` in `packages/client` and `packages/sdk/js` | Both passed with no regeneration drift |
| `bun run test:httpapi` in `packages/apexo` | Coverage, auth and effect modes each passed 354 scenarios; zero failed, missing or skipped |

The Git fixtures cover staged/unstaged/untracked files, frozen reads, symlinks, base and first-parent commit selection, renames, deletions and binary exclusions. Native fixtures cover authority, report validation, budget/usage failure, repair, restart and cancellation. The subprocess CLI fixtures exercise the actual local host, generated SDK requests, exports and both output modes.

A subsequent native/CLI run passed 10 tests / 71 assertions, including real attached-server capture and parent deletion. Authenticated live GitHub PR capture, remote authentication failures, OS signal delivery and real interactive-window acceptance have not been recorded. F01 presentation work, F04 MCP forms and F02 permission review remain subsequent plan slices.

Implementation/test failures and their fixes are recorded under [runtime](../testing/runtime/structured-review-capture.md), [CLI compatibility](../testing/runtime/structured-review-cli-compatibility.md), [types](../testing/types/structured-review-composition.md) and [fixtures](../testing/test-fixtures/structured-review-fixtures.md).

The feature is submitted for review only. Do not merge until the user has reviewed and authorized merging; required GitHub Actions checks must also pass.
