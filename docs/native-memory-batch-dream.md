# Native V2 batch Dream

Batch Dream is an opt-in native V2 consolidation protocol. Apexo owns Session admission, provider turns, permissions, claims, publication and receipts. The installed Grok executable is a behavioral reference only and is never a product dependency.

## Controls and bounds

Under `memory_v2`, `batch_dream_enabled` defaults to false. Active rollout and enabled Dream policy are also required. `batch_dream_max_run_secs` defaults to 1800 (maximum 1800), `batch_dream_max_calls_per_batch` defaults to 6 (maximum 32), and `batch_dream_max_batch_note_bytes` defaults to 98304 (maximum 262144). Shadow rollout retains the existing validation path. A claim contains at most 20 oldest eligible notes; one whole bounded note may exceed the configured byte target. Existing storage limits remain 128 topics, 256 KiB per topic and 2 MiB total; batch Dream does not introduce a vector index.

The model receives a bounded catalog and labeled notes, then returns either read actions or a plan. Actions support topic reads, UTF-8 byte ranges, Rust-regex search and paged catalog listing. Search runs over the captured immutable bytes, never a mutable live file. Replies are tool-free provider turns owned by the existing native executor. Limits include 32 edits, 128 KiB new text, 128 KiB read text, 480 KiB requests, 256 KiB responses, two repair opportunities and two truncation retries. A valid independent partial plan can survive a final budget boundary; unresolved notes remain deferred.

Plans support patch, insertion, section replacement, creation and description updates. Every edit must be cited by an applied note outcome; related notes may share an edit. No-change outcomes require exact read evidence. Every claimed note has one outcome. Conflicting edits and foreign or duplicate outcomes cannot publish.

## Results and retries

`processed` counts applied and justified no-change notes. `deferred` counts notes still pending, while `unplaceable` counts notes archived after their third independent ordinary deferral. A mixed applied/pending result is `retry_required`; archiving only unplaceable notes completes with zero processed notes. App and both terminal modes expose these counts. The compatibility MemoryWork result shape can display the optional counts, but its older executor does not acquire this native V2 batch protocol.

Repeating an operation ID reconciles its receipt. Explicit retry preserves its original claims and their outcomes; it does not repeatedly sample completed claims or consume fresh notes. For a settled batch with deferred notes, choose **Run Dream** again to reconsider those notes. **Retry original operation** settles only unfinished work from the original request; it does not advance the deferral count of an already completed claim. A new explicit Dream operation can make a new attempt at deferred notes. A truncation-induced multi-note `batch too large` deferral does not increment the ordinary deferral counter. Successful receipts retain bounded outcome metadata and hashes, not free-text deferral reasons.

A prepared plan and per-note outcomes are persisted before filesystem publication. Explicit recovery can settle only the original durable output after proving ownership and exact source dependencies. Passive restart/listing does not replay provider work. Changed or foreign bytes fail closed. Clear, forget, explicit plan discard and archive retention clean their associated batch metadata inside their existing SQL transactions; they do not perform a best-effort second cleanup after returning success.

## Authority and automatic work

Current and captured read/edit/external-directory authority intersect before claim/input, every provider request, every read action and publication. All captured note/topic dependencies are checked again; revocation prevents sending historical captured content on a subsequent provider turn. Session incarnation, selected Agent, mode revision, scope generation, claim owner and exact read hashes fence publication. Automatic batch work follows successful live capture through the existing Session input epoch and canonical input-admission fence. New input cancels the owner and prevents late publication. There is no separate scheduler or compatibility executor.

## Comparison and verification

The pinned Grok source reference is commit `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`. An isolated installed Grok 1.0.52 run exercised its real batch prompt, list action, create plan and no-provider repeat. Apexo tests cover shared edits, partial plans, duplicate/foreign outcomes, bounded multi-batch claims, deferrals, permission revocation, changed/symlink search sources, automatic admission, interruption and explicit recovery. Process-death probes stop after real prepared and completed SQL commits, then verify passive reopening and explicit retry behavior. CLI, Desktop, browser and terminal scripts are under `packages/apexo/script/grok-*memory-batch-dream*`.

The native policy uses Apexo's existing live-capture trigger and storage limits. It does not claim identical actor startup timing or introduce Grok orchestration, vector retrieval, or a second legacy execution path. Final acceptance results are recorded with the handoff; source comparison and upstream behavior are not substitutes for Apexo verification.

## Shared integration acceptance

The composed batch/default-Dream/consolidation/grep gate passes57 tests /279 assertions across seven files. Source CLI and the unified rebuilt Desktop backend each pass six checks with two ordinary, two capture and three Dream requests, including restart, exact retry and original-claim recovery. Canonical generation, isolated-index Client consistency, all21 uncached workspace types and App/Desktop builds pass. Final partial-result/unplaceable production browser and actual native-window checks each pass six checks / three Dream requests. Mini at 100×40 and fullscreen at 100×40 and 80×24 each pass four checks / three requests. Screens were inspected; all owned processes were reaped, and 3,647 captured source/artifact hashes remained unchanged. Deferred-status and fullscreen-footer corrections are recorded in BUG378 and BUG380. Existing isolated installed-reference and prepared/completed process-death evidence is not a substitute for those final rendered checks.
