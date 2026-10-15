# BUG-20261015-371: Runtime pin did not cover subsequent shell commands

- Scope: local validation invocation, canonical generation and the LSP workspace CLI probe.
- Observed: a command used `PATH=... bun first && bun second`. The assignment applied only to the first command; the host's default Bun was 1.4.2, while the repository requires 1.3.14.
- Expected: every validation command and its subprocesses use the pinned runtime.
- Reproduction: compare `bun --version` in the second command of that shell form with the explicitly pinned executable.
- Root cause: command-local environment assignment was mistaken for an exported shell environment.
- Fix: export the pinned PATH and fixture environment before executing a command sequence. Do not count the earlier unpinned run as pinned-runtime acceptance.
- Verification: canonical Client, configuration and legacy SDK generation plus the Turbo SDK prerequisite completed again with exported Bun 1.3.14. The pinned LSP workspace CLI probe passed six checks with eight provider calls. The earlier generated outputs matched the frozen candidate, but that does not substitute for the corrected invocation.
- Independent occurrences: one invocation-authoring episode; no recurring constraint is promoted. This is a validation correction, not a product runtime fix.
