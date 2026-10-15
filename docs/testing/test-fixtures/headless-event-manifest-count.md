# BUG-20261015-264: Event inventory assertion omitted native input settlement

- **Scope:** The shared public event manifest integration test.
- **Observed:** The complete unit gate reported 4,313 passes, 19 skips, one todo and two failures. The inventory assertion expected 88 latest event types but the canonical manifest contained 89.
- **Expected:** The native input settlement event is included once and shares its canonical identity across the compatibility manifest and current server manifest.
- **Reproduction:** Run `bun test test/event-manifest.test.ts` from `packages/apexo`, or the repository unit gate.
- **Root cause:** The headless input backend added `session.next.input.execution.settled` to the canonical event inventory without updating the existing explicit inventory count.
- **Fix:** Update the expected count to 89 and assert the new event's canonical identity and current server inclusion. The production manifest is unchanged.
- **Verification:** The original complete gate failed as described. The shared `bun test test/event-manifest.test.ts test/session/processor-effect.test.ts` command passed 21 tests/104 assertions, including the corrected inventory and canonical identities. No successful complete rerun is claimed.
- **Occurrences:** One independent episode.

## History-copy inventory recurrence

A later frozen shared aggregate independently failed the same explicit-count assertion: expected90, received93. Canonical `SessionEvent.HistoryCopy.Started`, `.Message` and `.Completed` were added for Workflow resume, but the old count stayed unchanged. These are three distinct legitimate wire types, not duplicate registration. This is the second established occurrence of the stale inventory-expectation mistake; no recurring constraint is promoted yet. After the aggregate finished (4553 passes/eight failures), the expected count was updated to93 and all three events received explicit Latest, Durable and ServerDefinitions identity/uniqueness assertions. `bun test --timeout 30000 test/event-manifest.test.ts` from `packages/apexo` exits0 with5 tests/35 assertions. Production registration is unchanged. No successful replacement aggregate is claimed.
