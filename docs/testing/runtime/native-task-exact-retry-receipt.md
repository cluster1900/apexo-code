# BUG-20261015-081: Exact Task retry selected a later follow-up receipt

- **Scope:** Isolated native Task draft; no shipped regression claimed.
- **Status:** Verified through the canonical native tool registry; integration/Desktop acceptance pending.
- **Observed:** Complete launch A, complete same-child follow-up B, then repeat A with its exact original assistant/tool identity and input. The retry returned B's output, description and timestamps.
- **Expected:** Exact retries return the original durable launch receipt. The general owned output endpoint may continue to return the latest follow-up.
- **Root cause:** Store.begin correctly reconciled A, but foreground execution then called the general latest-output projection instead of projecting its reconciled launch.
- **Fix:** An internal receipt projection selects the exact launch ID and checks its parent/child membership. Both an exact retry and normal foreground completion use that receipt; public output still selects latest.
- **Reproduction:** The actual ToolRegistry executes native SessionExecution child drains for A and B, then retries A without another provider call. Before correction, the Detail equality assertion showed B's output and timing fields in A's result. No mocked runner or fabricated historical receipt was used.
- **Verification:** The affected real canonical receipt/store/control/deletion suite passed 6 tests/118 assertions. The new regression receives A exactly on retry, B from general task_output, and makes only two child provider calls for A/B with none for retry/output. Apexo package typechecking passed after the correction.
