# Explicit terminal Session transport

Attached mini and fullscreen terminals accept `--session-protocol auto|native|compatibility`. The default is `auto`, preserving existing server detection. On a mixed server, automatic detection still selects compatibility. A user can explicitly select the native API for a native Session on that server, without guessing from the Session ID.

Examples:

```sh
apexo attach http://localhost:4096 --session SESSION_ID --session-protocol native
apexo attach http://localhost:4096 --session SESSION_ID --session-protocol native --fullscreen
apexo attach http://localhost:4096 --session SESSION_ID --session-protocol compatibility
```

This flag chooses a transport for the attachment. It does not label or migrate a stored Session, and it does not prove which engine originally created a Session. An explicit selection skips protocol probing. A selected transport is cached and shared by transcript operations and the Tasks and Goal panels; failures from that API remain failures and never trigger a switch to another API. Memory's native branch consumes the same SDK transport in fullscreen and the selected native transport in mini; its separate UI changes must be composed without adding a new probe.

Existing native transport behavior remains authoritative: canonical history/replay, durable prompt admission, Question and permission replies, active interruption, and managed-child read-only views. The raw SDK remains available for domain panels. Owner and per-call cancellation are retained at the terminal transport boundary.

## Deliberate limits

Non-default selection requires an attached URL. Local terminal bootstrap still uses compatibility and rejects an explicit native or compatibility selection before creating a Session. Native noninteractive `run` continues to reject its unsupported headless approval policy. No request silently drops an explicit choice or falls back to `off` or compatibility after an API error.

Automatic classification of individual Sessions on a mixed server remains open: the server needs an authoritative engine identity or the user must choose explicitly. This change adds neither a persisted engine field nor a new public API. It does not complete local native CLI bootstrap.

## Verification

All commands below run from `packages/apexo`, using the pinned Bun. Runtime fixtures isolate their backend state and reap their owned processes. The mixed-server recorder forwards wire bytes and headers together and records the API family without changing payloads.

| Scenario | Command or coverage | Result |
| --- | --- | --- |
| Mixed mini/fullscreen ordinary Question, second prompt and native routes | `bun script/grok-native-terminal-tui.mjs --mixed` with/without `--fullscreen` | 4 checks and 3 provider calls each |
| Mixed mini/fullscreen Tasks and Goal panels | Above with `--panels` | 5 checks and 3 calls each; native panel endpoints |
| Mixed fresh creation | `bun script/grok-native-terminal-fresh.mjs --mixed` with/without `--fullscreen` | 2 checks and 2 calls each; one Session in the actual directory |
| Mixed Plan approval | `bun script/grok-native-terminal-tui.mjs --mixed --plan` | 4 checks and 5 calls |
| Mixed permission reply | `bun script/grok-native-terminal-tui.mjs --mixed --fullscreen --permission` | 4 checks and 3 calls |
| Mixed active Stop | `bun script/grok-native-terminal-tui.mjs --mixed --fullscreen --stop` | 2 checks and 1 call; no continuation |
| Mixed managed-child read-only attachment | `bun script/grok-native-terminal-child.mjs --mixed` with/without `--fullscreen` | 2 checks each; attachment makes no provider call |
| Pure-native explicit mini | `bun script/grok-native-terminal-tui.mjs --explicit` | 3 checks and 3 calls |
| Pure-native automatic fullscreen | `bun script/grok-native-terminal-tui.mjs --fullscreen` | 3 checks and 3 calls |
| Compatibility explicit mini / automatic fullscreen | `bun script/grok-terminal-compat-regression.mjs --explicit` / `--fullscreen` | 2 checks and 1 call each |
| Invalid choice, unsupported local selection and native headless rejection | `bun script/grok-session-protocol-errors.mjs` | 4 rejection checks, zero Sessions created and zero provider calls |

Final focused verification passed 22 tests / 76 assertions across `test/tui/native-session-transport.test.ts`, `test/cli/session-tasks-client.test.ts`, and `test/tui/session-protocol-panels.test.ts`. This includes explicit selection caching, unchanged automatic detection, HTTP authorization errors, owner and per-call cancellation, native Task mapping, and selected panel routes. `bun typecheck` passed in both `packages/tui` and `packages/apexo`; all six touched JavaScript fixtures passed `node --check`.

Packaged Desktop backend verification now has the shared checkpoint below. The mixed fixtures accept `--desktop`; source-backend passes remain separate evidence. This flag is Apexo-specific, so no installed Grok HTTP transport-selection parity is claimed.

The original direct mixed-mini readiness failure and a later fresh-mini timing observation remain unexplained ([BUG166](testing/runtime/session-protocol-mixed-mini-startup.md)). Passing serial or recorded-proxy runs do not establish their cause. A combined panel run also had an unexplained package after-hook timeout after its assertions passed ([BUG165](testing/test-fixtures/session-protocol-panel-hook-timeout.md)). The corrected recorder's compression, streaming and cleanup defects are separately documented in [BUG167](testing/test-fixtures/session-protocol-recording-proxy.md).

## Shared integration checkpoint

The reviewed selector is integrated with native Monitor and Memory. The shared 21-file regression passed 141 tests / 803 assertions, including selected panels, Task mappings and transport lifetime. All 21 workspace types and the Desktop build passed. The help sweep passed one test / 44 assertions; only the intended `attach --help` and `run --help` snapshots changed for the new option and resulting column wrapping.

The rebuilt packaged mixed-server matrix passed all fourteen scenario runs: both mini/fullscreen for panels (five checks / three calls each), fresh creation (two / two each), managed-child viewing (two each, no attachment-induced provider work), Plan (four / five each), permission (four / three each), active Stop (two / one each) and explicitly induced SSE reconnect (five / three each). The fresh fixture's missing backend forwarding was corrected before acceptance ([BUG183](testing/test-fixtures/native-terminal-fresh-backend.md)). Plan exposed the repaired scrollback-column defect ([BUG185](testing/ui/terminal-stream-spacer-column.md)); source CLI Plan also passed both modes after the correction. The reconnect fixture now closes its owned response transport rather than depending on an incidental idle timeout ([BUG186](testing/test-fixtures/mixed-terminal-reconnect-trigger.md)). All commands exited zero and owned processes were reaped. Memory-panel mixed-server acceptance belongs to its separately integrated UI slice. The latest complete unit gate remains pending.
