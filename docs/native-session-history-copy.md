# Native Session history copy

This primitive is the context foundation for Workflow `resume_from`. It does not admit a Workflow source by itself: the caller must prove direct-child ownership, terminal state, current policy and source placement before importing into a fresh managed child.

The fixed behavioral reference creates a fresh related child and copies the source transcript and tool state, with usage context but without plan state or signals. The relevant source is `agent/subagent/mod.rs::bootstrap_initial_context`, using `CopySessionOptions` with `copy_usage` and `copy_tool_state`. Durable resume metadata accepts completed, failed and cancelled children. The native adapter is described in [Workflow resume](native-workflow-resume.md); worktree reconstruction remains separate.

## Durable boundary

`SessionHistoryCopy.capture` reads the canonical ordered native transcript and Todo state inside a database transaction. Its source proof includes the Session ID, Created event ID and durable revision. Copying checks this proof and the Todo snapshot at every durable commit. The target must have no transcript, inbox or context epoch, and retain its own Created identity and expected revision.

The target receives one Started event, one Message event per canonical message, and one Completed event. Native message sequences are unique, so individual message events preserve ordinary chronological projection and pagination. The completion event projects the Todo snapshot. The source is unchanged. Every copied message receives a fresh global ID; synthetic message Session IDs map to the target. Original IDs are recorded as provenance. Tool inputs, results, output references, provider metadata, attachments, assistant usage and compaction records retain their canonical content.

Copies never publish Prompted, Step settlement or tool-execution events. Historical user messages do not create inbox rows. Historical usage remains transcript context and never creates a transport receipt or contributes to the new Session, Workflow or Goal billing. Agent/model switch history does not alter the target's pinned selection. Task owners, permission requests, shell processes, Goal attempts, schedules and leases are not imported.

An interrupted copy cannot run, even if it contains a plausible partial transcript. The runner checks the Started/Completed evidence before promoting an input or selecting a provider. An incomplete copy is not resumed automatically: the caller must create a new child. Fully completed copies reconcile exact repeat calls without new events. Replay reconstructs the imported messages and Todo state without requiring the old source Session to remain present; a replayed partial copy remains quarantined.

## Current context and failed history

The target does not copy the source Context Epoch or live domain producers. Current producers initialize its epoch after the import. The new baseline sequence excludes historical system updates from provider context, while those updates remain visible in the durable transcript. Compaction selection remains owned by SessionHistory. Failed or cancelled historical tools use the runner's existing interrupted-tool settlement before provider lowering; they do not restart the old tool.

## Verification

Pinned Bun 1.3.14: `bun test test/v2/history-copy.test.ts test/v2/history-copy-runtime.test.ts --timeout 30000` in `packages/apexo`: two tests, 43 assertions, no failures. Cases cover full data and ID mapping, source immutability, source revision/Todo/Created changes, exact retry, canonical replay after deleting the source, replayed partial-copy quarantine, fresh current SystemContext, and a real provider turn consuming copied failed history. The incomplete-copy runner test leaves its admitted prompt unpromoted and produces no additional provider request.

After canonical SDK and Client generation, `bun typecheck` passes in both `packages/core` and `packages/apexo`. The composed focused Workflow/history/end-to-end gate passes 45 tests and 365 assertions. No generated sources were edited by hand. The real CLI resume harness passes five checks / three provider calls, and the isolated installed reference passes its completed-source continuation comparison. Rebuilt Desktop acceptance and aggregate gates remain coordinated integration checks.
