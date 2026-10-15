# BUG-20261015-200: Scheduler runtime omitted a managed-ownership failure mapping

- Status: Fixed in the private Scheduler draft; shared integration is pending.
- Scope: Location Scheduler binding and native resume handler.
- Occurrences: One authoring episode, separate from BUG199's endpoint-constructor mistake.
- Observed: Server typecheck rejected the resume handler because `SessionManagedChildFailure` escaped the declared Scheduler failure boundary.
- Expected: Failure to verify private managed ownership must fail closed through the safe Scheduler domain contract.
- Reproduction: Typecheck Server after wiring the Scheduler resume handler to its real Location runtime.
- Root cause: `managed.managed` can fail, but the new bind method had not mapped that channel.
- Fix: Map the tagged managed-ownership failure to `SessionScheduleFailure` with code `denied` and a fixed safe message. Do not cast away the failure or expose its internal cause.
- Verification: Corrected Core, Server and Apexo package typechecks passed; actual CLI create, passive read and explicit future-only Resume passed in the four-check / six-provider-call acceptance. This verifies normal integration; no corrupt managed-row HTTP fixture is claimed.
