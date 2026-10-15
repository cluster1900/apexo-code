# BUG-20261015-252: Output deduplication omitted assistant identity

- Status: verified in private canonical projection tests and local/pure-native CLI matrices.
- Scope: native headless presentation only.

Two assistant turns in the same input may reuse a provider fragment ID. A regression applying real canonical events to the output adapter expected FIRST and SECOND but observed only FIRST. The initial presentation map keyed completed output and streaming offsets by fragment ID alone, suppressing the second assistant's content.

Deduplicate with assistant message ID plus fragment ID, including tool status and text offsets. This does not change persisted messages, native event projection, or provider execution. Replay still emits each logical item once.

`bun test test/cli/native-headless-output.test.ts` failed one of four tests before the correction and passed all four tests / twelve assertions afterward. Other cases retain old/new input attribution, global-notification filtering, strict malformed Session validation, full-value recovery, and once-only terminal output. No unrelated occurrence count is inferred.

Shared integration verification: fresh compiled local headless15/20, compiled file handling7/4 and rebuilt mixed Desktop17/22 pass; compiled startup cancellation3/0, active races3/3 and pre-start rejection7/0 also pass. Refreshed shared Core and Apexo package typechecks pass. Commands and exact evidence boundaries are retained in [the shared headless checkpoint](../../native-headless-cli.md#shared-integration-checkpoint); these checks do not replace final repository gates.
