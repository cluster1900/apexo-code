# BUG-20261014-264: LSP requests did not hold the Location runtime guard

- Scope: Native LSP requests and plugin activation/reload.
- Observed: While a real stdio language server held a hover request, plugin reload succeeded and retired its connection.
- Expected: Reload must return busy while a native LSP request is active, and cancellation must reach the language server before later reload can retire its generation.
- Reproduction: Run `bun test test/v2/lsp-native.test.ts` from `packages/apexo`; the fixture holds `LSP_WAIT`, then attempts runtime reload.
- Root cause: The new LSP service used the connection directly without participating in the existing LocationRuntimeGuard. Native tool registry settlement alone does not establish that ownership.
- Fix: Wrap LSP execution in `guard.use(location, ...)`. Candidate preparation and publication continue through the existing reload idle barrier.
- Verification: The focused suite passed three tests and 31 assertions, including busy reload, actual JSON-RPC cancellation, subsequent successful reload, and descendant process cleanup.
