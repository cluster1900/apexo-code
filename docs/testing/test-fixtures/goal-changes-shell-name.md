# BUG-20261014-009: Git Evidence Fixture Emitted Unadvertised Shell Tool Name

- **Status**: Fixed & Verified; **Verified Occurrences**: 2; **Linked Rule**: None (below threshold).
- **Scope**: Worker fixture in `grok-goal-changes.mjs cli`.
- **Observed**: The fixture returned tool calls named `Shell`, whereas the active Grok profile advertised `run_terminal_cmd`. The tool call was rejected as unavailable, leaving working-tree and staged modifications unexecuted.
- **Expected**: Emit the exact tool identifier advertised in the request schema (`run_terminal_cmd`) and verify tool receipt completion before reporting changes.
- **Reproduction**: In `packages/apexo`, run `bun script/grok-goal-changes.mjs cli`.
- **Root Cause**: Used a display name (`Shell`) instead of checking the tool identifier exposed by the Grok profile.
- **Fix**: Emit `run_terminal_cmd`, print a completion marker, and verify actual tool receipts before the next model turn.
- **Verification**: CLI and Electron suites passed all 7 scenarios (109 requests each), including `deny`/`ask` permission filtering and tool receipt assertions.
