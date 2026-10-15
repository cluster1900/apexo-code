# BUG-20261015-056: Task reference fixture assumed a different installed catalog

- **Type:** Reference fixture; one authoring episode.
- **Scope:** Isolated installed Grok Build 1.0.52 Task comparison.
- **Observed:** The first comparison failed with `Missing tool send_subagent_message`. Its initial spawn also used the pinned source's `run_in_background` name, although the installed catalog uses `background`.
- **Expected:** Invoke only fields and tools advertised by the exact installed runtime, and distinguish its behavior from pinned source inspection.
- **Cause:** The fixture assumed the pinned source and installed version exposed identical Task catalogs. A background result with the unsupported field did not prove that field was accepted because background is the installed default.
- **Fix:** Read the installed definitions, use `background`, and record that this version does not advertise the active-message tool. Compare completed `resume_from` behavior without claiming same-child steering.
- **Verification:** Corrected isolated installed comparison passed five checks with three actual child provider requests and 29 total requests including ancillary traffic. Spawn/output/cancel and completed continuation were exercised. `resume_from` created a new child. Cancellation reached terminal cancelled status; physical socket closure and automatic completion wake were not asserted.
