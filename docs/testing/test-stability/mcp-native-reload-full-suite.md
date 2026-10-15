# BUG-20261015-084: Native MCP Reload Failed in the Full Unit Gate

- **Scope:** Native stdio MCP reload regression in the complete OAuth/Workflow-effort unit batch.
- **Status:** Investigating; no fix established.
- **Occurrences:** One observed full-suite failure. The underlying cause is unknown; an unchanged passing rerun is not a repair or a second occurrence.

## Observed and expected behavior

The test `native stdio tools enforce permission/schema, cancel requests, fence reload and retire process groups` failed after approximately 1.15 seconds with `PluginBundleRuntime.Failure`, code `load`, and the safe message `Could not prepare native plugin state`. The failure points to the reload error adapter. The captured output does not expose the underlying cause, so it does not establish an OAuth defect, a timeout, or a host-load explanation.

After its held MCP call is cancelled, the fixture expects an idle reload to publish a fresh registry and retire the previous server and descendant process group. The original registry must reject stale calls and the replacement must execute normally.

## Reproduction and verification

From the repository root, `GITHUB_ACTIONS=false bun turbo test --concurrency=2` completed with 4,072 passes, 19 existing skips, one todo, one failure, 53 snapshots and 13,569 assertions across 359 files. Five of six Turbo tasks succeeded; the process exited 1 after 15m52.26s. This gate is not green.

From `packages/apexo`, the unchanged scoped command `bun test test/v2/mcp-native.test.ts --test-name-pattern 'native stdio tools enforce' --timeout 30000` then passed one test / eleven assertions and exited cleanly. No production or fixture edit preceded that rerun. The pass only narrows reproducibility; it does not prove the full-suite symptom was fixed.

A second unchanged check, `bun test test/v2/mcp-oauth-flow.test.ts test/v2/mcp-native.test.ts --timeout 30000` from `packages/apexo`, passed 27 tests / 178 assertions and exited cleanly. This is a related-file rerun, not the immediate preceding file sequence: the aggregate output last names `mcp-oauth-native.test.ts` before `mcp-native.test.ts`. The aggregate uses `--only-failures`, so its emitted file headings are not a complete execution-order inventory. This pass does not establish a repair.

## Isolated diagnostic follow-up

A coherent private source copy was taken after the Task/Sandbox integration and
its generated outputs settled. This is a later source snapshot than the failed
OAuth/Workflow-effort aggregate. The relevant MCP, stdio, OAuth, LSP, State and
MCP test files matched the live sources byte-for-byte. Only the private
`PluginBundleRuntime` error adapter was instrumented to capture `Cause.pretty`
before sanitization, with preparation, publication and retirement phase labels.
No diagnostic capture or speculative repair was added to production.

From the private copy's `packages/apexo`, using pinned Bun 1.3.14:

- `bun test test/v2/mcp-native.test.ts --test-name-pattern 'native stdio tools enforce' --timeout 30000`: one pass / eleven assertions.
- `bun test test/v2/mcp-oauth-flow.test.ts test/v2/mcp-native.test.ts --timeout 30000 --rerun-each 5`: 135 passes / 890 assertions, zero failures.
- `bun test test/v2/mcp-oauth-native.test.ts test/v2/mcp-native.test.ts --test-name-pattern '^(native stdio tools enforce|native Core authenticates|native OAuth completion|native management supersedes|native OAuth credentials|failed reauthorization)' --rerun-each 20 --timeout 30000`: 120 passes / 800 assertions, zero failures; 220 filtered tests.

The target reload test passed 26 times in these runs. Capture contained only the
expected typed MCP connection failures from negative cases, not the original
generic cause. All three processes exited zero and were reaped; inspection found
no surviving child using the isolated MCP fixture. These results narrow
reproducibility, but neither the changed source snapshot nor instrumentation's
timing permits claiming a fix. No timeout was increased, failure suppressed, or
host-load cause established.

Static inspection establishes only that the generic message is used when the
squashed cause is not a directly preserved `MCP.Failure`, `LSP.Failure`, or
`PluginBundleState.Failure`. A composite cause can also lose that direct type;
this does not identify whether preparation, publication or retirement failed.
The captured original aggregate remains insufficient to choose a repair.

## Next investigation

Preserve the original aggregate output, reproduce the relevant test ordering and inspect the original reload failure cause using isolated diagnostic instrumentation if necessary. Do not increase timeouts, suppress the failure, blame concurrent work, or declare the feature aggregate verified without evidence. After a confirmed repair, record its root cause and rerun the affected integration checks plus the complete gate. Existing loaded-compaction investigations remain separate.

## Complete isolated aggregate with original-cause capture

A second, complete private repository snapshot was taken from the coordinated
managed-child/public-resume and sandbox UI checkpoint. Sources, package
manifests/exports, installed vendored dependencies and the real Workflow
interpreter build target were copied together. All 5,346 source/config hashes
matched that checkpoint, all 41 newly integrated file hashes matched, and all 5,229
symlinks were checked: none resolved into shared workspace sources. Later App
toast and compatibility plan-tool changes are excluded from this result.

Only private PluginBundleRuntime diagnostics were added. Original causes were
captured before safe translation or initial fallback, with phase labels and
private file permissions. Core typecheck passed. The complete command
`GITHUB_ACTIONS=false bun turbo test --concurrency=2` then ran with isolated XDG
paths, private SDK generation, real Cargo interpreter build/tests, no remote
cache and zero cached Turbo tasks.

The aggregate exited 1 after 16m57.453s: **4,106 passes, 19 skips, one todo, two failures,
53 snapshots and 13,989 assertions; 4,128 tests across 376 files**. Five of six Turbo
tasks succeeded. This checkpoint is not green. The failures were the ordinary
V2 Session completion timeout and an old Task-specific rejection-message
assertion, tracked separately as BUG-20261015-102 and BUG-20261015-101. Neither
was the original MCP reload failure.

The private cause file contained ten typed negative-case failures: seven
PluginBundleRuntime failures during bundle staging, one NativeLSP initialization
failure, and two MCP preparation failures. No original generic MCP cause was
captured. All owned processes exited and were reaped; the final process inventory
showed no remaining command referencing that private workspace. Post-run source
comparison found only the intended diagnostic file and private SDK incremental
build metadata changed.

This whole-suite attempt did not reproduce BUG084. It does not explain or repair
the original failure, and **Investigating** remains the correct status. No broad
repeat, timeout increase or speculative production patch followed this result.

Later shared Plan/media UI checkpoint: the full repository unit command completed all six Turbo tasks successfully, including the Apexo suite’s 4,155 passes, 19 skips, one todo and zero failures across 383 files. This adds a successful aggregate observation, not a causal repair or a new failure occurrence. The earlier unexplained symptom remains an investigation. This aggregate precedes the Shell/media-options integration.
