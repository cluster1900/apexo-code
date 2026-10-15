# Native plugin LSP socket transport

A trusted plugin can declare `transport: "socket"` and use its `command` string as a TCP `host:port` endpoint. Native LSP configuration uses the same transport with `command: ["host:port"]`. Bracketed IPv6 endpoints are supported. Omitted transport and `stdio` retain owned child-process behavior. Socket arguments and process environment are not executed; the endpoint comes from configuration or an installed trusted plugin, never from a model tool argument.

The native LSP client uses its existing JSON-RPC operations, frame limits, request cancellation and Location lifecycle for both transports. One startup deadline covers connection establishment, initialize and workspace-opening notifications. Failed or interrupted startup closes the pending connection. Shutdown and exit are bounded protocol messages; closing the connection never sends an operating-system signal to the external server. The server owns its interpretation of those protocol messages and may choose to terminate itself.

Reload prepares and verifies a candidate before publishing it. Interrupted or failed candidates close their own connections while retaining the active generation. Plugin disable and Location disposal join connection cleanup. Existing recovery settings retain a finite lifetime attempt budget. Workspace overrides and open targets remain pending until the current invocation authorizes them; socket transport does not weaken canonical-path checks, external-directory permission, or the queued authorization recheck.

## Reference evidence

The behavioral reference is Grok Build source commit `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` and isolated installed version 1.0.52:

- `crates/codegen/xai-grok-tools/src/implementations/lsp/config.rs:216` defines `stdio` and `socket` transport spellings.
- `crates/codegen/xai-grok-tools/src/implementations/lsp/client.rs:482` connects to `config.command` as the TCP address and starts the existing LSP message loop without creating a child.
- The same file's shutdown path sends shutdown/exit and reaps a process only when a child is owned.
- `bun script/grok-lsp-workspace-official.mjs` demonstrated a real installed socket plugin hover and initialize/open behavior: five checks, three provider calls. This is comparison evidence; it does not verify Apexo.

Apexo owns native Sessions, permissions, plugin activation and connection lifecycle. No Grok executable or orchestration code is a product dependency. See [BUG-20261015-368](testing/runtime/native-lsp-socket-transport.md) for native negative controls and verification.

## Shared integration acceptance

The socket/Goal gate passes38 tests /218 assertions. Source CLI and the unified rebuilt Desktop backend each pass five checks /six provider calls: no connection before authority, current denial, canonical workspace initialization and hover, connection reuse, and owned connection disposal without killing the independently owned server. Canonical union generation, all21 uncached workspace types and App/Desktop builds pass. This feature changes the backend transport; existing storefront/window coverage remains separately scoped.
