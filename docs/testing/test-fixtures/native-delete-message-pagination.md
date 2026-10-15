# Native Deletion Message Pagination Fixture

- **Bug ID:** BUG-20261015-015
- **Scope:** Off-tree native Session deletion HTTP acceptance fixture.
- **Status:** Corrected and verified in the isolated draft and integrated focused suite.
- **Independent occurrences:** 1.

## Observed and expected behavior

The new deletion fixture completed admission, deletion, repeated/missing deletion,
and ID reuse, then failed its final empty-history assertion. The actual native
message-list response included an empty pagination cursor alongside `data: []`.
The fixture expected only the data property. The contract requires both.

## Reproduction and root cause

Run `bun test test/e2e/v2-session-delete.e2e.test.ts` from `packages/apexo` in
the combined deletion draft. The fixture used an incomplete expected response
shape instead of the existing native paginated contract. The first combined
run had three contract passes and this one fixture failure.

## Fix

Assert the complete empty response: `data: []` and
`cursor: { next: null, previous: null }`. Keep all ownership, deletion, reuse,
HTTP status, and zero-provider-work assertions unchanged.

## Verification

In the isolated combined draft, `bun test test/server/memory-work-contract.test.ts
test/e2e/v2-session-delete.e2e.test.ts` passed four tests with 26 assertions and
zero failures. `bun typecheck` in `packages/server` also passed. These results do
not accept the separate unresolved recursive deletion wait.

The integrated 58-test focused suite also passed the unchanged HTTP fixture;
all 21 repository typecheck tasks passed.
