# BUG-20261015-336: Fullscreen MCP dialog consumed a descendant PromptRef context

- Scope: fullscreen MCP resource attachment picker.
- Observed: opening `/mcps` crashed with `PromptRef context must be used within a context provider`.
- Expected: the dialog attaches prepared bytes to its captured session's composer.
- Reproduction: run `bun script/grok-mcp-attachment-tui.mjs --fullscreen` from `packages/apexo` on the first picker implementation.
- Root cause: the dialog mount is outside the PromptRef provider even though the command registration runs inside it.
- Fix: capture the existing prompt reference and route in the command owner and pass an attachment callback plus session accessor into the dialog. Preserve the original provider layout and session fence.
- Verification: the same actual fullscreen command passed four checks, including provider delivery of prepared Unicode resource and expanded-template bytes. Mini actual entrypoint also passed four. One occurrence; no rule promoted.
