# BUG-20261015-308: Manual compaction supplied placeholder source sequences and an empty budget request

- Scope: the native manual-compaction input supplied to the new structured automatic Memory boundary.
- Observed: the B1 exact-source guard rejected eligible manual compaction and no automatic receipt was created; the positive threshold case timed out while the low-threshold skip case passed.
- Expected: source identity uses durable message sequences from the same selected history, and budget estimation receives the selected conversation rather than an empty placeholder.
- Root cause: manual compaction mapped context messages to array-index seq values and passed messages=[] in its configuration/header request. Those placeholders were sufficient for the old compaction-only caller, but were not durable source proof or a truthful conversation budget.
- Fix: SessionHistory.loadEntries preserves durable seq alongside each decoded message. Existing load maps those same entries to messages; manual compaction consumes one loadEntries selection for both context and exact source. Its budget request uses canonical toLLMMessages lowering. Existing Goal checks and accounting remain; no second provider call or extra history selection is added. Automatic runner paths already use entriesForRunner and their full request.
- Verification: the positive and negative actual headroom cases plus accepted Stop passed 3 tests / 10 assertions. The positive case captures both original source topics before compaction projection, with one summary call and one automatic flush. Core and Apexo typechecks passed.

Final B1 verification: the complete legacy/V2 lifecycle gate passed 56 tests / 277 assertions, and Core/Apexo typechecks passed. Source CLI and rebuilt Desktop backend each verified original source capture at actual compaction with one summary and one automatic flush as part of the nine-check automatic acceptance.
