# BUG-20261014-240: Terminal Goal actions assumed compatibility routes

- Scope: shared terminal Goal panel and its action adapter.
- Observed: source inspection found that every Goal operation selected compatibility routes, including when the server only exposed native routes. This was a source-review finding, not a reported production incident.
- Expected: native-only servers use the native Goal API, while mixed servers retain the compatibility API.
- Reproduction: connect the production shared Goal panel to a native-only server and create, pause, resume, inspect reports, or clear a Goal.
- Root cause: the action adapter predated native Goal management and unconditionally selected the legacy generated client group.
- Fix: share the existing Plugins protocol probe, prefer available compatibility health, and select the native Goal group when only native health exists. A cancelled initial probe resets its cached promise. All Goal actions, including dynamically selected start/pause/resume operations and report operations, use the selected group. The stable outer terminal container is preserved.
- Verification: App, TUI, and Server package typechecks passed. Actual compatibility mini and fullscreen Goal fixtures passed. After separating cancellation from summary success in [BUG-20261014-241](../test-fixtures/goal-summary-cancelled-usage.md), the real compact and expanded native-actions PTYs each passed seven checks: cancelled-probe recovery, native create/pause/resume, unknown-usage summary rejection without losing completion, pending and completed summary rendering, report navigation without another model request, and confirmed clear preserving the transcript. Complete native-only terminal bootstrap is outside this narrow panel harness.
- Independent occurrences: one source-review finding.
