# BUG-20261112-008: Aggregate fixtures retained pre-structured review assumptions

- Scope: the first full repository test gate after adding F01 Core/CLI.
- Observed: help snapshots omitted `--fail-on`; the run/apply guardrail provider fixture recognized only the generic review prompt and returned ordinary text/tool output for a native structured review.
- Expected: the help snapshot includes the new option, and the fallback review fixture returns canonical structured output with existing usage accounting.
- Reproduction: run `GITHUB_ACTIONS=false bun turbo test --concurrency=2` from the root. The help and run/apply batches fail on those exact assumptions.
- Root cause: intentional public behavior changed without updating these older assertions/provider branches.
- Fix: regenerate the existing help snapshot and add a narrowly matched canonical review response to the guardrail provider. Keep the generic prompt branch for compatibility.
- Verification: help snapshot generation passes one test / 96 assertions with only the two intended `--fail-on` lines changed. `bun test test/v2/apply-and-run-guardrails.test.ts` from `packages/apexo` passes two tests / 108 assertions. The replacement full test gate passed all 18 Apexo batches and all 6 Turbo tasks.

# BUG-20261112-009: Temporary MCP server resolved a different SDK instance

- Scope: existing `test/v2/mcp-codemode-toolsearch.test.ts`, found by the full gate.
- Observed: both Code Mode and deferred-tool tests failed because their stdio MCP connection timed out; the expected tools were absent. A temporary status probe confirmed `Could not connect to MCP server`.
- Expected: the isolated server starts with the repository's pinned SDK and exposes its tools.
- Reproduction: run that test file alone; the same initialization failure reproduced. Importing the bare SDK from an independent temporary script succeeded, so a simple missing-package claim is not supported.
- Root cause boundary: bare imports in the generated temporary server are resolved from its temporary location rather than the repository's pinned dependency location. The exact version/protocol mismatch inside that independently resolved SDK was not established.
- Fix: interpolate `import.meta.resolve(...)` paths for the three SDK imports into the temporary server source. Production MCP code is unchanged.
- Verification: the unchanged behavior assertions pass two tests / 39 assertions after pinned resolution, reducing startup from the failed ten-second timeout to under one second per case. No broader SDK defect is claimed.

## Unresolved aggregate observation

The same full gate also failed the first Task resume HTTP fixture while decoding a null response. Running the complete Task resume file alone later passed all five cases. Its aggregate-only root cause is unknown; no fix or verified resolution is claimed from that rerun. The replacement full aggregate passed all 18 batches, including the Task resume batch. The original aggregate-only cause remains unknown; this passing run does not establish a fix for it.
