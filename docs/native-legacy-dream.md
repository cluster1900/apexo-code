# Native manual legacy Dream

This slice adds explicit Dream consolidation for native Sessions pinned to the legacy Memory backend. Previously the native Dream operation returned HTTP 403 without admission. The existing Memory operation UI, `/dream` action and native operation API now admit a durable `dream` receipt with backend `legacy`. Apexo owns the Session, provider call, permissions, operation worker, cancellation and persistence; no compatibility executor or installed Grok process implements this capability.

## Ownership and publication

The private plan captures Session Created identity, Memory mode revision, maintenance generation, selected agent/model and inherited permission snapshots. Read/edit and external-directory access intersect captured and current authority. A changed persisted selected Agent is rejected before inference, publication and explicit retry. Headless work, privately managed children and active Goal accounting contexts are rejected. Current Session source files are excluded.

One provider call uses the Core Dream prompt, no tools, a 120-second deadline and 128 KiB accumulated output bound. Preparation accepts at most 1024 candidate files, at most 32 selected documents, 64,000 bytes per session document, and one million bytes each for existing memory and state. Input uses the existing 32,000-byte admission threshold while keeping the last admitted document whole; therefore that threshold is not a strict total-byte maximum. The existing 16,000-byte prior-memory prefix and 16,000-Unicode-character output handling remain. Prior memory beyond the supplied prefix is retained. Durable operation admission also enforces its existing four-MiB plan limit. Snapshot reads are bounded even if a file grows while open.

Before publication, the operation persists the validated output and exact replacement state in its existing private receipt. Under canonical Dream/destination locks, maintenance generation fencing and the Memory mode commit fence, publication accepts only the recorded old bytes or the exact recorded replacement. It writes `MEMORY.md` and then the Dream state. A foreign edit or inconsistent publication order fails closed. NO_REPLY records consumed source versions without changing existing memory or deleting source logs.

A passive status read or exact operation-ID retry never starts a model call. An explicit retry keeps the original plan, source authority and publication proof, joins a local prior worker or waits for the existing proven-dead-owner lock recovery, and resumes recorded publication without inference. The original publication receipt must still prove its Session/Created/token identity; receipt uncertainty is a conflict. Retrying before the original provider result was durably recorded may require a fresh explicit model call. No automatic provider replay runs after restart.

## Deliberate boundaries

This document covers the manual Dream slice. Activity-triggered and periodic native legacy Dream are described separately in [Native automatic legacy Dream](native-automatic-legacy-dream.md), including its explicit first-completed-activity policy. Whole-batch Dream and semantic/vector retrieval remain separate capabilities. Successful new native receipts can now settle [consumed-source cleanup](native-dream-consumed-cleanup.md). Historical receipts and recent, changed, busy or otherwise protected sources remain retained. Explicitly repeated new manual operations may consolidate retained files again. These boundaries are not hidden behind a compatibility executor.

The existing operator controls require no new UI strings or public protocol schema. No compositor benchmark is claimed for this backend-only change. Browser acceptance reuses the verified Feedback App production artifact only after comparing 2104 App/UI source and build-configuration files; the private Desktop is rebuilt with the new native backend.

## Verification

Shared integration verifies all frozen hashes, passes the same 26 tests / 153 assertions, all 21 workspace typechecks and the unified App/Desktop builds. Source CLI and the unified rebuilt Desktop each pass four checks / one provider call. Private UI and crash evidence below remains separately identified; the refreshed repository aggregate is still running.

- Before-change real native CLI: HTTP 403 `Native legacy Dream is not available yet`, zero provider calls.
- Final focused suite: 26 tests / 153 assertions passed across native legacy Dream, native V2 Dream and Core legacy Dream, including selected-Agent replacement, permissions, NO_REPLY, exact retry, foreign bytes, mode disable, bounded reads and partial publication.
- Real native CLI: four checks, one provider call, including an empty operation, current-Session exclusion, prior memory, explicit retry and foreign-byte rejection.
- Real process-death controls passed after the durable publication receipt, after the actual `MEMORY.md` rename, and after the actual state rename. Each reopened process left passive reads/exact IDs passive; explicit retry completed with one total provider call and rejected foreign actual bytes.
- Crash instrumentation is test-only: the prepared checkpoint observes the driver's actual SQLite execution method after the write, and file checkpoints use a narrowly scoped Bun loader observer after the real atomic rename. It does not replace publication results. Initial missed observer checkpoints are retained in the fixture record.
- Final Core and Apexo package typechecks and the rebuilt Desktop production build passed. Rebuilt Desktop backend acceptance passed four checks with one provider call. Browser and rebuilt native-window acceptance each passed four checks with one provider call, exercising passive `/dream`, explicit publication, visible result and server-derived retry. The final memory-rename crash proof was repeated after the selected-Agent fence; the prepared/state proofs precede that narrow fence change.
- The held-provider Agent replacement negative control failed before the fix (completed instead of failed). The corrected test proves no publication, rejected explicit retry and one provider call. See [BUG-20261015-313](testing/permissions/task-message-operator-agent.md).

[BUG-20261015-356](testing/test-fixtures/native-legacy-dream-fixture-contracts.md) records actual fixture corrections without inventing a product failure for the absent feature.

## Reference evidence

Fixed source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, `xai-grok-memory/src/dream.rs` and `dream_lock.rs`, establishes legacy prompt, source exclusion, gating, bounded input, output processing and old-source cleanup behavior. Apexo reuses its existing Core domain helpers and adds native operation ownership.

The isolated installed Grok 1.0.52 (`0920c8169e27`) probe requested `memory_v2.enabled=false` but exposed V2 artifacts. It verified real-home denial, exact local-port egress, passive listing and zero provider calls. It does not prove an effective legacy executor, so no installed legacy Dream execution parity is claimed. This limitation remains explicit alongside the source comparison and independent Apexo execution evidence.
