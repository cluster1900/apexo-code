# BUG-20261014-029: Electron crash fixture exited before its live-owner assertion

- Status: Fixed and verified. One observed fixture failure; no recurring constraint.
- Scope: `grok-goal-storage.mjs` cross-process terminal cleanup checks.
- Observed: The Desktop run failed with `ENOENT` reading worker scratch during the intended live-owner check. The CLI version passed. Expected: the parked worker must remain alive while another process attempts cleanup, then receive an actual SIGKILL.
- Reproduction: In Electron's Node runtime, publish terminal-commit readiness and await `Effect.never` with no remaining event-loop handles; launch a second worker to drain cleanup before sending SIGKILL.
- Root cause: An unresolved Promise/Effect is not a Node event-loop handle. The Electron worker could naturally exit while the second process started, making its PID genuinely dead and cleanup legitimate. The fixture's initial readiness signal alone did not prove continued liveness.
- Fix: Keep a timer handle alive for the parked terminal worker and clear it in the scoped finalizer. Assert the child still has no exit code or signal immediately before SIGKILL, and verify the resulting signal is SIGKILL. No production cleanup behavior was changed.
- Verification: After the fixture correction, `bun script/grok-goal-storage.mjs cli` and `bun script/grok-goal-storage.mjs desktop` each passed all 9 checks. Both retained scratch while the owner remained live, removed scratch after real SIGKILL, and retained the plan. Desktop used Electron's Node runtime with the Node SQLite implementation.

- Expanded frozen-source verification: CLI and Electron each passed 11 checks after adding independent-process Goal-clear and Session-deletion jobs; both respect the live terminal barrier and recover after SIGKILL.
