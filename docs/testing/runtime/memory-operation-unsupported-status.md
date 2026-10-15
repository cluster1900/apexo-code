# BUG-20261015-242: Unsupported native Memory extraction returned conflict

- Status: corrected; both real native and mixed HTTP host regressions passed.
- Scope: native Memory operation HTTP error mapping.
- Verified occurrences: one implementation episode, observed through both host configurations.

## Observed and expected behavior

An enabled Session pinned to the legacy Memory backend returned HTTP 409 for native flush. The operation contract requires HTTP 403 for unsupported extraction, while genuine revision and ownership conflicts remain 409. No operation or provider request should be admitted for this unsupported capability.

## Reproduction and root cause

Run `bun test test/e2e/v2-memory-operation.e2e.test.ts` from `packages/apexo`. Both tests reached the actual flush handler and failed at the status comparison: expected 403, received 409. The pre-fix run had zero passes, two failures and twelve assertions. The handler mapped `denied` explicitly, but allowed `unsupported` to fall through to the conflict mapping.

## Fix

Map both `denied` and `unsupported` to the canonical `MemoryForbiddenError`. Preserve 409 for busy/conflict and preserve the selected backend. The regression uses both full HTTP hosts, checks the actual pinned legacy state, and verifies empty operation lists, missing receipt/cancel responses and zero provider work.

## Verification

Both HTTP tests passed with 22 assertions inside the final shared combined gate (60 tests / 449 assertions across eleven files). The all-21 workspace type gate also passed with this handler correction. Native and mixed hosts return 403, retain the selected backend, create no receipt and make no provider request. This record does not claim native legacy extraction is implemented.

Native legacy flush was implemented in a later checkpoint. Unsupported V2 recovery preview is now the HTTP error-mapping regression for a legacy Session; empty legacy flush has a no-work receipt. The stale test assumption is tracked separately in [BUG-20261015-324](../test-fixtures/native-memory-legacy-http-contract.md).
