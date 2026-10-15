# ACP prompt completion preceded the durable Goal terminal snapshot

- **Bug ID:** BUG-20261014-167
- **Type:** Test fixture asynchronous observation
- **Scope:** Installed Goal strategy comparison
- **Status:** Verified
- **Independent occurrences:** 1

The initial fixture read Goal state once after the ACP prompt response and saw
`active`. Subsequent notifications recorded the actual terminal `infra_paused`
state from the independent title-routing fixture defect. An ACP response alone
was not a sufficient terminal-state observation.

The fixture now polls the explicit session-state method until the Goal leaves
active status, under a bounded deadline. The rerun correctly reported
`infra_paused`, exposing the real title-routing failure instead of the stale
snapshot. This correction does not claim the strategy behavior passed; that is
recorded only after a complete successful comparison.

Final verification: `bun run script/grok-goal-strategy-official.mjs` from
`packages/apexo` passed two checks with 37 local requests on installed Grok
1.0.52. The isolated child exited and final stderr was empty.
