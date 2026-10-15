# Native MCP resource and template attachments

Apexo's native App/Desktop composers expose **MCP resources** and `/resources` for an existing Session. The existing `/mcps` panel in both terminal modes exposes **b browse resources**. Browsing is opt-in: opening the composer or MCP connection panel does not list/read resources or start model work. The picker supports resources, template parameters, partial catalog errors, preparation errors, and explicit cancellation. App labels include English, Simplified Chinese and Traditional Chinese; other locales inherit the existing English fallback.

The picker attaches prepared contents to the current draft through its existing file attachment representation. Unicode text is encoded canonically; supported image/PDF contents use bounded data URIs. Unsupported or malformed content rejects the whole preparation rather than attaching a partial result. URI template expansion uses the generic `uri-template` 2.0.0 library. Grok's runtime and orchestration are not product dependencies.

## Ownership and cancellation

The native API exposes Session-bound reserve, execute, status and cancel operations under `/api/session/:sessionID/mcp/operations`. Reservation allocates a server-generated 128-bit handle without MCP, permission or model work. Execute validates the canonical input and joins exact concurrent retries. Success, failure and cancellation results are retained without rereading; unknown or expired handles cannot execute. Reservations expire after five minutes. The implementation bounds global entries (64), per-Session entries (8), active executions (4), request/authority snapshots, resource response sizes and retained serialized results (32 MiB).

Preparation captures Session incarnation, lifecycle ownership, Location, selected agent and read authority. It checks authoritative ownership and permission again before exposing bytes. Session deletion/recreation cannot adopt an old handle. Cancel still targets the captured owner after agent or policy changes, while cross-Session and recreated-Session requests are rejected. Expiry joins local ownership and releases retained capacity.

The UI waits for the explicit cancel response before treating cancellation as joined. A failed cancel remains pending and retryable. Navigation fences prevent late delivery into another Session; cleanup sends explicit cancellation. A lost reservation response can only leave a bounded zero-work lease. Execute transport disconnection merely detaches an observer. Pinned Bun's consumed-POST disconnect behavior remains unresolved ([BUG334](testing/runtime/mcp-attachment-post-disconnect.md)); this feature does not claim to repair the HTTP adapter. MCP SDK cancellation has no remote acknowledgement, so joining Apexo's local owner does not prove arbitrary remote work has stopped. Cooperative fixture cleanup is measured separately.

## Verification checkpoint

Commands run from their package directories with pinned Bun 1.3.14:

- `packages/apexo`: `bun test test/v2/session-mcp-attachment.test.ts --timeout 30000` — 13 tests, 87 assertions, passed.
- `packages/apexo`: `bun test test/e2e/v2-mcp-attachment.e2e.test.ts --timeout 30000` — pure and mixed HTTP hosts, two tests, 44 assertions, passed. Explicit cancel joins the local owner and the cooperative stdio fixture records cleanup; no provider calls occur.
- `packages/apexo`: `bun test test/v2/mcp-attachment-client.test.ts --timeout 30000` — three tests, 23 assertions, passed, including cancellation during reservation, during execution and after a failed cancel request.
- `packages/apexo`: `bun script/grok-mcp-attachment-tui.mjs` and the same command with `--fullscreen` — actual terminal entrypoints each passed four checks. Both prepared resource/template bytes reach the native provider only after user submission.
- `packages/apexo`: `bun script/grok-mcp-attachment-ui.mjs desktop` — production App in Chrome, six checks passed: passive behavior, catalog/templates, Unicode expansion and attachment, unsupported-content rejection, explicit cancellation, and provider delivery.
- `packages/apexo`: `bun run script/httpapi-exercise.ts --mode effect --include sessionMcpAttachment` — all four new endpoint scenarios passed, including a real stdio resource read. Full coverage and auth modes each passed 337 scenarios, 308 routes, no missing/extra routes.
- `bun typecheck` in Core, App, TUI and Apexo — passed at this checkpoint. Canonical Client generation and `./packages/sdk/js/script/build.ts` succeeded. App and Desktop production builds completed. Generated files are regenerated at integration rather than copied from older snapshots.

## Integrated verification

The combined implementation was checked again after canonical Client/SDK generation and the unified App/Desktop builds. Core preparation/operation tests passed 13 tests / 87 assertions, pure and mixed HTTP tests passed two tests / 44 assertions, and the client cancellation tests passed three tests / 23 assertions. The first combined invocation encountered a missing generated SDK module while generation was replacing its output directory; the client file passed independently after generation completed. That failed invocation is retained as verification evidence rather than counted as an all-green combined run; the generator/read collision is tracked in [BUG242](testing/test-fixtures/concurrent-sdk-generation-and-typecheck.md).

Both actual source terminal entrypoints again passed four checks each. The unified production App in Chrome passed the same six checks with `bun script/grok-mcp-attachment-ui.mjs desktop`. The rebuilt Electron Desktop window passed six checks with `bun script/grok-mcp-attachment-ui.mjs native`: passive composer behavior, catalog/template listing without model execution, canonical resource/template attachment, atomic unsupported-content rejection, explicit local cancellation, and captured-byte delivery after draft submission. These runs use Apexo's real Session/permission/MCP/provider paths with isolated fixture endpoints. The earlier client-test teardown timeout remains explicitly unresolved in [BUG338](testing/test-fixtures/mcp-picker-teardown-timeout.md).

## Paired composer measurement

A separate browser measurement alternated the pre-picker and final production App artifacts against one unchanged native backend and Session. It measured reload to the first visible composer frame, with two warmups per artifact followed by ten samples each. This measures initial composer rendering; it does not measure typing responsiveness or picker opening.

| Artifact | Median | Observed p95 (10 samples) |
| --- | ---: | ---: |
| Pre-picker App | 186 ms | 262 ms |
| Final picker App | 203.5 ms | 451 ms |

The final median was 17.5 ms higher and its slowest sample was 451 ms. Concurrent repository verification was running on the same host; this small sample does not distinguish a product regression from host contention and does not establish performance equivalence. Both artifacts made zero provider calls and zero resource catalog/template/read calls, and passive composer rendering did not load the lazy picker chunk. The exact samples were pre-picker `[182, 190, 154, 150, 202, 262, 179, 168, 250, 218]` and final `[174, 193, 144, 236, 272, 214, 224, 158, 170, 451]` milliseconds.


## Reference boundary

The dedicated installed-runtime probe passed nine checks against Grok 1.0.52 (`0920c8169e27`) on macOS, including a fresh run of the portable repository fixture. Run `bun script/grok-mcp-attachment-reference.mjs` from `packages/apexo` with the repository-pinned Bun after the fixture is integrated. The default reference executable is `.grok/bin/grok` under the invoking user's home; `GROK_REFERENCE_BINARY` can identify another installed executable. The probe is an acceptance tool, never a product dependency.

The fixture creates a private home/workspace, supplies fake credentials, disables external configuration imports, and uses a macOS sandbox that denies actual-home access except the selected executables and permits outbound networking only to the exact local fixture provider port. Preflight verifies denied home listing, blocked access to another loopback port, and access to the intended provider. No files are written to the actual home. MCP fixture code is copied into the isolated evidence directory before launch; runtime output and joined cleanup stay there.

The nine checks cover isolation guards; MCP initialization without provider work; preservation of all three returned text/blob blocks and metadata; exact forwarding of a caller-expanded opaque template URI; explicit empty-read and unknown-server errors; zero provider requests during catalog/explicit reads; snapshot delivery to the current user input without rereading; and classification of every provider request. The run made three provider requests: one main response, one title and one dashboard request, with zero permission requests.

This observes `_x.ai/mcp/list`, `_x.ai/mcp/read_resource`, and an explicitly embedded ACP resource snapshot. It does not demonstrate an official picker UI, canonical resource-tool advertisement, permission prompting, or reference-side URI-template expansion: the caller supplied the expanded URI. Apexo additionally implements its own template expansion and enforces Session-owned permissions and cancellation. The earlier six-check extension probe remains separately documented in [Native MCP Resources](native-mcp-resources-feature.md#gap-and-reference-evidence).

## Shared installed-reference confirmation

The portable reference fixture was rerun from the shared working branch with pinned Bun 1.3.14 and exited zero. It passed nine checks with three classified provider requests (one main, one title, one dashboard), zero permission requests, actual host-home denial and an exact local-provider-port guard. Explicit catalog/resource reads made no provider requests; the embedded snapshot reached the current user input without a second read. The caller expanded the template URI before forwarding it; this does not establish an official picker UI or reference-side RFC6570 expansion. Run `bun script/grok-mcp-attachment-reference.mjs` from `packages/apexo`.
