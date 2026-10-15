# BUG-20261014-080: Side-question adapter message ID import

- Scope: new V1 side-question adapter; one observed typecheck failure.
- Observed: `bun typecheck` in `packages/apexo` rejected the nonexistent `@apexo/schema/message-id` module.
- Expected: the adapter uses the existing Session message ID schema.
- Reproduction: typecheck the initial side-question adapter.
- Root cause: assuming the shared schema package exposes a standalone message-ID module.
- Fix: import `MessageID` from the existing local Session schema barrel.
- Verification: `bun typecheck` in `packages/apexo` after HTTP group registration reports no side-question diagnostics; only concurrently edited hook-stop fixture errors remain. App and TUI package typechecks both pass. The focused side-question store suite passes 3 tests and 14 assertions. No runtime failure was observed.
