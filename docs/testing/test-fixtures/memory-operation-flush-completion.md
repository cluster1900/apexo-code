# BUG-20261015-294: Explicit flush fixture assumed no_work instead of a completed barrier

- Scope: New native Memory operation UI acceptance fixtures.
- Observed: A real explicit flush after automatic capture returned completed with processed=0 and topics=0. The UI correctly displayed that result, but the fixture waited for no_work and timed out.
- Expected: Distinguish successful completion of the explicit durable capture barrier from the absence of new extracted observations.
- Cause: The fixture assumed zero new work implied no_work. The native flush implementation completes the existing barrier with zero processed entries; this differs from migration's idempotent no_work semantics.
- Correction: Assert completed with zero processed entries and unchanged provider activity. Production behavior and timeouts are unchanged.
- Verification: Corrected browser/native-window acceptance and all four terminal mode/size combinations passed the actual completed flush receipt with processed=0. Dream count remained one and repeated original work did not add provider calls. The original real response and displayed completed result establish the fixture mismatch; no product repair is claimed.
