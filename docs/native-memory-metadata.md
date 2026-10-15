# Native legacy Memory metadata checkpoints

B0 adds deterministic metadata checkpoints to native legacy Memory. It uses the existing activity and pre-compaction observer callbacks; it does not declare a durable Session shut down, change SessionRunner/SessionExecution, or write from a retirement finalizer. The existing `memory.session.save_on_end` setting controls the native activity-checkpoint mapping, including an explicitly stopped source after its tools settle. There are no auxiliary model requests.

## Data and ownership

A Location-scoped native selector aggregates real chronological user counts and query bytes directly in SQLite. It requires three nonempty real user messages and fifty total UTF-8 query bytes, excludes synthetic messages and the automatic continuation sentinel, and returns at most five topics of one hundred Unicode characters plus at most 128 distinct assistant authorities. It reads durable rows rather than the post-compaction context projection, so a checkpoint after compaction retains the original chronological metadata.

The immutable plan carries Created identity, source assistant ID/sequence/hash, source time, mode revision, maintenance generation and captured authorities. The current actor and inherited source authority must allow canonical external-directory/read/edit access. Disabled/headless/managed/active-Goal exclusions remain on the existing ownership path. A stopped ID is trusted only when supplied by the existing owner callback and its tools are already terminal; ordinary incomplete assistants remain ineligible.

MemoryMaintenance.writeEffect shares the existing Promise API's canonical scope resolution and generation marker. It acquires the same scoped maintenance lock before running Effect authority checks. Metadata then acquires its destination lock before revalidating current authority, Created identity and source content. No detached runtime is created. Mode changes, cancellation and deletion join the registered work; clear either precedes the generation check or follows the serialized write and removes it. An invalidated operation cannot recreate a cleared scope afterward.

Publication reuses the bounded guarded file writer. A native marker includes Created identity, source sequence and content hash. Exact repeats do not rewrite the file; an older watermark cannot replace a later checkpoint. The existing metadata header and summary/topics format remain searchable through the normal Memory catalog.

## Verification

Private pinned Bun 1.3.14 validation:

- Core and Apexo package typechecks passed.
- The complete regression gate passed 61 tests / 365 assertions across memory-legacy-native, memory-lifecycle-native, memory-native, memory-dream-native and memory-context. The legacy file contains 21 tests including byte/sentinel and older-watermark cases.
- Real held shell-tool Stop produced a checkpoint after the tool became terminal, without auxiliary inference.
- Six held-storage cases verified deny, ask, disable, delete, cancellation and clear; repeated checkpoints preserve file contents and mtime.
- Actual native compaction preserves three chronological real topics and counts, with only its expected summary model request.
- Public CLI acceptance passed five checks, with four ordinary calls and one explicit flush call. The metadata note after three real prompts is read through the actual native catalog/preview endpoints, with no extra model calls.
- The rebuilt Electron Desktop backend passed the same five checks, with four ordinary calls and one explicit flush call. This is backend/API evidence, not an interactive GUI claim.

The isolated installed legacy-backend limitation from [tranche A](native-memory-legacy.md) remains unchanged. This checkpoint mapping follows Apexo's durable activity semantics; it is not a claim that a native drain is equivalent to the reference actor's shutdown.

### Shared integration acceptance

The metadata, recovery-readiness and V1 configuration supplements are integrated. Shared Memory/lock validation had 70 passes and two HTTP fixture route failures; after correcting the published route, both pure/mixed Memory HTTP hosts pass within a separate 54-test / 495-assertion Task/Memory regression. All 21 workspace typechecks pass. The canonical lock cancellation correction below has its own failing-before/passing-after evidence.

From packages/apexo, `bun script/grok-memory-legacy-native.mjs cli` and `bun script/grok-memory-legacy-native.mjs desktop` each pass five checks after a fresh complete Desktop build: effective legacy empty flush, persisted/deduplicated explicit flush, initial recall, real metadata checkpoint and disabled admission. Each makes four ordinary calls and one flush call, with no auxiliary metadata inference. This is public API/backend evidence, not completion of automatic lifecycle or installed legacy runtime equivalence.

## Failures and follow-on scope

[BUG-20261015-303](testing/test-fixtures/native-memory-metadata-event-timestamp.md) records the typed synthetic-event fixture correction. [BUG-20261015-304](testing/runtime/native-memory-metadata-stopped-boundary.md) records the stopped-boundary selector fix. [BUG-20261015-305](testing/test-fixtures/native-memory-metadata-lock-release.md) records the fixture's duplicate lock release correction. These do not create a recurring constraint.

Automatic idle/threshold/pre-compaction model flush, legacy Dream, batch Dream and vector retrieval remain outside B0. The richer execution/compaction callbacks and prepared-output recovery stage are design proposals awaiting separate review.

## Follow-up lock acquisition finding

The readiness amendment joins bounded recovery persistence before releasing its acquired lease. A subsequent automatic-lifecycle test reached the actual maintenance-lock wait and found that the existing Flock.effect acquisition defers interruption. Earlier cancellation checks did not establish cancellation after acquisition had begun waiting. The shared utility correction now passes real waiting/late-acquisition cancellation and existing dead-owner regressions; see [BUG-20261015-326](testing/runtime/flock-effect-acquisition-cancellation.md). This does not complete the separate automatic-lifecycle workstream.
