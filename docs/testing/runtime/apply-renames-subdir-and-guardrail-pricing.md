# BUG-20261101-704 — `ModelsDevPlugin` fabricated `$0` pricing for unpriced models, `--max-tokens` over-estimated base64 attachments pre-request, and `apexo apply` missed rename old paths and monorepo subdirectory batch manifests

- **Bug ID**: `BUG-20261101-704`
- **Category**: Runtime (`runtime`)
- **Affected Scope**:
  - `packages/core/src/plugin/models-dev.ts`
  - `packages/core/src/session/runner/llm.ts`
  - `packages/apexo/src/cli/attempts-worktree.ts`
  - `packages/apexo/src/cli/run-attempts.ts`
  - `packages/apexo/src/cli/cmd/apply.ts`
  - `packages/apexo/test/v2/apply-and-run-guardrails.test.ts`
- **Occurrences**: 1 independent review episode.

## Observed Behavior

1. `ModelsDevPlugin.cost(undefined)` in `packages/core/src/plugin/models-dev.ts` returned `[{ input: 0, output: 0, cache: { read: 0, write: 0 } }]` (`length === 1`) when a `models.dev` model omitted `cost`, causing `--max-budget-usd` (`primaryPricing.length === 0`) to treat unpriced built-in models as `$0` free models instead of failing closed.
2. `SessionRunner` in `packages/core/src/session/runner/llm.ts` gated `execution?.policy.maxTokens` before provider requests using `remainingInputTokens < estimatedInputTokens + 16` where `estimatedInputTokens` counted `JSON.stringify(llmMessages).length` (including base64-encoded image/PDF attachments) and `JSON.stringify(llmTools).length`, falsely terminating turn 1 with `budget_limit` on remote endpoints without an explanatory assistant error.
3. `diffTreesPatch` (`packages/apexo/src/cli/attempts-worktree.ts`), `listDirtyPaths` (`packages/apexo/src/cli/run-attempts.ts`), and `parsePatchSummary` (`packages/apexo/src/cli/cmd/apply.ts`) ran `git diff --name-only` / `git apply --numstat` with default rename detection enabled, omitting the old path of renamed/moved files from `changedFiles` so `--3way` index synchronization and `--3way --index` staging left the deleted old path unstaged or failed preflight when locally modified.
4. Passing a monorepo subdirectory path printed by `apexo run --attempts` (for example `.../attempts/<batch>/attempt-2/packages/pkg-a`) to `apexo apply <dir>` checked only `path.dirname(canonicalDir)` for `manifest.json`, missing the batch manifest and falling back to standalone `HEAD` diff without `baselineTree` or full-batch `--cleanup`.

## Expected Behavior

1. `ModelsDevPlugin.cost(undefined)` must return `[]` so unpriced built-in models have empty `model.cost` (while explicitly `$0` models with `cost: { input: 0, output: 0 }` retain their `$0` entry), ensuring `--max-budget-usd` fails closed before calling the provider.
2. `--max-tokens` must enforce exact accumulated provider token totals (`budgetLedger.tokens >= execution.policy.maxTokens` pre-turn and `stepSettlement.tokens` post-turn) without rejecting turn 1 on serialized base64 attachment byte length.
3. Candidate and patch `changedFiles` must include both old and new paths for renamed or copied files so `apexo apply --3way` and `--index` synchronize and stage both file removal and creation cleanly.
4. `apexo apply <dir>` must resolve the Git worktree root of `<dir>` before checking `path.dirname(worktreeRoot)/manifest.json` so passing any monorepo subdirectory inside an attempt worktree resolves its batch manifest.

## Reproduction Steps

Run in `packages/apexo`:

```sh
bun test test/v2/apply-and-run-guardrails.test.ts test/provider/provider.test.ts
```

## Root Cause

1. `cost()` in `packages/core/src/plugin/models-dev.ts` coalesced `undefined` fields to `0` without returning `[]` when `input === undefined`.
2. `SessionRunner` reused the Goal character-based input heuristic (`promptChars / 3.5`) for `execution?.policy.maxTokens` pre-flight instead of checking exact `budgetLedger.tokens >= execution.policy.maxTokens`.
3. Git enables rename detection by default on `git diff --name-only` (emitting only the destination path), and `git apply --numstat` reports only `new_name` on rename headers unless `rename/copy from/to` headers are also collected.
4. `ApplyCommand` checked `path.dirname(canonicalDir)` prior to `git.repo.discover(canonicalDir)`.

## Fix

1. Returned `[]` when `!input` in `cost()` and handled empty base/override arrays in `mergeCost()` in `packages/core/src/plugin/models-dev.ts`.
2. Replaced the character-heuristic `maxTokens` pre-flight in `packages/core/src/session/runner/llm.ts` with exact `budgetLedger.tokens >= execution.policy.maxTokens` alongside `maxTurns` and `maxBudgetUsd`.
3. Passed `--no-renames` to `git diff --name-only` in `packages/apexo/src/cli/attempts-worktree.ts` and `packages/apexo/src/cli/run-attempts.ts`, and extracted `rename/copy from/to` header paths alongside `git apply --numstat -z` in `packages/apexo/src/cli/cmd/apply.ts`.
4. Resolved the target directory's Git worktree root via `git.repo.discover` before checking `path.dirname(worktreeRoot)/manifest.json` (and applied the same discovery fallback for saved `attempts.result` reports) in `packages/apexo/src/cli/cmd/apply.ts`.

## Verification

- `bun turbo typecheck --concurrency=2`: 21/21 packages passed.
- `cd packages/apexo && bun test test/v2/apply-and-run-guardrails.test.ts test/provider/provider.test.ts`: 91 pass, 0 fail (330 `expect()` calls, covering unpriced `ModelsDev` fail-closed `--max-budget-usd`, 120 KB base64 attachment with `--max-tokens 1000`, file rename with unstaged local edits under `--3way --index`, and monorepo subdirectory `apexo apply <attemptSubdir>`).
