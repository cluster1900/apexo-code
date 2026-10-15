# BUG-20261014-270: Real-LSP acceptance inherited the shell fixture's disabled default

- Scope: CLI/Desktop LSP acceptance fixture, not product activation.
- Observed: A trusted plugin applied successfully, but its status was `disabled` instead of the fixture's expected `connected`.
- Expected: The dedicated language-server fixture enables LSP explicitly; the shared shell fixture keeps its existing disabled default for unrelated tests.
- Root cause: `startShellFixture` intentionally supplies `lsp: false`. The new caller did not override it, so host policy correctly disabled the plugin server.
- Fix: Set `lsp: true` in the dedicated fixture configuration. Preserve the install-versus-apply assertion.
- Verification: `bun script/grok-lsp-native.mjs cli` passed 12 scenarios and 14 provider calls using actual clangd. No production behavior changed.
