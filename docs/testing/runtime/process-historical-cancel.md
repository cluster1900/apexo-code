# Completed process cancellation after restart

- **ID:** BUG-20261015-138.
- **Status:** Fixed in the isolated native Shell draft; shared integration remains pending.
- **Occurrences:** One reproduced draft implementation episode.
- **Scope:** Native process cancellation and model wait observation of terminal receipts from a previous process.

## Observed and expected behavior

A real CLI backend completed a background command, restarted with the same private profile, and returned its completed receipt through GET. Bodyless cancellation then returned 409 instead of the expected idempotent 204. The original command must remain completed and must not restart or create provider work.

## Reproduction and cause

From `packages/apexo`, run `bun script/grok-native-shell.mjs cli`. The added post-restart cancellation assertion failed with `409 !== 204` before the correction. `SessionProcessControl.cancel` correctly returned the terminal receipt, but the handler then called `SessionProcessCompletion.observed`. That method attempted a notice mutation through the current-process-only store writer. A previous process cannot own a current completion ticket, so this mutation was both unnecessary and rejected.

## Correction

Observation first validates the receipt's Session ownership and creation identity. It then returns for a receipt from a previous process, before notice mutation or ticket lookup/removal. Current receipts retain the existing observation path. This does not widen old-process mutation or permit unfinished replay.

## Verification

The corrected real CLI fixture passed nine checks / 26 provider calls, including two cancellations of the old completed receipt, unchanged completed output, and no additional provider calls. A real service regression also rejects observation through a foreign Session while preserving the actual owner's pending ticket. The current Plan/Shell composition fixture verifies delivery remains blocked behind pending approval. Packaged Desktop verification is recorded in the feature document when completed.

Shared integration verification: all 21 workspace typechecks passed, and the combined native Shell/media/Plan suite passed 68 tests / 623 assertions. Shared CLI and freshly rebuilt Desktop passed Shell nine checks / 26 calls each and media-options five checks / eight calls each. These are scoped gates; the earlier full-unit checkpoint is not claimed for the later integration.
