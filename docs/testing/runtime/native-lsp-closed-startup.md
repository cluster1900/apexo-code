# BUG-20261014-265: Early language-server exit waited for the initialization deadline

- Scope: Native LSP client startup, failed candidate validation, and teardown.
- Observed: A candidate stdio server exited immediately, but the activation attempt remained pending until the 15-second initialization timeout. Cancellation after the closed transport also produced a JSON-RPC closed-connection diagnostic.
- Expected: A process exit rejects pending startup promptly, preserves the prior active generation, and cleans the owned process group without sending cancellation to a closed transport.
- Reproduction: Run the trusted-plugin case in `bun test test/v2/lsp-native.test.ts` from `packages/apexo`; its mode file makes the next child exit before initialization.
- Root cause: The request race watched the RPC response, deadline, and caller abort but did not watch child closure. Generic JSON-RPC closure alone did not settle this startup request. Cleanup also assumed notification failure was always asynchronous.
- Fix: Include child closure in the request race; fence cancellation by liveness; catch synchronous exit-notification failure through a promise boundary. Register scope teardown before initialization and explicitly abort pending startup before joining its cleanup.
- Verification: The same three-test suite passed with the trusted-plugin case completing in about 0.4 seconds instead of 15.5 seconds. The case separately verifies failed candidate retention, interrupted startup, recovery, disable, and process cleanup. The passing run emitted no closed-connection diagnostic.
