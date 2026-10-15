# BUG-20261015-236: A draft locale helper shadowed Python's standard library

- Status: Corrected private fixture; no shared product change.
- Scope: The Scheduler private checkpoint refresh helper. One authoring episode.
- Observed: Python `subprocess.check_output(..., text=True)` failed with `AttributeError: module 'locale' has no attribute 'getencoding'`. Its diagnostic explicitly identified a neighboring draft `locale.py`. Importing that script also repeated its top-level owned dictionary insertion.
- Expected: Refresh uses the standard-library locale module and preserves a single copy of each new UI key.
- Cause: A draft authoring helper was named exactly like Python's standard-library module and executed edits at import time.
- Fix: Rename it to `write-scheduler-copy.py`; restore the four affected owned files from their verified unchanged shared bases and apply the owned additions once. Run the full coherent refresh, not a partial dependency update.
- Verification: The corrected refresh copied and revalidated 5,571 source hashes, retained 27 explicitly owned files after checking their bases, and removed the obsolete private migration. Frozen-lock installation reported no changes. Shared sources were never modified by the failed or corrected helper. Dictionary duplicate and placeholder checks are part of final localization validation.
