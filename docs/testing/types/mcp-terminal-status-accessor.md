# BUG-20261014-244: Repeated MCP status accessor calls prevented union narrowing

- **Scope:** Shared MCP terminal manager in `packages/tui/src/component/mcp-browser.tsx`.
- **Observed:** The package typecheck rejected reading `item()[1].error` after a separate `"error" in item()[1]` check. Connected compatibility statuses have no error property.
- **Expected:** Optional error text renders only for status values that declare it, without unsafe casts.
- **Reproduction:** Run `bun typecheck` from `packages/tui` with the initial repeated accessor expression.
- **Root cause:** TypeScript cannot preserve a property guard across separate function calls; the second accessor result could differ from the first.
- **Fix:** Read the status once inside the reactive error accessor, narrow that value, and render the resulting optional string through `Show`.
- **Verification:** The corrected `bun typecheck` from `packages/tui` passed. Terminal interaction acceptance remains part of the manager feature checkpoint; this typecheck alone does not establish runtime behavior.
- **Independent occurrences:** One initial manager typecheck failure.
