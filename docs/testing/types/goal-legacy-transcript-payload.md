# Goal legacy transcript fixture payload typing

- **Bug ID:** BUG-20261015-001
- **Scope:** `packages/apexo/test/session/goal-cleanup.test.ts`
- **Status:** Verified
- **Independent occurrences:** 1

The new dead-owner recovery test passed at runtime, but `bun typecheck` rejected the inline user-message payload passed to `SessionMessageTable.values`. The table uses `Omit` over the complete message union; this non-distributive mapped type exposes common properties for excess-property checking and rejects the subtype's inline `text` field. The error appeared through Drizzle's overload fallback as an invalid `id` property on the array overload.

The initial hypothesis that `files` and `agents` were required was incorrect: both are optional in the user-message schema, and adding them did not fix the error. The fixture now validates its payload with `satisfies Omit<(typeof SessionMessage.User)["Encoded"], "type" | "id">` before inserting the separately bound value. No production schema or runtime validation was weakened.

An intermediate repair placed the bound payload in the adjacent database-reopen test, producing a real `ReferenceError` in the dead-owner test. The declaration was moved into the correct generator scope. This was a failed repair during the same fixture authoring occurrence, not a new independent occurrence of the type root cause.

Verification: from `packages/apexo`, `bun typecheck` passed after coordinated Client/SDK generation, and `bun test test/session/goal-cleanup.test.ts` passed 14 tests with 96 assertions. A prior check interrupted for overlapping SDK generation is excluded from acceptance evidence.
