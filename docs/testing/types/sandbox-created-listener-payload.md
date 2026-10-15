# BUG-20261015-079: Created-observer fixture assumed a narrowed generic payload

- **Scope:** Two isolated native command sandbox creation test callbacks; no product defect.
- **Observed:** Package typechecking reported `event.data is of type unknown` in the generic EventV2 listener callbacks. The preceding runtime suite passed13 tests/96 assertions, which did not establish type correctness.
- **Expected:** A generic event listener validates the payload with the canonical Created schema before reading its Session identity.
- **Root cause:** Comparing `event.type` with the Created event name does not narrow the generic EventV2 payload's unknown data to that definition's schema type.
- **Fix:** Validate the runtime type with `Schema.toType(SessionV1.Event.Created.data)` inside the matched callback before accessing sessionID. Preserve real listeners and actual atomic policy assertions.
- **Reproduction:** Run `bun typecheck` from `packages/apexo` with the original callbacks.
- **Follow-up fixture correction:** Applying the encoded-side decoder to the in-memory event rejected an explicitly undefined `info.workspaceID`. The public wire codec intentionally omits that property, while the listener receives the decoded runtime form. Diagnostic output identified that exact field. Validate the canonical type side instead; no event publishing behavior changes.
- **Verification:** The corrected two-file creation suite passed3 tests/19 assertions; the final private Apexo package typecheck passed. Diagnostic-only listener logging was removed before these runs. Core and Server package typechecks also passed.
- **Occurrences:** Four independent fixture authoring episodes, described below. Promoted in the private handoff to [RULE-20261015-014](../../rules/decoded-event-fixture-validation.md); shared index integration is owned separately.

## Second independent occurrence: Plan crash notification observer

The new Plan crash preload decoded the actual in-memory AgentSwitched/Tool.Success notification with the encoded schema. Its marker was never written: the listener log reported `Expected number, got DateTime.Utc` at `timestamp`. This is the same runtime-versus-wire codec assumption as the earlier Created observer, in an independently authored fixture. The separate unobserved-service construction error is BUG120 and is not another occurrence here.

Use `Schema.toType` on the canonical event definition before inspecting the real notification. The unchanged two-checkpoint script, `bun run script/grok-plan-crash.mjs cli`, then passed ten checks with six provider calls and reaped all children. No production event codec or notification ordering changed.

## Third independent occurrence: Scheduler admitted-start barrier

The new Scheduler runtime fixture applied the full encoded Created decoder to the real in-memory notification. Both startup barriers timed out. Bounded phase and durable-receipt inspection showed the actual scheduled child had already completed, while the listener reported `Expected string, got undefined` at `info.workspaceID`. This is the same runtime-versus-wire codec mistake; the repeated diagnostic runs are one episode, not additional occurrences.

Using `Schema.toType(SessionV1.Event.Created.data)` made the actual observer hold the child after Created admission and before worker registration. The delete case passed immediately; the now-reachable independent Stop receipt defect is recorded as BUG188. After that product correction and removal of diagnostic logging, `bun test test/v2/schedule-execution.test.ts` from `packages/apexo` passed three tests / 26 assertions, including explicit Resume crossing the held Stop. The expanded lifecycle/store gate passed five tests / 77 assertions, and the private Apexo package typecheck passed.


## Fourth independent occurrence: Memory stopped-source observer

The newly authored native Memory Stop fixture matched the canonical Text.Delta event but applied its encoded data schema to the already decoded notification. The real listener rejected `DateTime.Utc` where the wire form expects a number, so its readiness Deferred never completed and the test timed out. This is the same runtime-versus-wire decoder assumption as the three earlier independent fixtures. The preceding attempt to poll durable text before Stop is a separate readiness mistake recorded in BUG-20261015-216.

Validate `Schema.toType(SessionEvent.Text.Delta.data)` in the actual listener before reading Session, assistant and text identities. The corrected isolated Stop test passed one test / seven assertions; private Apexo package typechecking passed. A later unchanged Stop/automatic-capture pair passed two tests / 17 assertions. The distinct timing failures in one combined run remain unresolved under BUG-20261015-235 and are not counted as further decoder occurrences. No production event codec, timestamp or notification order changed.
