# Native legacy Memory: explicit flush and recall

This tranche adds explicit legacy flush and initial/post-compaction recall to native Apexo Sessions. Apexo owns admission, model calls, permissions, storage and cancellation; no installed Grok executable or orchestration code participates in the implementation.

## Behavior

The existing Memory flush operation admits a durable legacy plan containing the exact Created identity, Memory mode revision, maintenance generation, bounded completed source turns, selected model and variant, source authority, and prior destination content/hash. SessionMemoryOperation keeps exact request retries passive and explicit operation retries attached to that captured source. Later ordinary user turns cannot replace it.

The Location-scoped MemoryLegacyNative leaf uses the canonical LLM client, no tools, the existing MemoryFlush Markdown/NO_REPLY parser, and generic Memory storage. It checks captured plus current authority, canonical external-directory/read/edit access, mode, Created identity, generation and destination hash. It joins cancellation and serializes publication with the existing file/maintenance locks. Source markers deduplicate successful and empty outcomes.

MemoryContextNative uses the canonical lexical search and formatting implementation. Initial and real-compaction epochs persist selected context; every exposure rechecks permissions, mode and clear generation. Revocation removes the prior SystemContext source. Search is passive and does not call a model or request permission. Query text comes from the authoritative latest user row rather than assistant text or historical tool arguments.

The canonical native `compaction.memory_flush` configuration now accepts ConfigMemory.Flush. Explicit flush consumes `flush_model` and `max_flush_write_chars`. The original handoff omitted V1 migration forwarding. The reviewed supplement now forwards this field and includes a real V1 document regression for a custom flush model and character limit; shared verification of that supplement is pending. Automatic trigger settings are accepted configuration, not implemented triggers in this tranche.

## Scope boundary

Metadata checkpoints, automatic idle/threshold/pre-compaction flush, legacy Dream, batch Dream and vector retrieval remain deferred. Compaction is not treated as Session end. SessionRunner, SessionExecution, checkpoint machinery, App/TUI and recovery storage are unchanged. Existing public operation endpoints carry legacy receipts; no Protocol or Server HttpApi shape changed, so client generation is not part of this handoff.

Desktop evidence below exercises the rebuilt Electron backend through public HTTP. It does not claim interactive GUI acceptance.

## Private verification

Pinned Bun 1.3.14; commands use their explicit package working directories.

- Core `bun typecheck`: passed.
- Apexo `bun typecheck`: passed; final fixture configuration refinement was checked separately.
- Apexo `bun test test/v2/memory-legacy-native.test.ts`: 8 passed / 46 assertions. Covers persisted/deduplicated flush, source-stable retry, current permission/mode/clear denial, cancelled held inference, epoch-stable recall, real post-compaction refresh, replacement Created identity, NO_REPLY, configured flush model and Unicode output limit.
- Apexo five-file Memory regression (`memory-legacy-native`, `memory-context`, `memory-native`, `memory-lifecycle-native`, `memory-dream-native`): 48 passed / 301 assertions before the final fixture-only configuration assertion refinement.
- Apexo `bun script/grok-memory-legacy-native.mjs cli`: four public checks passed, two ordinary provider requests and one flush request.
- Desktop `APEXO_CHANNEL=dev APEXO_VERSION=0.0.0-memory-legacy bun run build`: passed. Apexo `bun script/grok-memory-legacy-native.mjs desktop`: same four checks and request counts passed against that rebuilt backend.

The public checks establish effective legacy backend on admission, empty/passive zero-model behavior, one explicit flush, exact and explicit retry deduplication, initial recall in the actual provider system message, and disabled admission with zero transmission. Post-compaction recall is proven by the native real-compaction test, not claimed as separate CLI/Desktop UI evidence.

## Behavioral reference and limitation

Source reference is Grok Build revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`: `xai-grok-shell/src/session/acp_session_impl/memory_dream.rs`, `session/helpers/memory_flush_window.rs`, `session/helpers/memory_context.rs`, and `session/memory/hooks.rs`. The inspected source distinguishes legacy flush, initial recall and post-compaction recall; upstream tests are not counted as Apexo verification.

The isolated `grok-memory-legacy-reference.mjs` probe uses installed Grok 1.0.52 (`0920c8169e27`), a disposable workspace/home, a strict environment whitelist, a loopback-provider-only macOS sandbox and joined process cleanup. It proves the real home and unrelated port are denied and the owned provider/workspace are available. Although configuration requests `[memory_v2] enabled = false`, the passive listing contains generated V2 topic/observation artifacts. It makes zero provider requests and labels the result `backend-probe-only`, with `definitiveLegacy: false`. Installed legacy runtime parity is therefore unresolved; this tranche's legacy behavioral comparison is source-only.

## Recorded failures

[BUG-20261015-300](testing/test-fixtures/native-memory-legacy-retry.md) records the corrected transport-retry fixture; [BUG-20261015-301](testing/test-fixtures/native-memory-legacy-http-symptom.md) retains the unresolved intermittent local HTTP symptom; [BUG-20261015-302](testing/test-fixtures/native-memory-legacy-disabled-status.md) records the corrected public conflict status. Existing generic Effect inference, private-service fixture and source-copy build records are updated rather than duplicated.

The reviewed 17-file candidate is integrated with original/final hashes checked. The results above are its private evidence. Shared five-file implementation tests pass 48 tests / 302 assertions; Core/Apexo types pass. Source CLI and the then-rebuilt Desktop backend each pass four checks with two ordinary and one flush request. The subsequent V1 migration supplement and deterministic metadata stage are also integrated: the real V1 migration regression passes within the shared Memory gate, and all 21 workspace typechecks pass. The expanded source CLI now passes five checks with four ordinary and one flush request. See [metadata checkpoints](native-memory-metadata.md) for the later stage. Installed legacy runtime equivalence, automatic lifecycle and final repository gates remain open. These are backend checks; the separate Memory operation UI has its own native-window acceptance. No merged-feature claim is made.
