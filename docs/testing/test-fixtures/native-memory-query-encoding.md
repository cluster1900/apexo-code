# Native Memory adapter query assertion

- **Bug ID:** BUG-20261015-164.
- **Scope:** The native Memory UI adapter's real HTTP test fixture.
- **Observed:** The initial six-test run passed four safe-error cases and failed both route inventories. The fixture expected spaces encoded as `+`; the generated SDK sent equivalent `%20` encoding. The native and compatibility methods, paths and request bodies were otherwise correct.
- **Expected:** Check the decoded search value and the selected endpoint family without prescribing an encoding spelling that is not part of the API contract.
- **Root cause:** One fixture-authoring episode incorrectly treated `URLSearchParams` serialization as the generated SDK's wire contract. The two transport cases are not separate occurrences.
- **Fix:** Assert pathname/method inventories and decoded `query` or `search` and `path` values. Keep exact reviewed-hash payload checks and the no-probing/no-fallback assertions.
- **Verification:** From `packages/app`, `bun test --conditions=solid --preload ./happydom.ts src/utils/session-memory.test.ts`: six tests / 28 assertions passed. No SDK or production implementation change was required for this failure.
