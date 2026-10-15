# Grok Home Alone Did Not Isolate Compatibility Imports

- **Bug ID:** BUG-20261014-149
- **Scope:** `packages/apexo/script/grok-session-compact-official.mjs`
- **Status:** Verified
- **Independent occurrences:** 1

The initial reference fixture set an isolated `GROK_HOME`, but left the child
process's home and compatibility imports inherited. Its stderr and request
context showed host Claude plugin/skill discovery and an MCP connection notice.
That run cannot serve as clean isolated comparison evidence. The root cause was
incomplete process-environment isolation, not compaction itself.

The child now receives a dedicated home, dedicated leader socket, disabled
managed and vendor compatibility imports, and local model catalog endpoints.
The parent process environment and real user configuration remain unchanged.
Only fixture-owned child processes and directories are used.

Verification: from `packages/apexo`, pinned Bun 1.3.14,
`bun run script/grok-session-compact-official.mjs` passed three checks with five
local requests on Grok 1.0.52. Inspection of its final stderr showed only the
intended summary-failure scenario, with no host plugin imports or MCP connection
notices. The fixture-owned Grok process was reaped after completion. Earlier
partially isolated runs are excluded from final comparison evidence.
