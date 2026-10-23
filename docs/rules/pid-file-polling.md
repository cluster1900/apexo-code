# RULE-20261023-001 — Non-empty Positive PID Validation When Polling Shell PID Files

- **Rule ID**: `RULE-20261023-001`
- **Scope**: Process and monitor execution test fixtures that poll shell-written PID files (`echo $$ > pid`)
- **Source Bug**: [BUG-20261017-001](../testing/test-stability/linux-ci-socket-stream-memory.md)

## Constraint

- **MUST** validate that the trimmed file text parses to a positive integer (`Number.isInteger(pid) && pid > 0`) when polling a shell-redirected PID file, and await background job termination before asserting `process.kill(pid, 0)` throws.
- **NEVER** pass `Number(await Bun.file(pidPath).text())` directly to `process.kill(..., 0)` without rejecting empty strings (`Number("") === 0`), because `/bin/sh` creates the file with `O_CREAT | O_TRUNC` before `echo $$` writes the PID digits, and `process.kill(0, 0)` signals the caller's own process group instead of throwing.

## Verification

- Run `bun test test/v2/monitor-execution.test.ts test/v2/process-execution.test.ts` from `packages/apexo`.
