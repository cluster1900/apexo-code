# BUG-20261101-001: `apexo mcp serve` ignored `stdin` EOF and waited for `SIGTERM` on client close

- Status: Fixed; real subprocess stdio simulation (`test/cli/mcp-serve.test.ts`), nested Code Mode orchestration, and package typechecks pass.
- Scope: `apexo mcp serve` CLI stdio lifecycle (`packages/apexo/src/cli/cmd/mcp-serve.ts`, `McpServeCommand.handler`).

## Observed and expected behavior

When an MCP stdio client (`StdioClientTransport.close()`) closed the child process's `stdin` pipe after completing `apexo_run` and `apexo_review` requests, `apexo mcp serve` remained alive for ~2075ms until `StdioClientTransport`'s 2000ms timeout expired and sent `SIGTERM`. Clients that close `stdin` without sending `SIGTERM` would leave an orphaned `apexo mcp serve` process running.

Expected behavior: `apexo mcp serve` should begin graceful shutdown (`server.close()` and `host.close()`) and exit with code `0` immediately upon `stdin` EOF (`end` or `close`), well below the 2000ms `SIGTERM` fallback deadline.

## Reproduction

Spawn `bun run packages/apexo/src/index.ts mcp serve --dir <repo> --model test/fixture --auto` via `@modelcontextprotocol/sdk/client/stdio.js` (`StdioClientTransport`), execute `listTools` / `callTool`, and measure the wall-clock duration of `await client.close()`. Before the fix, `client.close()` consistently took `>= 2000ms` (`2075ms` observed).

## Root cause and fix

`@modelcontextprotocol/sdk`'s `StdioServerTransport.start()` attaches `stdin.on("data", ...)` and `stdin.on("error", ...)` listeners, but never attaches `end` or `close` listeners on `process.stdin`, so `transport.onclose` never fires when the parent MCP client closes `stdin`. Meanwhile, the embedded native host (`createNativeLocalHost`) and CLI heap monitor keep active handles on the event loop.

`McpServeCommand.handler` now checks `process.stdin.readableEnded || process.stdin.destroyed` and registers `process.stdin.once("end", finish)` and `process.stdin.once("close", finish)` alongside `transport.onclose`, `SIGINT`, and `SIGTERM` (matching `packages/apexo/src/cli/cmd/acp.ts`).

During the same simulation audit, `DOOM_LOOP_EXEMPT_TOOLS` in `packages/core/src/session/runner/llm.ts` was also extended to include `task_wait` and `task_output` alongside `process_wait` and `process_output` so repeated polling of background subagents does not trip `doom_loop`.

## Verification

- `bun test test/cli/mcp-serve.test.ts` from `packages/apexo`: 3/3 pass (`client.close()` completes in `< 100ms`, total 6-stage real subprocess test duration reduced from `5083ms` to `~2420ms`).
- `bun test test/v2/shell-scrub-and-doom-loop.test.ts` from `packages/apexo`: 2/2 pass (foreground + owned background shell credential scrubbing and 3x `process_output` polling exemption).
- `bun turbo typecheck --concurrency=2`: 21/21 pass.
