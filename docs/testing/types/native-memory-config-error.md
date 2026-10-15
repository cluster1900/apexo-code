# Native Memory Configuration Error Boundary

- **Bug ID:** BUG-20261014-136
- **Type:** Types
- **Scope:** Core Memory Context Source and Location layer construction
- **Status:** Verified
- **Independent occurrences:** 1

## Observed and expected behavior

Adding the Memory Context Source leaked Effect's `ConfigError` into native
Session mutation and execution methods. Their public error contracts do not
include configuration decoding failures. `bun typecheck` in `packages/core`
reported incompatible effects at Session revert/clear and local execution.

## Reproduction and cause

Yield the `MemoryPolicy.flags` Config directly from the new service layer, then
run Core typecheck. Although each optional flag has a fallback, the generic
Config effect retains `ConfigError` in its static error channel. Registering the
layer in the Location graph propagated that channel into callers.

## Fix and verification

Resolve configuration through `Effect.orDie` at the service construction
boundary, preserving the existing runtime fallback behavior without widening
Session APIs. `bun typecheck` from `packages/core` passed. The related Memory
and permission regression run passed **88 tests / 190 assertions / 0 failures**.
