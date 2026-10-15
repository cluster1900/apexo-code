# BUG-20261014-072: Stop acceptance fixture setup and deadline

The missing ChildProcessSpawner setup mistake is the second independent occurrence tracked in [BUG-20261014-021](goal-cleanup-fixture-layer.md) and is governed by [RULE-20261014-003](../../rules/scoped-temp-fixture-spawner.md). The unrelated deadline and returned-path mistakes below are not counted toward that rule.

- **Scope:** New durable Stop unit and CLI fixtures.
- **Observed:** Two persistence tests failed before assertions because `tmpdirScoped` requires `ChildProcessSpawner`; its layer was absent. The first CLI continuation check passed, then the nine-turn cap scenario exceeded its initial ten-second polling deadline.
- **Expected:** Fixtures provide their real filesystem/process dependencies and allow bounded multi-turn execution to settle.
- **Root cause:** Missing test process-spawner dependency is confirmed. The first cap timeout remains under investigation until a longer bounded run and provider/event evidence establish whether the application is correct.
- **Fix:** Add the real CrossSpawnSpawner layer; retain provider/event diagnostics on failure; allow sixty seconds for nine actual provider turns.
- **Initial verification state:** Pending rerun when first recorded; final verified results are documented below. A timeout alone is not treated as an implementation defect or proof of a fix.
- **Occurrences:** One setup run (two tests), one CLI timeout.

The first dependency-corrected run exposed a second fixture setup error: `tmpdirScoped` returns the path string directly, whereas the Promise fixture returns an object with `.path`. The persistence setup now uses the returned string. This is a separate setup mistake in the same new fixture, not a repeated occurrence of the missing-layer root cause.

The longer CLI run still timed out, so latency was not the cause. Persisted evidence showed exactly two provider turns per case; the second assistant had no text after the fixture repeated identical assistant text. The cap hook branched on that missing text and force-stopped. The provider now emits distinct numbered text each turn. The cap assertion remains nine completed assistant turns and eight actual gate calls. The exact provider-adapter suppression mechanism was not isolated; this is a fixture-input correction, not a claim to fix that independent behavior. The corrected CLI fixture passed all five Stop scenarios, including the unchanged nine-turn/eight-gate assertions.

Final durable Stop unit tests passed (12 focused tests, 45 assertions including all other host/dispatcher tests); package typecheck passed after the fixture type correction.

The first successful native continuation then failed a raw provider-role assertion. Inspection confirmed one durable user admission plus a durable `system` message carrying the Stop context. The established provider adapters lower chronological system messages to user-role wire entries; this is separate from durable user admission. Native acceptance now checks the real system-message provenance and exactly one durable user message. The V1 wire assertion remains intact. Native CLI and production Desktop reruns passed all five scenarios. Production Desktop V1 also passed the same five scenarios.

The independent returned-path mistake is consolidated under [BUG-20261014-075](feedback-directory-return-type.md), which now records three verified fixture-authoring episodes and links [RULE-20261015-007](../../rules/scoped-temp-fixture-return-shape.md). It remains separate from the missing-spawner recurrence.
