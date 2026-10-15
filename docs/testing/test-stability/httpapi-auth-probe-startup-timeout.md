# BUG-20261015-272: Initial HTTP authorization probe exceeded its one-second deadline

- **Scope:** The complete HTTP authorization exerciser after native Memory Dream/migration integration.
- **Status:** Investigating; no causal repair established.
- **Observed:** Coverage passed all 326 scenarios over 298 routes. Authorization passed 325 and failed `GET /global/health` with `auth expected 401, got 0`; there were no skips or inventory gaps. The script exited before the Effect-mode command ran.
- **Expected:** The unauthenticated protected health route returns 401 within the fixture's existing request bound.
- **Reproduction:** Run `bun run script/httpapi-exercise.ts --mode auth --include global.health --fail-on-missing --fail-on-skip --trace --progress` from `packages/apexo`, or the complete HTTP gate.
- **Root cause:** Status zero is the exerciser's synthetic result when its one-second auth probe timer wins; it is not an HTTP response from the application. The original result does not retain handler-initialization versus request phase timing. Other validation was active, but that does not prove resource contention caused the failure.
- **Investigation:** Preserve the original one-second bound and authorization assertions; inspect a cold isolated probe before changing either the product or harness. No timeout increase or passing rerun is a repair by itself.
- **Verification:** A serial complete authorization rerun passed all 326 scenarios over 298 routes without changing the one-second bound or any product code. A separate focused Effect run passed all 12 Memory scenarios with no failures, skips or inventory gaps. The original cold probe delay remains unexplained; neither rerun establishes a repair. The earlier complete 323-scenario checkpoint remains valid only for its earlier package state.
- **Occurrences:** One observed timeout; no recurring constraint is justified.
