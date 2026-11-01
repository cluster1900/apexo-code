# BUG-20261101-003: CI `apexo#typecheck` rejected `JSON.parse(searched.result.value)` without `typeof === "string"` narrowing

- Status: Fixed; `packages/apexo` `bun run typecheck`, `mcp-codemode-toolsearch.test.ts`, and `mcp-serve.test.ts` pass.
- Scope: `packages/apexo/test/v2/mcp-codemode-toolsearch.test.ts` (line 300), `ToolResultValue` (`packages/llm/src/schema/messages.ts`).

## Observed and expected behavior

On Linux GitHub Actions (`typecheck.yml`, `bun turbo typecheck --concurrency=2`), `apexo:typecheck` (`tsgo --noEmit`) failed with:

`test/v2/mcp-codemode-toolsearch.test.ts(300,39): error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'string'.`

Expected behavior: `apexo:typecheck` should pass identically across clean Linux CI and local macOS checkouts.

## Reproduction

Inspect `ToolResultValue` in `packages/llm/src/schema/messages.ts` (`type: Schema.Literal("text"), value: Schema.Unknown`) and pass `searched.result.value` directly to `JSON.parse(...)` after narrowing only `searched.result.type === "text"` on a clean Linux CI install without ambient `JSON.parse(any)` overload widening.

## Root cause and fix

`ToolResultValue`'s `"text"` variant types `value` as `Schema.Unknown` (`unknown`), so `searched.result.type === "text"` narrows the union member without narrowing `value` to `string`. Added explicit `typeof searched.result.value === "string"` runtime assertion and type guard before `JSON.parse(searched.result.value)` (and applied the same `typeof === "string"` guard in `packages/apexo/test/cli/mcp-serve.test.ts`).

## Verification

- `bun test test/v2/mcp-codemode-toolsearch.test.ts test/cli/mcp-serve.test.ts` from `packages/apexo`: 5/5 pass.
- `bun turbo typecheck --concurrency=2 --force`: 21/21 pass.
