# BUG-20261014-271: Acceptance read a compatibility field from a native tool part

- Scope: Native LSP CLI/Desktop transcript assertions.
- Observed: The fixture reported a missing definition tool result despite the native transcript containing a completed LSP call and a real clangd source location.
- Expected: Read the native tool part's `name` and its completed `state.structured.result`.
- Root cause: The fixture filtered by `part.tool`, a field not present on the native projected tool-part contract.
- Fix: Filter `part.name === "lsp"` and assert a nonempty structured result for every operation.
- Verification: `bun script/grok-lsp-native.mjs cli` passed 12 scenarios and 14 provider calls, including all six nonempty clangd results and a retained hover after failed reload.
