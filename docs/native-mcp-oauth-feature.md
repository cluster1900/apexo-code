# Native MCP OAuth

## Scope and architecture

This feature adds explicit authentication for trusted remote MCP definitions to Apexo's native Location-owned runtime. Generic MCP SDK authorization helpers provide protocol primitives; Apexo owns credentials, callback lifetime, cancellation, status, permissions, connection publication and user actions. It does not embed Grok or use the compatibility runtime to orchestrate authentication.

Passive status and ordinary connection attempts never open a browser or begin interactive authorization. An explicit Authenticate action starts a bounded loopback callback listener and returns its authorization URL to the requesting client. App and terminal clients open that URL explicitly and retain open/copy alternatives. The browser must run on the server computer because the callback uses that computer's loopback address. Remote-server browser placement is explained in the UI; there is no callback relay. The listener binds `127.0.0.1` on the backend host. A browser on another machine would require explicit reachable forwarding, which this slice does not create or verify. Local browser/backend acceptance does not establish arbitrary remote-connection OAuth support.

Authentication may save credentials for a disabled server while leaving its saved connection choice, transport and tool registry disabled. Connect is still a separate enabling action. Enabled completion attempts publication at an idle boundary once. If project work is active, credentials remain saved and the status asks the user to Retry when idle. Browser waiting never occupies that boundary. Failed reauthorization preserves an existing healthy transport.

## Public contract

- `POST /api/mcp/:server/auth/start` has no body and returns `{id, authorizationUrl, expiresAt}`. The URL is returned only after the listener binds.
- `DELETE /api/mcp/:server/auth/:flowID` cancels and joins that exact operation. A stale identifier cannot cancel its replacement.
- Existing native MCP status adds optional `authentication`: capability, credential availability, a safe error code and optional flow state. Expiry is a nonnegative integer. Local stdio statuses omit this addition.
- Failed actions use existing HTTP conventions: missing server/flow 404, conflicting or busy operation 409, invalid/unsupported/authentication 400, storage/load 503.

Public errors contain no credential values, issuer payloads, private file paths or authorization URLs. Invalid configuration is isolated to its server instead of breaking the whole status response. Ordinary unauthenticated HTTP and same-origin SSE endpoints retain their existing support; OAuth restrictions do not silently disable those transports.

## Storage and lifecycle

Credentials use bounded private files, atomic replacement and a cooperating cross-process lock, keyed by Location, server and full configuration identity. Reads reject oversized or corrupt data. Exact revision checks fence cooperating writers and observed replacements. This is not atomic filesystem compare-and-swap against an uncooperative process replacing a file between the final check and rename.

Known successful issuer grants and refresh rotations are committed forward under the original credential identity even when cancellation or runtime retirement prevents activation. A newer locked writer is preserved. Cancellation cannot undo an issuer-side grant whose response was lost before the client learned its result; the network/issuer transaction ambiguity is not claimed solved. Tokens are scoped to the configured resource origin, including announced same-origin SSE endpoints; cross-origin endpoints and redirects receive none.

The Location scope owns callback listeners, pending flows and publication tasks. Management supersedes and joins pending flows outside its idle mutex. Transport publication rechecks current ownership and saved choices. Storage corruption fails closed while retaining a previously healthy live transport; exact repaired bytes can restore operation.

## Verification and comparison

Private implementation verification currently passed 29 tests / 142 assertions across `mcp-oauth-store`, `mcp-oauth-flow`, `mcp-oauth-native` and `mcp-oauth-transports`. These use actual storage, separate writer processes, local HTTP/SSE servers, native application services, permission/idle boundaries and scoped cleanup. Coverage includes PKCE/custom protected-resource metadata, exact cancellation, malformed callback targets and non-ASCII states, disabled authorization, busy publication, grant/refresh retirement, configuration identity, corrupt-store recovery, nonloopback ordinary HTTP, same-origin SSE and cross-origin credential rejection. Core and Server private typechecks passed.

The complete private workspace generated both clients using the repository generators, retained App's vendored Client mapping, and passed App/TUI types and an App production build. `bun script/grok-mcp-oauth-native.mjs cli` passed eleven checks and three provider calls, including a real authenticated native Session tool execution and model follow-up, passive refresh, restart reuse and different-Location isolation. These private checks preceded the integrated acceptance below; private results are not aggregate repository CI evidence.

From `packages/apexo`, the reproducible commands are:

```sh
bun test test/v2/mcp-oauth-store.test.ts test/v2/mcp-oauth-flow.test.ts test/v2/mcp-oauth-native.test.ts test/v2/mcp-oauth-transports.test.ts
bun script/grok-mcp-oauth-native.mjs cli
bun script/grok-mcp-oauth-native.mjs desktop
bun script/grok-native-mcp-oauth-ui.mjs browser --locales
bun script/grok-native-mcp-oauth-ui.mjs native --locales
bun script/grok-native-mcp-oauth-tui.mjs
bun script/grok-native-mcp-oauth-tui.mjs --fullscreen
bun script/grok-mcp-oauth-official.mjs
bun script/grok-mcp-oauth-official.mjs --dcr
```

The installed reference comparison was performed on 2026-10-15 using Grok Build 1.0.52 (`0920c8169e27`), in independent private configured-client and dynamic-registration profiles. Each passed five checks with zero provider calls: passive needs-auth, explicit PKCE authorization, ready catalog publication, process-restart token reuse and rejected-token refresh without new consent. The configured-client profile made no registration request; the DCR profile registered its own local client. The local issuer exposes authorization-server/protected-resource metadata, `/authorize`, `/token`, `/register` and `/mcp` on an ephemeral loopback port. Only the explicitly opened local consent page is involved; no external account or service was authenticated. This establishes that exact local behavior, not external-provider interoperability or reference tool/model execution. The repository comparison script was then run against both profiles after integration, again passing five checks with zero provider requests each. It accepts `GROK_BIN` and isolates HOME, GROK_HOME and XDG directories; no real user authentication store is used.

App acceptance targets both the MCP dialog and status popover in English, Simplified Chinese and Traditional Chinese. Terminal fixtures exercise the actual shared component in a real narrow/expanded PTY, with a local opener command forwarding only to the owned fixture issuer; they do not claim operating-system default-browser integration. Seventeen server rows exercise long-panel visibility. The local issuer holds consent so waiting/cancel controls can be observed, then a fixture HTTP submission completes the local consent form. No real account is involved. The private production browser passed nine checks across both entrypoints and all three locales with zero provider calls. Native action panels passed five checks each in 80-column/24-row and 120-column/40-row PTYs. Actual compatibility mini and fullscreen entrypoints passed four checks each. Localized browser screenshots and retained narrow/expanded terminal screens were inspected. These private action-panel tests do not claim complete native-only terminal bootstrap. Integrated native-window acceptance is recorded below.

## Integrated acceptance (2026-10-15)

The exact reviewed forty-file draft was integrated after checking current and
proposed hashes, then two bodyless missing-server cases were added to the HTTP
inventory. Client and legacy SDK generators passed. Candidate generated-code
reproducibility passed using an isolated Git index; the real index was unchanged.
All twenty-one repository typecheck tasks and App/Desktop production builds passed.

The live implementation gate passed 29 tests / 142 assertions across four files.
CLI and rebuilt packaged Desktop each passed eleven checks / three provider
requests. Production browser and the actual rebuilt native window each passed
nine checks across both manager entrypoints and en/zh/zht. Native screenshots
for both entrypoints in all three locales were inspected. Both real native action
PTY sizes passed five checks, and actual compatibility mini/fullscreen entrypoints
passed four each; retained native terminal screens were inspected.

The first native-window run exposed a fixture document-URL assumption before any
OAuth action. [BUG-20261015-068](testing/test-fixtures/mcp-oauth-native-document.md)
records the cause and correction. The corrected native and browser runs both
passed, without changing product code. Existing draft defects are recorded under
`docs/testing/` and linked from its index; none of these episodes alone warrants
a recurring constraint.

Seven focused native MCP HTTP scenarios passed over the current 269-route
inventory with no missing or extra routes. The complete HTTP gate then passed
290 scenarios in each coverage, authorization and Effect-handler mode over all
269 routes, with zero failures, skips, missing routes or extras and clean exit.
The repository unit gate failed once in native MCP reload; [BUG084](testing/test-stability/mcp-native-reload-full-suite.md) remains under investigation. An unchanged focused pass is not a fix; the preceding 4,036-test checkpoint
predates OAuth and must not be presented as its aggregate unit verification. No session
composer or timeline code changed, so no new composer benchmark was required.

## Limits

No native MCP resource picker, notification-driven catalog relisting, external-service OAuth certification, credential deletion UI, remote callback relay or device-code grant is included. Other App locales use English fallback for the seventeen new keys; the shared terminal remains English. Chinese terminology has corpus review, not native-speaker signoff; see [localization notes](native-mcp-oauth-localization.md). Existing compatibility management routes remain separate.
