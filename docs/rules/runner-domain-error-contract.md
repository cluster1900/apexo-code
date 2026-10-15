# RULE-20261015-022: Preserve typed runner domain failures

- **Status:** Active.
- **Scope:** Domain operations added to native SessionRunner execution.
- **Source:** [BUG-20261015-133](../testing/types/process-runner-error-contract.md), three independently authored Shell, Memory and history-copy integrations.
- **MUST:** When a new runner operation can fail with a typed domain error, include that actual failure in `SessionRunner.RunError` and check the downstream execution and host adapters.
- **NEVER:** Cast away the failure channel or use broad cause conversion merely to satisfy the old union.
- **Verification:** Run the affected Core and host package typechecks, retaining explicit generation or integration blockers. Exercise the new failure through the native runner and prove its intended behavior, such as preventing provider work or preserving a recorded receipt.
