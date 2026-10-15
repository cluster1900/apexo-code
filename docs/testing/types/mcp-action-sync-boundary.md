# MCP preference action omitted from directory synchronization types

- **ID:** BUG-20261015-031.
- **Scope:** Shared App/ Desktop MCP management.
- **Status:** Fixed; complete integration typecheck passed.
- **Occurrences:** One confirmed integration type failure.
- **Observed:** The complete typecheck rejected `resetPreference` in `context/mcp.ts` because the intermediate directory synchronization wrapper still accepted only Connect, Disconnect and Retry.
- **Expected:** The new native action remains typed through the UI mutation, directory wrapper and server synchronization API.
- **Reproduction:** Run `bun typecheck` from `packages/desktop` with the new preference action and the old duplicated directory-wrapper union.
- **Root cause:** The draft updated the shared `McpAction` type and the server action, but an independently declared intermediate union remained stale. Isolated Core tests could not detect this App boundary mismatch.
- **Fix:** Import and use the existing shared `McpAction` type in both the directory wrapper and UI mutation, removing duplicated action unions. Runtime dispatch is unchanged.
- **Verification:** The initial complete typecheck failed at the stated boundary. After correction, all 21 repository typecheck tasks passed. Visible preference/reset acceptance is tracked in the native MCP feature record.
- **Constraint:** None; one occurrence.
