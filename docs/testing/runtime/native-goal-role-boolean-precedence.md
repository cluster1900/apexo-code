# Native Goal model-only flag ignored explicit false and supported spellings

- **Bug ID:** BUG-20261014-192
- **Type:** Runtime configuration precedence
- **Scope:** Native planner, verifier and strategist role selection
- **Status:** Verified
- **Independent occurrences:** 1

## Observed and expected behavior

Source audit found that native Goal selection used two string comparisons joined
with the configured boolean by logical OR. With configuration true, environment
`false` could not turn it off. Spellings such as ` YES `, `on` and `enabled` were
not recognized. The compatibility runner already supports trimmed,
case-insensitive true/false spellings and invalid-value fallback.

## Root cause and fix

The native runner duplicated only part of the compatibility parsing contract.
A shared pure `EnvBoolean.parse` now serves compatibility runtime flags and the
native Goal resolver. Nullish fallback preserves explicit false, then uses the
configured value, then defaults to false. The orchestration and role lifecycle
are unchanged.

## Verification

The actual native configuration resolver is tested across thirteen inputs and
three configured states. Existing compatibility and Memory flag tests exercise
the shared parser through their real Effect ConfigProvider path. Commands run
from their package directories on pinned Bun 1.3.14:

- `bun test test/effect/runtime-flags.test.ts` from `packages/apexo`.
- `bun typecheck` from `packages/core` and `packages/apexo`.

Results: 42 tests and 172 assertions passed. Core and Apexo package typechecks
both passed.
