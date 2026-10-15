# Isolated installed Memory Dream and clear comparison

This is comparison evidence for installed Grok 1.0.52 (`0920c8169e27`), recorded on 2026-10-15. It is not verification of Apexo's implementation. No product code imports the reference script or depends on the installed executable.

## Isolation

`packages/apexo/script/grok-memory-dream-reference.mjs` uses an explicit environment whitelist, private HOME/GROK_HOME/XDG/TMPDIR, disabled vendor imports and telemetry, and local redirects for auxiliary model/service endpoints. A macOS sandbox denies all network access except the exact owned loopback provider port. Real-home file access is denied except the installed binary and one disposable workspace. That workspace is intentionally created under the real home because the installed Memory capability excludes temporary working directories; it contains only synthetic fixture files and its own Git repository, and is deleted in `finally`. No user repository or existing application profile is used.

Before starting the agent, actual sandboxed commands proved that an owned sentinel outside the allowed workspace could not be read, the disposable workspace could be read, a second non-whitelisted local listener received no connection, and the intended provider was reachable. The profile is fail-closed on other platforms rather than silently running without the guard. The script accepts `GROK_BIN` only as an explicit binary path override.

## Eight Memory observations

Run from `packages/apexo` with pinned Bun 1.3.14:

```sh
bun script/grok-memory-dream-reference.mjs
```

All eight checks passed:

1. Session-start curated legacy carryover preserved source bytes, was deduplicated across another Session and made no provider request.
2. Passive listing made no provider request.
3. Empty flush and Dream made no provider request.
4. One completed ordinary turn flushed one tool-free capture.
5. Repeated flush did not extract again.
6. Manual Dream consumed claimed observations in one tool-free request and published the actual topic text.
7. Repeated Dream reported `no_work` without another Memory/domain request.
8. Disabled flush and Dream reported `disabled` without another Memory/domain request.

The five observed provider requests were fully classified from authoritative fields:

| Role              | Count | Actual endpoint        | Classification evidence                                                             |
| ----------------- | ----- | ---------------------- | ----------------------------------------------------------------------------------- |
| Main Session turn | 1     | `/v1/chat/completions` | Current user input and conversation tool catalog                                    |
| Capture           | 1     | `/v1/chat/completions` | Actual system prompt beginning `Extract durable, reusable observations`             |
| Dream             | 1     | `/v1/chat/completions` | Actual system prompt beginning `Consolidate only the supplied claimed observations` |
| Title             | 1     | `/v1/responses`        | `session_title` tool; function-call response in Responses wire format               |
| Dashboard         | 1     | `/v1/chat/completions` | Actual system prompt beginning `Write an ultra-short dashboard line`                |

Whole-history marker matching is not used. The title and dashboard calls remain counted and visible, but are not misreported as main, capture or Dream work. Repeated-operation checks distinguish domain requests from independently finishing ancillary requests. Requests and fixture failures are retained as isolated evidence; there were no unclassified requests or responder errors. The installed agent's stderr was empty.

## Clear and discard boundary

Pinned source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` exposes `memory clear --workspace/--global/--all --yes` in `crates/codegen/xai-grok-pager/src/memory_cmd.rs`. The canonical V2 storage methods remove their respective Memory scope directories. The installed command's actual help confirmed these flags. After joining the ACP agent, the probe executed `memory clear --all --yes` in the same disposable profile: it exited zero, removed both known curated topics (carryover and Dream), and made zero provider requests.

The pinned ACP extension table in `crates/codegen/xai-grok-shell/src/extensions/memory.rs` lists flush, Dream, rewrite, list, toggle and forget. It contains no operation-receipt discard endpoint. This source audit does not claim a comprehensive absence across future releases, nor does CLI scope clearing establish equivalence to Apexo's private operation recovery/discard receipts. No fabricated discard request or foreign orchestration bridge was added.

The owned ACP and CLI processes were joined, the local listeners closed, and the disposable workspace and home-denial sentinel removed. Post-run process inspection found no matching fixture process. Evidence profiles remain isolated for review. The underlying fixture hardening is recorded in [BUG287](testing/test-fixtures/memory-reference-isolation.md).

## Shared rerun

After exact review and integration, the shared command passed all eight checks with five requests, again one per classified role. The actual home/port isolation preflight and clear of two curated topics passed; clear made zero requests. There were no responder errors, agent stderr was empty, all owned processes exited, and the disposable workspace was removed. This independently verifies the integrated comparator while remaining reference evidence only.

The subsequent shared Memory operation UI acceptance checkpoint reran the installed comparator: all eight observations, five classified requests, isolation preflight and clear of two topics with zero requests passed again. This retains the same reference-only scope and does not claim an official operation-panel contract.
