# Native Memory Context Delivery Plan

Status: automatic native Memory V2 Context Source implemented and accepted on macOS.
CLI and rebuilt Desktop each passed seven scenarios and twelve provider requests.
The installed official runtime passed five context comparison cases. This is a
scoped checkpoint, not completion of all Memory V2 capabilities.

## Existing boundaries

Compatibility Sessions already pin a memory backend and rollout in
`session_memory_backend`, store session overrides in `session_memory_mode`, and
persist selected memory context in `session_memory_context`. `MemoryV2Catalog`
owns global/workspace discovery, storage revisions, bounded rendering and path
access checks. Those first-party stores should serve native Sessions too.

The native runner uses `SystemContext` and Session-owned Context Epochs. It must
not call the compatibility prompt loop or import compatibility application
services into Core. A Location-scoped memory producer can accept a Session ID
when loading a source, just as other domain producers supply the composed
context; it must not create a Session-ID-scoped layer or another executor.

## Implementation sequence

1. Preserve `memory` and `memory_v2` configuration in native `Config.Info` and
   V1-to-native migration using the existing `ConfigMemory` schemas. Regenerate
   configuration and public client outputs through their generators when their
   exposed contracts change.
2. Share the backend pinning and effective rollout rules without weakening
   existing compatibility behavior. A later configuration can restrict a pinned
   backend; it cannot silently migrate an existing Session to another store.
   Process force-off, session overrides and file-write policy keep their existing
   precedence. Read-only Workflow children must not bypass those decisions.
3. Add a read-only permission snapshot through the native permission service.
   Reuse its configured-agent hard-deny, session-rule and saved-approval
   evaluation. Automatic memory loading must never create a permission request,
   treat `ask` as `allow`, or duplicate a weaker permission evaluator. Revalidate
   selected paths before publishing newly loaded context.
4. Implement a Memory-owned native Context Source using `MemoryV2Catalog`, with
   immutable initial/compaction selection and durable selected paths. Include
   mode and storage revision in cache validity. Memory additions do not rewrite
   the admitted prefix; deletion, revocation and disabling invalidate it. A
   denied or disabled source must emit removal/empty-state semantics rather than
   `SystemContext.unavailable`, which intentionally preserves prior context.
5. Compose this source in the existing native runner's context load, before
   provider execution and through `SessionContextEpoch.initialize/prepare`.
   Keep the existing one-stream-per-provider-turn rule, chronological context
   updates, compaction replacement, and explicit queue/steer delivery unchanged.

## Required acceptance

| Boundary | Required evidence |
| --- | --- |
| Configuration | Native and migrated configurations retain both memory sections; schema-invalid input cannot imitate a runtime memory failure |
| Permissions | Agent hard-deny cannot be overridden by saved allow; session deny and `ask` suppress automatic reads without opening approval UI; canonical and alias paths both checked |
| Persistence | Reopen preserves backend and selected context; current policy can restrict it; no automatic capture/dream work is invented by reopening |
| Context | First native request includes allowed saved memory; ordinary turns retain the selection; compaction refreshes it; forgotten/revoked/disabled content is withdrawn through Context Source semantics |
| Isolation | Two Sessions with different memory mode/permissions do not share context; Workflow child authority remains bounded |
| CLI/Desktop | Real native Sessions reach an isolated provider through CLI and freshly rebuilt Desktop; inspect actual provider requests and durable events |
| Official comparison | Run the corresponding installed Grok context/mode cases separately; record source/version differences without counting upstream tests as Apexo verification |

Capture classification, batch Dream, semantic/vector retrieval, durable
management operations and remaining recovery combinations are separate open
requirements. Completing native context delivery does not complete all of
Memory V2.

## Accepted implementation and semantic limits

Native configuration and V1 migration retain the existing memory fields. The
shared backend selector preserves pinned storage and rollout restrictions. The
Location-scoped Context Source uses the native permission service's read-only
authority snapshot; `ask` and hard deny never open an automatic approval request.
Selection is persisted across ordinary turns and process reopen, and real native
automatic compaction refreshes the memory index. Mode, generation and path
authority are checked again before publishing cached content.

Native System Context uses chronological updates: disabling or revoking a source
appends a durable withdrawal; forgetting a note produces a replacement-source
update. The previously admitted baseline remains in conversation context until
compaction replaces it. This is **not** a claim that historical text has been
erased or that an earlier provider has forgotten it. Compatibility context
removal and native chronological updates remain distinct semantics.

Verification:

- `bun test test/v2/memory-context.test.ts test/tool/memory-backend.test.ts test/tool/memory-context.test.ts test/permission/next.test.ts` from `packages/apexo`: 88 tests, 190 assertions, zero failures.
- `bun typecheck` from `packages/core` and `packages/apexo`: passed at this checkpoint.
- `node script/grok-memory-native-context.mjs cli` and `desktop` from `packages/apexo`: seven scenarios and twelve provider requests each. They seed Apexo-owned storage through compatibility management, then execute all tested turns through native `/api/session` endpoints.
- `node script/grok-memory-scopes-official.mjs --context`: five installed-runtime context cases (both manifests, stable prefix, resume, new Session, post-compaction refresh); separate from Apexo verification.

The acceptance exposed unavailable native `wait` and manual `compact` APIs,
tracked in [BUG-20261014-137](testing/runtime/native-session-controls-unavailable.md).
It exercises actual automatic compaction and observes active execution instead;
those observations must not be counted as manual API implementation.
