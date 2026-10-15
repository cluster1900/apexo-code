# Goal terminal cleanup and optional report retention

The compatibility executor now reserves report IDs durably before creating their directories. At execution start or explicit resume, it backfills pre-existing reports from the current Goal's dedicated directory and its persisted legacy references. No global scan infers ownership from missing database rows.

Completion and budget exhaustion commit a fixed cleanup manifest in the same transaction as the terminal state. The manifest retains its Goal lifetime and a local process teardown barrier. Normal execution releases the barrier after its scope closes; crash recovery may proceed only after the recorded PID is confirmed absent. A live PID, reused PID, or permission error blocks recovery conservatively. Every cleanup job for that Session and Goal respects this barrier, including separately queued clear or Session-deletion jobs; the owning finalizer can release it even after the owner row is deleted. This is local-process safety, not clustered execution ownership.

Scratch cleanup keeps plans and verifier evidence available. Optional `goal.report_retention_days` accepts an integer from 0 through 36500. Omit it to retain reports indefinitely. With an explicit value, superseded and incomplete report directories expire that many days after terminal transition. Zero opts into immediate expiry after teardown. The original plan, current verifier panel, and previous verifier reference are protected. The policy is captured when execution starts or resumes, and the expiry intent is committed atomically with terminal state. Scheduled cleanup survives database reopening and owner deletion, keeps fixed IDs, and uses the existing retry machinery.

This retention option is Apexo policy. Pinned Grok revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` removes owned scratch at terminal transitions and rescues classifier details; inspection found no equivalent time/count report-expiry default. Installed Grok 1.0.52 was exercised through its planner and verifier artifact workflow. These comparisons do not claim an official report-download API or configurable retention parity.

Goals already terminal before this implementation without a persisted manifest are not retrospectively classified as orphans. Explicit report cleanup and Session deletion remain their recovery paths. Native V2 integration, strategy/harness work, cross-host execution ownership and Windows/Linux acceptance remain separate work.

## Verification

Run from `packages/apexo` with the pinned Bun version:

- `bun test test/session/goal-cleanup.test.ts test/session/goal.test.ts test/session/goal-files.test.ts test/session/goal-reports.test.ts`
- `bun script/grok-goal-storage.mjs cli` and `bun script/grok-goal-storage.mjs desktop`: real cross-process SQLite and SIGKILL, including death after terminal commit before cleanup; Desktop uses Electron's Node runtime.
- `bun script/grok-goal-cleanup.mjs cli` and `bun script/grok-goal-cleanup.mjs desktop`: full backend cleanup and retry scenarios; Desktop uses the production backend bundle.
- `bun script/grok-goal-retention.mjs cli` and `bun script/grok-goal-retention.mjs desktop`: three real verification rounds with explicit zero-day retention, preserved plan/current/previous report downloads.
- `bun script/grok-goal-official.mjs --execute --workspace`: installed official planner/verifier artifact workflow.

Pinned official source: `cargo test -p xai-grok-shell --lib terminal_transitions_ --locked -- --test-threads=2` passed 5 tests, including scratch removal and classifier-detail rescue.

Related records: [atomic terminal intent](testing/persistence/goal-terminal-intent.md), [optional policy decoding](testing/persistence/goal-retention-optional.md), and [closed Effect service requirements](testing/types/goal-cleanup-service-requirement.md).

## Verified results (2026-10-14)

The four-file unit suite passed 75 tests and 500 assertions. CLI and Desktop each passed 11 storage/crash checks. CLI passed 7 lifecycle cleanup checks and 2 retention checks. Desktop retention passed both checks again against the refreshed production bundle containing the final cross-job barrier correction. Desktop lifecycle passed all 7 checks again against that same refreshed production bundle. The Desktop cleanup and retention runs used the shared production backend build; the storage run used bundled Core code under Electron/Node. Installed Grok passed 3 planner/verifier workspace-artifact checks, and pinned source passed 5 terminal-transition tests. Core and Apexo package type checks passed. These results do not cover native V2 or non-macOS platforms.

The Desktop crash harness initially exited naturally because `Effect.never` alone did not keep Node's event loop alive; its timer-backed park and explicit liveness assertions were verified in both runtimes. See [BUG-20261014-029](testing/test-fixtures/goal-terminal-park-node.md).
