# BUG-20261014-004: Cancel Fixture Treated Executing Phase as Proof That Model Request Had Started

- **Status**: Fixed & Verified; **Verified Occurrences**: 1; **Linked Rule**: None (below threshold).
- **Scope**: "Resume preserves user-edited goal messages" scenario in `grok-goal-api.mjs`.
- **Observed**: The fixture paused immediately upon observing the `executing` phase and asserted `usageIncomplete === true`, which intermittently returned `undefined` on Desktop runs.
- **Expected**: `usageIncomplete` is set only when an in-flight model request is interrupted before returning usage. Pausing before the HTTP request is dispatched must not assert incomplete usage based solely on the phase label.
- **Reproduction**: In `packages/apexo`, run `bun script/grok-goal-api.mjs desktop`.
- **Root Cause**: The persisted `executing` phase is written before the model HTTP request is sent, so the fixture's wait condition raced ahead of the actual provider request.
- **Fix**: Wait until the local test provider actually receives the execution request and enters its hold point before issuing the pause request.
- **Verification**: Both CLI and production Electron suites passed all 18 scenarios (102 model decisions, 185 requests each).
