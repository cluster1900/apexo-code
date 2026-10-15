# BUG-20261015-304: Metadata skipped a settled stopped tool before assistant completion projection

- Scope: the new native legacy metadata selector at the existing stopped-source observer boundary.
- Observed: stopping a real executing shell tool reached SessionMemoryObserver.capture with its exact assistant ID after the tool had settled to error, but no metadata checkpoint was produced.
- Expected: the explicitly owned stopped-source boundary may preserve bounded deterministic metadata without running an auxiliary model.
- Reproduction: complete two real user turns, start a third real prompt invoking a held shell tool, wait for the tool's file marker, then interrupt the Session and inspect its metadata note.
- Root cause: the selector required assistant time.completed for every source. At this existing callback, tool fibers and their results have settled, while the assistant completion event may be projected after the callback. Captured raw projection evidence showed the exact stopped assistant with an error tool and no completion timestamp; the final projection had its completion timestamp.
- Fix: only for the explicit stopped assistant ID supplied by the existing owner callback, accept the source when all tool states are terminal and count that assistant. Ordinary checkpoints still require a completed, successful assistant. No runner, execution or completion event semantics change; no synthetic completion is written.
- Verification: passed the real stopped-shell-tool case in the complete five-file regression gate: 61 tests, 365 assertions, zero failures on Bun 1.3.14. Core and Apexo typechecks passed.
