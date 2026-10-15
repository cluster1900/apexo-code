# Native Feedback Empty Transcript Envelope

- **Bug ID:** BUG-20261014-142
- **Type:** Test fixture
- **Scope:** Native-only Feedback management HTTP acceptance
- **Status:** Verified
- **Independent occurrences:** 1

## Observed and expected behavior

The fixture correctly observed an empty transcript after draft management, but
rejected its response because it expected only `{ data: [] }`. The native list
contract also returns a cursor envelope.

## Reproduction, cause, and fix

Run `bun test test/e2e/v2-feedback-management.e2e.test.ts` from `packages/apexo`
with the original exact equality assertion. Assert the declared complete
response, including `cursor: { next: null, previous: null }`. Do not remove
pagination metadata from the product to satisfy the test.

## Verification

The native management and tool execution files passed 3 tests and 38 assertions.
Draft CRUD leaves both the transcript and active execution set empty.
