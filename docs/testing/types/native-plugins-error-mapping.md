# Native Plugins Reload Error Mapping

- **Bug ID:** BUG-20261014-190
- **Type:** Types / HTTP integration
- **Scope:** `packages/server/src/handlers/plugins.ts`
- **Status:** Verified
- **Independent occurrences:** 1

## Observed and expected behavior

The first Server typecheck rejected the native Plugins reload handler. Its
`Effect.catchTag` callback inferred one HTTP error class from the first branch,
then rejected the other branches and left the handler with an unknown error
channel. The handler must preserve its declared HTTP error union.

## Reproduction, root cause and fix

Run `bun typecheck` from `packages/server` with a `catchTag` callback that returns
separate `Effect.fail(...)` values for conflict, invalid input and service
unavailability. The operation only needs to translate its typed failure; it does
not recover with another effect. Replace that callback with `Effect.mapError`
returning the three HTTP error values. Busy reloads remain HTTP 409, invalid or
unsupported bundles HTTP 400, and load failures HTTP 503.

## Verification

- `bun typecheck` from `packages/server`: exit 0.
- `bun run script/httpapi-exercise.ts --mode effect --include v2.plugins --fail-on-missing --fail-on-skip`
  from `packages/apexo`: all five native Plugins scenarios passed; no failures,
  skips, missing routes or extras.
- `bun script/grok-plugins-native.mjs cli` from `packages/apexo`: 13 scenarios
  passed with three local provider requests, including actual busy and invalid
  reload responses and preservation of the prior active generation.

This is focused verification; final repository gates remain separate.
