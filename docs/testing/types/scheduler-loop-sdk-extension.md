# BUG-20261015-220: Handwritten SDK helper omitted its NodeNext import extension

- Status: Fixed in the shared Scheduler helper and shared MCP picker integration.
- Scope: Handwritten SDK helpers using the package's NodeNext settings. Two independent authoring episodes: Scheduler command-prompt and MCP attachment.
- Observed: The normal SDK build generated clients successfully, then TypeScript reported TS2835 for `import type { ApexoClient } from "./client"`; the untyped imported value also produced a downstream implicit-parameter diagnostic.
- Expected: The handwritten export compiles with the SDK's existing NodeNext settings and is loadable through its package export.
- Reproduction: From `packages/sdk/js`, run `bun run build` with the extensionless import.
- Cause: The helper used the extensionless convention from other workspace packages despite this package requiring explicit JavaScript extensions in emitted imports. Generated contracts were not responsible.
- Fix: Use `./client.js`, following this SDK's existing handwritten imports. The helper remains browser-safe and imports no Core or Server implementation.
- Verification: The full private SDK build completed successfully. From `packages/sdk/js`, `bun test test/command-prompt.test.ts` passed 5 tests and 13 assertions, importing the real package export and exercising actual HTTP requests. Private frozen-lock workspace installation also completed without dependency changes after the coherent refresh.

## Second occurrence: MCP attachment helper

During the combined Memory/Task/MCP integration, the canonical `./packages/sdk/js/script/build.ts` generated clients successfully but exited 1 when compiling `src/v2/mcp-attachment.ts`. Its type-only `./client` import produced TS2835 and five cascading unknown/implicit-parameter diagnostics. The new helper independently repeated the extensionless import mistake; the generated API was valid. Changing only that import to `./client.js` fixed the boundary. Rerunning the exact canonical SDK build exited zero. This is the second demonstrated independent occurrence, below the constraint-promotion threshold; runtime cancellation verification remains in the MCP picker records.
