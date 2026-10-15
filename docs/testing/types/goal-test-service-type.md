# BUG-20261014-001: Incorrect Service Type Reference in Goal Test Helper

- **Status**: Fixed & Verified; **Verified Occurrences**: 2; **Linked Rule**: None (below threshold).
- **Scope**: `packages/apexo/test/lib/goal-reply.ts` and Goal integration tests calling it.
- **Observed**: The helper referenced `TestLLMServer.Service` as an external namespace type, triggering TS2713 and causing generator context and callback parameters to infer as `unknown`.
- **Expected**: Use the exported Effect Context service type from `TestLLMServer["Service"]` without introducing implicit `any` or `unknown` dependencies.
- **Reproduction**: Run `bun turbo typecheck --concurrency=2` from the repository root.
- **Root Cause**: Treated an unexported internal namespace type as a public type export.
- **Fix**: Use `TestLLMServer["Service"]` to preserve callback parameter type inference.
- **Verification**: `bun typecheck` in `packages/apexo` exited 0; full-repo typecheck passed 21/21.

## Independent Memory HTTP fixture occurrence

The native Memory HTTP fixture used `HttpClient.HttpClientResponse`, but the installed Effect `HttpClient` namespace does not export that type. Apexo package typechecking reported TS2694, followed by dependent inference diagnostics. Importing the public `HttpClientResponse` module and using its exported response type corrected the same public-export assumption in a separately authored fixture. No production type contract was weakened.

Verification: `bun typecheck` in `packages/apexo` passed. `bun test test/e2e/v2-memory.e2e.test.ts` passed 2 tests / 36 assertions against pure-native and mixed hosts. There are two independent occurrences; no new rule is promoted.
