# BUG-20261014-078: Incomplete Native Stop Context Token Transition

- Status: Fixed; native Stop integration verified, independent Workflow rerun pending.
- Type: Runtime / concurrent integration.
- Affected scope: Native Session runner, Workflow children, and Stop hook context preparation.
- Independent occurrences: 1 observed integration run. This does not meet the recurring-constraint threshold.

## Observed and expected behavior

A native Workflow integration test failed before its first provider request with `ReferenceError: stop is not defined`. Native child Sessions must prepare a valid context and execute normally, regardless of whether a Stop hook continuation is pending.

## Reproduction

Run `bun test test/e2e/v2-workflow.e2e.test.ts` from `packages/apexo` against the incomplete runner edit. The run recorded a failed Workflow with no provider work.

## Root cause and fix

A multi-step edit replaced the unconditional pending-row lookup before replacing its remaining context-preparation references. A concurrent integration test loaded that intermediate source. The completed edit passes a current-drain continuation token, loads only its matching row after prompt promotion, and suppresses stale notes when a new user input is promoted. New drains cannot use persisted ready rows as authority to resume hook work.

## Verification

- `bun typecheck` from `packages/core`: passed after the complete edit.
- `node script/grok-hooks-stop-parity.mjs cli --v2` from `packages/apexo`: passed all five scenarios after the completed runner edit, including durable system provenance, one user admission, force-stop, and the eight-continuation cap.
- The production Desktop native Stop fixture also passed all five scenarios with the completed token transition. Native Workflow integration also passed one test/nine assertions, including Deep Research and real Rhai child execution.
