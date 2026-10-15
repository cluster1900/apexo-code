# Native Feedback Delete Request Builder

- **Bug ID:** BUG-20261014-141
- **Type:** Test fixture
- **Scope:** Native-only Feedback management HTTP acceptance
- **Status:** Verified
- **Independent occurrences:** 1

## Observed and expected behavior

The fixture passed the first eleven management assertions, then threw a
`TypeError` before sending a deletion request. It should exercise revision-checked
deletion through the production native route.

## Reproduction, cause, and fix

Run `bun test test/e2e/v2-feedback-management.e2e.test.ts` from `packages/apexo`
with the original `HttpClientRequest.del` call. Effect exports that builder as
`delete`; `del` is its private implementation name. Use the public
`HttpClientRequest.delete` export. No product behavior changed.

## Verification

`bun test test/e2e/v2-feedback-management.e2e.test.ts test/e2e/v2-feedback.e2e.test.ts`
passed 3 tests and 38 assertions. Stale deletion returns 409; the reviewed
revision deletes successfully; subsequent review returns 404.
