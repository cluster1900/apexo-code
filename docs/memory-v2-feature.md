# Memory V2 implementation contract

Updated 2026-10-15. This page describes the current architecture and separates implemented behavior from remaining acceptance work. Earlier stage documents retain their historical checkpoints; their old lists of future work are not the current feature inventory. The detailed execution log is [Grok Build implementation progress](grok-build-implementation-progress.md).

Apexo owns Sessions, native provider execution, permissions, Memory storage, operation receipts, CLI and Desktop. Grok Build is a source and isolated-runtime reference, never an embedded executor. The fixed source is `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`; installed comparisons use Grok 1.0.52 (`0920c8169e27`). Source inspection and upstream tests do not verify Apexo behavior.

## Backend selection and supported surfaces

Memory is opt-in. `memory_v2.enabled` selects V2 for new Sessions; existing Sessions retain their pinned backend. A native V2 Session can use either legacy or V2 Memory storage. Session protocol version and Memory backend are different identities.

| Capability | Current contract |
| --- | --- |
| V2 capture and flush | Native and compatibility adapters share the canonical capture store. Native capture uses Created-bound fixed sources; flush waits for its frozen target. |
| V2 context | Native System Context and compatibility context adapters expose bounded manifests and authorized reads. They do not start an alternate Session executor. |
| Management | Browse, preview, remember, rewrite, exact-hash forget, scope clear, health and capture diagnostics use the selected backend. |
| V2 Dream | Native explicit Dream and eligible live-capture follow-up use durable leases and prepared publication; shadow validates without exposing notes. |
| Optional V2 batch Dream | Native bounded action/plan protocol, durable per-note outcomes and exact recovery are implemented. Final integrated App/Desktop/terminal acceptance is tracked separately in [batch Dream](native-memory-batch-dream.md). |
| Legacy extraction and Dream | Native explicit/automatic extraction, manual/automatic Dream and consumed-source cleanup are implemented through existing native lifecycle ownership. See their linked contracts below. |
| Recovery and migration | Native operations expose exact previews, explicit discard/clear, curated carryover and relocation with durable ownership. |
| Semantic/vector retrieval | This is an optional **legacy** reference capability, not a V2 requirement. Apexo already has legacy lexical ranking, decay, source/access weighting and MMR. Optional embeddings, hybrid retrieval and semantic flush deduplication remain separate implementation work. |

The reference creates its hybrid search backend only for legacy Memory. V2 uses curated topics, observations and bounded context. Neither a comment mentioning experimental embedding providers nor a legacy feature description establishes a V2 vector contract.

## Storage, admission and publication

V2 data lives in `~/.grok/memory-v2/apexo/`, with global and stable project/worktree scopes. Apexo uses its own subdirectory and SQLite schema; it does not claim binary interchangeability with Grok's database. A scope contains `memory_state.sqlite`, immutable inbox observations, curated topics, archives and generated `MEMORY.md`.

Capture admission records an immutable bounded transcript and source identity. Exact retries require matching identity and content; conflicting or overlapping sources fail. Requested, captured and indexed cursors have distinct meanings: durable admission, persisted output, and completed file/index/manifest convergence. A cursor does not bypass unfinished earlier work. Native sources additionally bind the Session Created event and durable prompt/assistant identities, so deleted/reused Session IDs and unattributable historical sources cannot inherit authority.

Workers claim canonical jobs with owner/token/attempt proof. Model output is validated and durably recorded before immutable file publication; recovery replays those recorded bytes rather than sampling again. Publication checks current source hashes, permissions, mode revision, scope generation and ownership. Changed, deleted, oversized or redirected files are not silently overwritten or resurrected. Native passive status, Session load and process restart do not replay provider work; explicit recovery requires the recorded claim and proven ownership. Compatibility lease behavior is documented separately and must not be confused with native operation recovery.

Capture requests are tool-free and bounded. V2 flush waits for the target frozen at admission, rather than producing a legacy summary or extending the wait for every later turn. Cancellation of a flush wait does not rewrite its original source. Failed, retry-required, cancelled and timed-out outcomes remain distinct from completed work. Exact operation IDs reconcile receipts; explicit retry preserves the original request.

## Rollout, context and permissions

`off`, `record_only`, `shadow` and `active` remain explicit. Current configuration may restrict a pinned Session, but cannot silently promote its visibility. Hidden capture is retained without exposure to ordinary context or search. Manual confirmed notes have their own visibility. Capture, file-write, manual Dream and automatic Dream switches are checked at their relevant boundaries.

Native Memory observes the existing Session lifecycle and System Context registry. Sources are captured before real compaction replaces projection; automatic work is allow-only and does not open interactive permission prompts. Context prefixes remain stable within their recorded epoch, while deletion, clear, mode changes and revoked access invalidate unsafe cached material. New context is built from authorized existing data, not from a compatibility prompt loop.

Captured and current permission authority intersect. Native auxiliary work rejects unsupported headless, privately managed child and Goal-accounting contexts rather than bypassing their ownership. Cancellation, disable, deletion and owner shutdown join owned work. New durable input fences automatic publication. A configured capability is not permission to publish a late response after those checks change.

## Dream and batch outcomes

Default V2 Dream validates bounded create/update/delete/rename/merge/split plans against claimed evidence. The canonical store preserves a prepared plan before publication, recognizes exact already-written bytes during explicit recovery, and rejects foreign edits. Multiple filesystem paths do not become one atomic filesystem transaction; the durable journal provides exact settlement.

Optional native batch Dream adds bounded read actions and patch/insert/section/create/description edits. Related notes may share an edit, but every claimed note has one validated outcome and every edit has evidence. Applied and justified no-change notes count as processed. Pending deferred notes remain available; a third independent ordinary deferral archives a note as unplaceable. A mixed result is retry-required and exposes separate pending/unplaceable counts.

For a settled batch with deferred notes, **Run Dream** again starts a new attempt. **Retry original operation** settles only unfinished original work and preserves completed outcomes without another provider request. This distinction is shown by the adjacent App action and existing terminal Dream command. Batch behavior does not silently replace the older compatibility MemoryWork executor.

See [native Dream and migration](native-memory-dream.md), [batch Dream](native-memory-batch-dream.md), [manual legacy Dream](native-legacy-dream.md), [automatic legacy Dream](native-automatic-legacy-dream.md), and [consumed-source cleanup](native-dream-consumed-cleanup.md).

## Management, maintenance and limits

Remember creates an explicit independent observation; it does not impersonate automatic capture. Preview exposes bounded content and exact-byte hashes. Forget and clear use durable tombstones/generations before filesystem settlement, preventing old claims or capture history from recreating removed notes. Scope operations preserve other projects and the other backend. Prepared Dream ownership must be resolved before conflicting note mutations.

Retention defaults remain 30 days for archived observations and 14 days for terminal capture jobs, with bounded maintenance batches. Content-free health distinguishes disabled, empty, unavailable, pending and failed states without leaking note bodies or credentials. Optional capture diagnostics are transient and disabled by default. Compact manifests and topic-read counts remain separate from semantic retrieval.

Existing storage and scan limits are intentional and operation-specific: a manual note's accepted size is not the Dream input limit; a preview limit is not a deletion fingerprint limit; capture quotas are not the manual-file listing limit. Large-file integrity checks stream exact bytes before destructive settlement. Network filesystem handling and actual platform coverage retain the limitations recorded in the implementation log; macOS WebDAV proof does not imply tested NFS/SMB or all operating systems.

## Evidence and remaining work

Native source CLI, rebuilt Desktop, real browser/native windows, mini/fullscreen terminals, isolated installed comparisons and process-death controls are recorded per feature. [Native operation UI](native-memory-operation-ui.md), [native recovery](native-memory-recovery.md), [native lifecycle](native-memory-lifecycle.md), [native automatic work](native-memory-automatic.md), and [reference evidence](native-memory-reference-audit.md) describe those boundaries. Aggregate test counts belong to their exact source checkpoint and are not perpetual guarantees.

The installed legacy probe requested legacy mode but observed V2 artifacts. It establishes an effective-backend limitation, not installed legacy Dream or vector success. Legacy semantic implementation and its native acceptance remain open. Final batch UI acceptance and current whole-repository gates must be reported from their actual completed runs. Real-model quality, untested mounted filesystems/platforms and unsupported auxiliary accounting are not inferred from deterministic local-provider fixtures.
