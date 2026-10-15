# BUG-20261015-368: Native plugin LSP socket transport was rejected

- **Status:** Integrated; shared Goal/LSP regression passes 38 tests / 218 assertions; rebuilt Desktop acceptance pending.
- **Scope:** Native plugin/config transport parsing, TCP startup and connection ownership.

## Observed and expected behavior

The fixed reference and an isolated installed runtime support a trusted plugin whose `transport` is `socket` and whose command is a TCP address. Native Apexo rejected the same valid definition with `PluginBundle.Unsupported`. The focused negative control failed 0/1 before implementation. Apexo should implement this transport through its existing native LSP service without spawning the endpoint as a program or acquiring ownership of the external process.

## Root cause and fix

The adapter explicitly required stdio, configuration omitted transport, and NativeLspClient always spawned a child. The candidate adds the two canonical transport spellings and passes the validated transport into that same client. TCP and stdio share JSON-RPC framing, operations, request cancellation and bounded shutdown. Socket connect and initialization share one startup deadline. Socket teardown closes only the owned connection; process-group signals remain confined to the actual owned stdio child.

Location reload, retirement, finite recovery budget and pending workspace authorization remain canonical. Denied workspace activation creates no connection. An interrupted candidate is closed before settlement and leaves the current generation usable.

## Verification

Pinned Bun 1.3.14, commands run from their package directory:

- `bun test --timeout 30000 test/v2/lsp-socket-native.test.ts`: baseline 0 passed / 1 failed with the explicit unsupported-transport error. Final four-file LSP regression passed 37 tests / 179 assertions with zero failures, including all 25 existing workspace/stdio/policy tests. The final socket-only rerun after the typed capture correction passed 12 tests / 38 assertions.
- `bun script/grok-lsp-socket-native.mjs cli`: 5 checks / 6 provider calls, exit 0. Covers pending trusted plugin, denied external-directory access with zero connections, real hover and canonical open targets, connection reuse and disable while the external fixture process remains alive.
- Existing isolated reference proof: `bun script/grok-lsp-workspace-official.mjs`, 5 checks / 3 provider calls, exit 0. This verifies only the reference contract.
- Canonical Client generation, config-schema generation and legacy SDK generation exited 0. Only `schemas/config.json` and SDK `src/v2/gen/types.gen.ts` changed; Client generated outputs remained unchanged. Final Core and Apexo package `bun typecheck` both exited 0. Composed rebuilt Desktop acceptance remains pending.

### Fixture corrections during this slice

The first combined run passed all 25 pre-existing LSP tests and failed three new assertions. One test omitted the required `LSP.Failure.code`. Another incorrectly expected plugin reload to reread the base configuration file; it now installs a real plugin and uses `PluginStore.mutate` to disable it. The external server fixture disposed its JSON-RPC queue immediately on peer close, intermittently dropping a received exit notification. A wire trace demonstrated the exit frame reaching the fixture before close; disposal now lets already queued dispatch settle. These are distinct authoring mistakes, not production failures or recurring-root-cause counts.

The first pending-connect fixture inspected Bun Socket's `connecting` property after filling a paused listener's kernel backlog; that precondition failed and the run is not accepted timeout evidence. A second attempt observing actual connect events confirmed that sixteen connections did not saturate the platform backlog either. The accepted fixture creates 512 owned local connections, proves that some have not connected, and then exercises the native deadline while the listener remains paused. No arbitrary external network endpoint or mocked TCP implementation is used.

See [the native transport contract](../../plugins-socket-transport.md) for exact reference ownership and the external server's responsibility for its protocol response.


Initial Core typechecking caught the known deferred-property narrowing mistake in startup notification callbacks. Captured validated constants preserve the exact values without casts; this fifth independently observed occurrence is recorded in [BUG-20261015-117](../types/native-media-webp-fixture-narrowing.md) and follows [RULE-20261015-012](../../rules/deferred-property-narrowing.md). The initial Apexo attempt overlapped that narrow authoring correction and is excluded from final type evidence.

## Shared integration

The frozen handoff baselines and final hashes matched before integrating all 13 handwritten files. The two generated outputs are reserved for canonical regeneration. The shared socket/workspace/stdio/policy plus native Goal diagnostic gate passes 38 tests / 218 assertions with zero failures. Rebuilt Desktop acceptance remains pending.

Shared source CLI passes all five checks with six provider calls. Two preceding initial-backend readiness timeouts remain open in [BUG163](../test-stability/native-terminal-backend-readiness.md); the unchanged successful run does not prove their cause or repair.
