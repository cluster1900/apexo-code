# Scheduler Ownership Fixture Part ID

- **Bug ID:** BUG-20261015-014
- **Scope:** Off-tree Scheduler ownership tests; no shipped product defect.
- **Status:** Corrected and verified in the isolated draft.
- **Independent occurrences:** 1.

## Observed and expected behavior

Two new receipt-based tests failed before exercising their intended assertions,
with `TypeError: PartID.create is not a function`. The three-file run had 15
passes and two failures. A valid persisted tool receipt was expected.

## Reproduction and root cause

Construct a completed scheduler receipt in `scheduler-owner.test.ts` using
`PartID.create()`. This schema ID exports `make`, but has no `create` factory.
The new fixture incorrectly assumed all identifier schemas expose the same
factory API. Two assertions in the same run are one authoring occurrence.

## Fix and verification

The fixture now uses an explicit, schema-valid `PartID.make` value. Each test
owns a separate database, so this deterministic fixture ID does not collide.
No production schema or assertion was weakened.

In the isolated `packages/apexo` copy, `bun test test/tool/scheduler-owner.test.ts
test/tool/scheduler.test.ts test/tool/scheduler-persistence.test.ts` passed 17
tests with 79 assertions, and `bun typecheck` passed. The subsequent four-file suite including adversarial ownership cases passed 20
tests with 98 assertions, and the package typecheck passed again. Live-checkout
integration remains a separate acceptance step.
