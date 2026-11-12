# RULE-20261112-001: Keep event inventory expectations current

- Scope: adding canonical public events and editing manifest integration tests.
- MUST: update explicit inventory-size expectations and assert every new event's canonical identity, uniqueness and intended current/live/durable membership in the same change.
- NEVER: remove legitimate distinct events or weaken duplicate checks merely to satisfy an old count.
- Verification: run `bun test test/event-manifest.test.ts` from `packages/apexo`, regenerate affected clients, then run the repository gate.
- Source: [BUG-20261015-264](../testing/test-fixtures/headless-event-manifest-count.md) records three independent occurrences: input execution settlement, history copy and structured code review.
