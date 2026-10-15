# BUG-20261015-231: Prompt replay depended on process liveness

- **Scope:** Private native headless input projection.
- **Observed:** After a proven-dead owner and a new canonical prompt, the old input had process_restart reason. Replaying the same real EventV2 event sequence produced superseded instead. The ordered replay regression failed with expected process_restart and received superseded.
- **Expected:** Durable projection is deterministic from durable events. Machine-local process availability must not change the replayed result.
- **Root cause:** The Prompted projector used a process PID probe to choose the old input's terminal reason. Operational owner stamps are deliberately not recreated by event replay.
- **Correction:** A newly promoted input deterministically supersedes prior unfinished headless input. A passive read may derive interrupted/process_restart only when the recorded process is proven absent, without persisting a terminal event or authorizing continuation. A subsequent canonical prompt supersedes that old input consistently.
- **Verification:** The corrected ordered real EventV2 replay regression passed in the final combined backend gate: 39 tests / 301 assertions, zero failures. Final Core and Apexo package typechecks passed. Unknown/live ownership and service replacement remain non-interrupted in the same test.
- **Occurrences:** One confirmed private implementation episode.
