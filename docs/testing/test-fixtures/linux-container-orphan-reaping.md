# BUG-20261015-373: Linux validation container did not reap orphan descendants

- Scope: Docker-based Linux validation; native LSP descendant cleanup fixture.
- Observed: the first 117-test Linux gate passed 116 tests but timed out while waiting for the LSP descendant PID to disappear.
- Expected: after owned process-group shutdown, the container init process reaps orphan children so the existing process-disposal assertion can finish.
- Reproduction: run the LSP tool disposal case with Bun itself as PID 1 in a Docker container without `--init`. A diagnostic-only repetition failed again. Its failing descendant's `/proc` state was `Z (zombie)`, with parent PID 1; the test runner also reported its own PID as 1. The descendant was dead, not still executing.
- Root cause: the disposable validation container had no init/reaper. The orphaned grandchild was adopted by the Bun test runner, which did not reap that non-owned child. A shell-parent control passed, but only the captured process state establishes this cause.
- Fix: use Docker `--init` for the Linux validation environment. Restore the fixture to its original source; do not weaken the disposal assertion or change product shutdown based on this environment failure.
- Verification: the unchanged 19-file gate with `--init` passes all 117 tests / 876 assertions in 133.15 seconds. The diagnostic-only source edit was removed before this run. This is a scoped Linux pass, not a complete Linux repository or Desktop gate.
- Independent occurrences: one environment setup episode, reproduced once for diagnosis. No recurring constraint is promoted.
