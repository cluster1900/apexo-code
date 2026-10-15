# Workflow Isolated Copy Omitted the Interpreter Artifact

- **Bug ID:** BUG-20261015-027
- **Scope:** Off-tree Workflow model acceptance fixture; no product defect.
- **Status:** Corrected and verified in the isolated CLI fixture.
- **Independent occurrences:** 2.

## Observed and expected behavior

The first isolated CLI run failed with `Apexo workflow script interpreter is not installed`. No Rhai child could execute. The acceptance checkout was expected to include the existing interpreter prerequisite.

## Reproduction and root cause

Copy the source tree for off-tree validation while excluding `target`, then launch a saved or inline Rhai workflow. The interpreter searches the executable directory and source-relative release artifact; neither exists in that copy. This is a copy-prerequisite omission, distinct from Desktop resource environment or application-path failures.

## Fix and verification

Copy the already built Apexo interpreter into the isolated checkout's expected release location. No build or production resolver change was required. A later variant fixture error is separately recorded as BUG-20261015-028.

From the equipped isolated `packages/apexo`, `bun script/grok-workflow-model.mjs cli` passed five checks with five provider turns. The Workflow model, engine, script, and coordinator test suite passed 14 tests with 74 assertions; the new native HTTP model-selection test passed one test with 11 assertions. These are isolated draft results, not live integration or Desktop acceptance.

## Integrated verification

After applying the reviewed source and fixture, the live focused plus native HTTP/lifecycle suite passed 16 tests with 100 assertions. `bun script/grok-workflow-model.mjs cli` passed five checks with five provider turns after the coordinated SDK writer completed. The initial generator/read overlap is separately recorded as BUG-20261014-242. `bun script/grok-workflow-model.mjs desktop` then passed the same five checks with five provider turns against the coordinated packaged backend; the process was reaped.

## Second isolated-copy occurrence

Native command sandbox validation copied source while excluding `target`. The real Workflow child regression returned `Apexo workflow script interpreter is not installed`, while the independent native Goal regression passed. Copying the existing built interpreter into the private checkout restored the Rhai execution case without changing production code or rebuilding the artifact. The copied executable SHA-256 was `3ed8c0249a8f08230061df540957dac36c4b954d7e31fb4c0d4229ca24834a2e`.

A subsequent combined run passed the real Deep Research/Rhai case but exceeded the five-second default limit in the Git-policy case while other checks were active. That timing symptom is retained separately; artifact restoration is not claimed to fix a timeout. The unchanged `bun test test/e2e/v2-workflow.e2e.test.ts` rerun passed2 tests/24 assertions, with the Git-policy case taking2.62 seconds. No timeout increase or product timing fix is claimed. This is the second independently constructed source copy missing the same prerequisite, not multiple occurrences for its reruns. No recurring rule is promoted.
