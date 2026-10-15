# BUG-20261014-040: Official Shell default description assertion used local wording

- Status: Fixed and verified. Verified occurrences: 1. No recurring constraint.
- Scope: The installed Grok Shell host-configuration comparison fixture.
- Observed: The first official scenario executed successfully and advertised default 40 and maximum 80 milliseconds, but the fixture required the literal substring `40ms`. The installed version describes this as `40 (0.04 seconds)`.
- Expected: Verify the configured numeric default and ceiling without requiring Apexo's wording in an official tool description.
- Reproduction: From `packages/apexo`, run `bun script/grok-shell-config-official.mjs` against installed Grok 1.0.52 with `default_block_until_ms = 40` and `max_timeout_secs = 0.08`.
- Root cause: A local description assertion was reused across implementations with different text but identical units and semantics.
- Fix: Match the explicit default value in either documented wording. Keep exact maximum, observed wait, successful tool execution, and live background-process assertions unchanged.
- Verification: The same installed-runtime command passed all three scenarios (configured default, explicit oversized wait, and immediate background), preserving exact maximum and process-survival checks. The official source `single_knob_tests` filter independently passed all 19 tests at pinned revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`.
