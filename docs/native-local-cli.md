# Native local interactive terminals

Status: the 24-file handoff is integrated into the shared branch. Shared Apexo types and the combined terminal runtime/scrollback gate passed 46 tests / 144 assertions. The standalone macOS arm64 build and all eleven compiled acceptance commands passed. The refreshed workspace typecheck gate passed all 21 tasks (18 reused valid cache entries). Source and compiled evidence are distinguished below.

Explicit `--session-protocol native` can start an Apexo-owned local native host for the fullscreen terminal or mini terminal. The default `auto` path retains compatibility startup. This selection is a transport choice, not a stored Session engine label, and does not solve automatic classification on mixed servers.

Use `apexo [directory] --session-protocol native`, or add `--mini` for the mini terminal. Existing Sessions can be opened with `--session <id>`; `--continue` uses the existing native Session listing. Opening history does not admit a prompt or restart model work. New input uses native durable admission and the canonical serialized runner. Managed child views retain server-owned mutation restrictions.

The mini terminal owns one embedded native request graph. Fullscreen owns a dedicated worker with an authenticated, ephemeral loopback listener and streaming native events. Credentials stay private to the worker handshake. Both reuse the existing native terminal projection and interaction adapters. They do not delegate execution to the compatibility loop.

Normal exit and SIGTERM release the terminal owner and join the native host. Host disposal owns active provider work, child Tasks, shell processes, MCP transports and pending interaction waits. Saved transcript inspection after shutdown is passive; a late released provider response cannot commit an answer after its owner has closed. Abrupt process death remains distinct from graceful cancellation and does not imply automatic continuation recovery.

This slice deliberately rejects native headless execution. It does not silently approve or deny a pending interaction. It also rejects unsupported local fork, command, profile, file, title, demo, automatic-approval and network-listener options before creating the host or Session. Explicit local compatibility selection retains its previous unsupported-option error; ordinary `auto` remains the compatibility default.

## Verification

Acceptance uses isolated home/config/data directories and a local deterministic provider. The provider-only fixture option avoids launching an unrelated compatibility backend. The existing fixture default is unchanged.

From `packages/apexo`:

- `bun script/grok-native-local-terminal.mjs` and `--fullscreen`: real fresh prompt, Question reply, second prompt, graceful exit and native durable history.
- Add `--permission --resume`: real permission approval followed by an existing-Session restart, passive history and a new durable prompt.
- Add `--plan` or `--stop`: native Plan approval or actual terminal cancellation.
- Add `--compatibility`: exercise unchanged default local startup, not a native fallback.
- `bun script/grok-native-local-worker.mjs`: authenticated loopback HTTP/SSE, unauthorized rejection and listener shutdown.
- `bun script/grok-native-local-errors.mjs`: invalid options and headless rejection with zero provider calls and zero Session databases.
- `bun script/grok-native-local-lifecycle.mjs <provider|question|plan|bash|task|process|mcp>`: active owned work, joined disposal and passive reopen.
- `bun typecheck`: CLI package types.
- Set `APEXO_TEST_CLI_BIN` to the built Apexo executable when running the terminal or rejection fixture to exercise the compiled CLI instead of the source entrypoint.

The source results below come from the frozen private checkpoint. Shared and compiled-artifact results must be recorded separately. Packaged Desktop verification requires the coordinated build; source execution is not described as packaged verification. The original zero-byte startup observation remains unresolved in [BUG180](testing/test-stability/native-local-empty-startup.md). The initial fixture setup-server delay remains separately unresolved in [BUG163](testing/test-stability/native-terminal-backend-readiness.md).

### Source checkpoint results

| Actual scenario | Result |
| --- | --- |
| Native mini / fullscreen fresh Question and follow-up | Each 5 checks / 3 provider calls |
| Native mini / fullscreen permission and same-ID restart | Each 7 checks / 4 provider calls; opening saved history adds zero calls |
| Native mini / fullscreen Plan approval | Each 5 checks / 5 provider calls |
| Native mini / fullscreen Stop and next prompt | Each 5 checks / 2 provider calls; cancelled turn does not continue |
| Default compatibility mini / fullscreen | Each 4 checks / 4 total calls (3 Session turns, 1 title request) |
| Authenticated worker / rejected startup options | 7 / 5 checks respectively; zero provider calls |
| Held provider / Question / Plan disposal and reopen | Each 5 checks; respectively 1 / 1 / 3 provider calls |
| Foreground Bash / Task / background process / MCP disposal and reopen | Each 6 checks; respectively 1 / 3 / 2 / 1 provider calls |
| Existing terminal runtime unit gate | 27 tests / 69 assertions |
| Apexo package typecheck | Passed |

All listed source processes were reaped. Physical provider TCP closure is not asserted; joined execution ownership and rejection of late durable output are. These results do not replace the coordinated packaged-artifact check.

## Shared compiled checkpoint

The pinned Bun 1.3.14 single-platform build passed compilation, ad-hoc signing and the actual version smoke test after the client-only import correction in [BUG190](testing/build/native-local-split-chunk-collision.md). The existing build kept splitting and its original chunk naming.

With `APEXO_TEST_CLI_BIN` set to that built executable, all eleven commands passed: Question, permission plus same-ID reopen, Plan, Stop and default compatibility, each in mini and fullscreen; plus rejected startup options. Native Question passed five checks / three calls per mode, permission/reopen seven / four, Plan five / five and Stop five / two. Default compatibility passed four checks / four calls per mode, with its title request counted separately. Rejection passed five checks with zero provider calls or database creation. The fixture uses one explicit owned database for the binary and passive source inspector; [BUG193](testing/test-fixtures/native-local-compiled-database.md) records the initially mismatched channel defaults.

Shared source checks also passed mini/fullscreen Question, authenticated worker, rejection, provider/Task/process/MCP joined shutdown and passive history inspection. The runtime/scrollback gate passed 46 tests / 144 assertions; help passed one test / 37 snapshots / 44 assertions. The subsequent repository typecheck gate passed all 21 tasks. These results do not certify Linux/Windows execution, native headless approval policy or later Scheduler/Process UI changes.
