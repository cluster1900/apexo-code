# BUG-20261014-068: Official compaction fixture returned an invalid summary

- Scope: Installed-official Hooks comparison `/compact` scenario.
- Observed behavior: Official compaction rejected the fixture's 12-character generic acknowledgement as a degenerate summary for approximately 2,173 input tokens.
- Expected behavior: The local model fixture returns a substantive summary that satisfies the official compaction contract, enabling PreCompact and PostCompact verification.
- Reproduction: Run `/compact` after the hook scenarios with a provider that returns only `CONTRACT_ACK`.
- Root cause: The fixture reused its ordinary turn acknowledgement for a summary-generation request. The pinned official compaction utility requires at least 500 summary seed characters.
- Fix: Return a substantive summary of the deterministic hook scenarios, preserving the successful-compaction and lifecycle-event assertions.
- Verification: The corrected isolated installed-runtime run successfully completed `/compact` and asserted both PreCompact and PostCompact records.
- Occurrences: One fixture failure. No recurring constraint is promoted.
