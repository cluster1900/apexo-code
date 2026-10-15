# Native headless CLI

This slice consumes Apexo's canonical admitted input, per-input execution policy and durable outcome. It does not implement another model loop or invoke Grok. The separate input execution backend remains authoritative for tools, permissions, foreground children, continuation and cancellation.

## Invocation and identity

Use `apexo run --session-protocol native --dir <directory> <prompt>` for local execution, or add `--attach <url>` for a native or explicitly selected native API on a mixed server. The existing automatic transport selection also recognizes a pure native attached server; it never falls back after a selected native operation fails.

A prompt or at least one accepted file is required. `--session` adopts the existing Session; `--continue` selects the latest ordinary parent Session in the requested scope. Both submit a new canonical input rather than replaying unfinished provider work. Local root selection and model resolution use actual native catalog/configuration. Explicit agent/model/variant changes use the existing native selection APIs.

`--input-id msg_…` is additive and requires explicit `--session`, `--session-protocol native`, and headless mode. It is validated before startup. An exact retry reconciles the same prompt, attachments, delivery and permission policy; conflicting reuse fails. A completed old input can be replayed after a newer input without returning that newer input's output or making another provider request.

The CLI first admits with `resume:false`, then reconciles that exact input with execution enabled. It never uses Session idle or drain completion as an input result. A signal between those operations withdraws the admitted input without a visible Prompted event or provider work.

## Output

- Default output prints completed assistant text and tool results. Diagnostics and rejected tool details use stderr.
- `--format json` retains line-delimited completed-event records with type, timestamp and Session ID, including text, reasoning, tool_use, step_start, step_finish and error.
- `--format streaming-json` retains text/thought fragments, tool_call/tool_call_update, error and end records. Its requestId is the canonical input ID.
- Both machine formats add one `input_execution` record containing inputID, sessionID, status, reason and usageIncomplete. Streaming end includes the same outcome. Known totals are not invented when usage is incomplete.

The renderer uses the existing canonical native message projector. Durable history begins at the admitted input, stops at its terminal/superseding boundary, and recovers full values if live fragments are lost. Output deduplication includes assistant message identity; provider fragment IDs can repeat across turns. Other inputs and unrelated global SSE notifications cannot become this invocation's output. There is no fabricated available_commands list because the native API does not expose a per-input materialized tool catalog.

## Policy and cleanup

Default headless permission asks are rejected. `--auto` and its existing aliases request approve-once policy; configured and inherited hard denials remain authoritative. No permission response is simulated in the CLI. Failed tools may recover through normal model continuation and still produce a completed input.

Question, Plan, detached Tasks/processes, Scheduler, Monitor and auxiliary Memory execution remain unsupported under this policy. A forced unsupported tool call receives a tool failure; the CLI does not invent an operator answer. Foreground Task execution inherits the private parent policy and hard-deny boundary.

Completed input exits zero. Failed, interrupted, superseded and unavailable old-process outcomes exit one. SIGINT/SIGTERM return 130/143 after confirmed pre-admission stop or conditional joined input cancellation, with local host disposal also joined before exit. Disposal alone does not turn an unknown durable admission into confirmed cleanup. Unconfirmed remote cleanup exits one with explicit guidance; it does not print a fabricated terminal receipt. Local signal handlers stay installed through host disposal. Startup and admission requests have ten-second bounds and are aborted by stop. Admission intent is recorded before sending; an unknown response never proves the input is absent. Exact-input cleanup uses a separate bounded signal, and late admission after an unknown404 remains unconfirmed rather than a successful signal exit. Session deletion and a newer input cannot redirect cancellation to another incarnation or unrelated work.

Local headless and attached execution share the existing explicit-file upload convention and pass accepted attachments into canonical admission. Native local execution also accepts a file-only prompt. The reader validates the actual open descriptor, limits each file to 10MiB, and rejects missing/special files before the local host is created; nonblocking open prevents a FIFO from waiting for a writer. A valid PNG was verified on the actual configured xai/grok-4.7 provider request. Native history lowering now converts canonical text/plain data URIs into ordinary user text with a JSON-escaped filename/description header and the exact UTF-8 body. Each text attachment is bounded to 10 MiB decoded and selected-history text attachments to 20 MiB cumulatively. Invalid UTF-8/base64, noncanonical encodings, and remote/file text URIs fail before provider work; lowering never fetches or reads paths. The optional explicit charset=utf-8 spelling is accepted. Stored attachments, exact retry identity, permissions and image MIME validation remain unchanged. BUG-20261015-257 records the original failure and this private conversion repair. Fork, command, profile, demo, title and unsupported local server options are rejected rather than silently ignored. Interactive native startup and compatibility execution retain their existing paths.

## Verification boundary

Private source verification uses the actual CLI with isolated data/configuration and a local provider. Final local acceptance passed fifteen checks / twenty provider requests. Pure-native and mixed-native attachment each passed seventeen checks / twenty-one requests, including supported PNG transport and the original truthful text/plain rejection. Those counts describe the preceding CLI checkpoint; the ordered text-conversion amendment is verified separately below. Exact retries made zero additional requests, including replay of an old completed input after a newer input. Foreground Tasks retained inherited hard deny; background Task requests failed without child execution. SIGINT/SIGTERM joined actual foreground process cleanup.

Real proxy races cover pending withdrawal before wake, a superseded input finishing independently of a held newer provider, and unavailable remote cancellation. The race suite passed three checks / three provider requests. Seven invalid or unsupported startup cases passed with zero provider calls and zero databases created. The focused canonical output, native view/transport, Scheduler policy and help gate passed twenty-one tests / 120 assertions / 37 snapshots across five files. The complete Apexo package typecheck passed. The ordered amendment additionally verifies local PNG plus file-only input and pre-host missing/FIFO/directory rejection (five checks / two calls), and three held-startup/admission shutdown cases with zero calls. The final ordered regression also passed local15/20, mixed-native17/21, the existing three cancellation races, seven pre-start rejection cases, the twenty-one-test focused gate and package typechecking. Packaged/shared acceptance remains separate. No private production build or compiled/shared artifact acceptance is claimed here.

The earlier pinned/installed Grok headless comparison remains reference evidence only. Its output JSON shape is not substituted for Apexo's existing contract; no upstream result counts as native implementation acceptance. Packaged/shared Desktop and compiled CLI verification require root integration and coordinated artifacts.

## Ordered native text conversion verification

The private local-file CLI acceptance passed seven checks / four provider requests: missing, FIFO and directory inputs fail before host/provider startup; PNG with a prompt and PNG-only remain supported; UTF-8 text with a prompt and text-only now each complete in one provider request. Assertions inspect the current provider user input and exact assistant output, not historical tool arguments. Converter/runtime tests also cover exact retry without another request, immutable stored attachments, side-question snapshots and typed rejection without provider calls or side-question rows. Pure-native attach and explicit-native attach on a mixed host each passed seventeen checks / twenty-two provider requests, including text and PNG actual-wire transport, exact retry with zero requests, inherited denial and joined signal cleanup. Core and Apexo package typechecks passed. The larger regression run retained an unexplained pre-existing HTTP test timeout (BUG-20261015-273); its one isolated diagnostic passed without changing product code or deadlines. Shared rebuilt CLI/Desktop acceptance remains pending root integration.

The final focused converter/native runtime gate passed 13 tests / 82 assertions. Both package typechecks and all CLI processes exited successfully and were reaped; no private compiled or Desktop result is claimed.

## Shared integration checkpoint

The ordered CLI and text-conversion handoffs are integrated, preserving the concurrent Memory runner observers. The shared converter, native runtime, headless runner and side-question HTTP command passed 22 tests / 178 assertions in 6.86 seconds:

```sh
# From packages/apexo, with pinned Bun 1.3.14
bun test --timeout 30000 test/v2/text-attachments.test.ts test/v2/text-attachments-runtime.test.ts test/v2/headless-runner.test.ts test/e2e/v2-side-question.e2e.test.ts
```

Fresh App, standalone macOS ARM64 CLI and Desktop builds passed, including the compiled version smoke test. Actual compiled local execution then passed 15 checks / 20 provider requests; compiled local file handling passed seven checks / four requests; the same compiled client attached to the rebuilt mixed Desktop backend passed 17 checks / 22 requests. Text and PNG contents reached the configured provider, exact retries made no new requests, inherited hard denial remained effective, and SIGINT/SIGTERM joined the owned foreground process cleanup. All three commands exited zero and were reaped:

```sh
# From packages/apexo, with pinned Bun 1.3.14 and APEXO_TEST_CLI_BIN
# pointing to dist/apexo-darwin-arm64/bin/apexo
bun script/grok-native-headless.mjs
bun script/grok-native-headless-files.mjs
bun script/grok-native-headless.mjs --attach --mixed --desktop
```

The same compiled executable also passes three held-startup/admission shutdown cases with zero provider calls, three active cancellation/supersession races with three requests, and seven pre-start rejection cases with zero requests and zero databases created. Known pre-admission or withdrawn inputs exit 143; deliberately late unknown admission exits one and preserves the truthful pending receipt. These commands use the same pinned Bun and `APEXO_TEST_CLI_BIN` setup:

```sh
bun script/grok-native-headless-startup-stop.mjs
bun script/grok-native-headless-races.mjs
bun script/grok-native-local-errors.mjs
```

These are real CLI and packaged-backend checks, not native-window interaction. The shared all-21 workspace typecheck checkpoint precedes the three text-conversion production edits; refreshed Core and Apexo package typechecks now also pass after that amendment. The reviewed [installed-reference matrix](native-headless-reference.md) now passes16 scenarios with19 conversation and60 auxiliary requests. Its script/document and the corresponding fixture records are integrated. Official output and permission/receipt differences remain explicit. The successful shared HTTP test does not establish the cause of the earlier private timeout in BUG-20261015-273.

The shared native fixtures now use the verified32×32 PNG. After replacing the invalid literal, compiled file acceptance passed seven checks/four requests and packaged mixed Desktop acceptance passed seventeen/twenty-two again. Earlier PNG runs establish transport only; [BUG086](testing/test-fixtures/side-question-official-image.md) retains that boundary. The title-request classifier's third independent occurrence extends existing [RULE016](rules/fixture-evidence-projection.md); the active rule count remains19.
