# RULE-20261015-014: Validate decoded event notifications on the type side

- **Scope:** Generic EventV2 listener fixtures inspecting an in-memory notification.
- **MUST:** After matching the canonical event name, validate unknown payload data with `Schema.toType(EventDefinition.data)` before accessing its fields. Use the encoded codec when reading stored JSON or an actual wire representation.
- **NEVER:** Re-decode an already decoded notification with its wire codec, cast away unknown, or assume the event-name comparison narrows generic data. Optional explicit undefined properties and decoded timestamps must retain their runtime representation.
- **Verification:** Exercise the real listener and its awaited barrier, then run the package typecheck. A child completing while the observer times out does not verify the intended held-start race.
- **Source:** [BUG-20261015-079](../testing/types/sandbox-created-listener-payload.md), four independent fixture authoring episodes: command sandbox Created, Plan crash notification, Scheduler Created startup barrier, and Memory Text.Delta Stop readiness.
