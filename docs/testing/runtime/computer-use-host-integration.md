# Computer Use host integration regressions

## BUG-20261116-006: xAI rejects a tool choice without tool definitions

- Scope: the OpenAI Responses lowering path used by native xAI requests, including final provider turns after an agent reaches its tool allowance.
- Observed: a live `xai/grok-4.7` TextEdit run reached the configured provider-turn allowance and failed with HTTP 400: `A tool_choice was set on the request but no tools were specified`.
- Expected: the final text-only provider turn can summarize the outcome without another tool call.
- Reproduction: prepare/send an xAI Responses request with no tool definitions and `toolChoice: "none"`; native Session final-turn lowering produces this combination.
- Root cause: the Responses protocol omitted an empty `tools` list but still emitted `tool_choice: "none"`.
- Fix: omit that no-op choice when definitions are absent. Preserve explicit choices when tool definitions are present and preserve other choice modes.
- Verification: `bun test test/session/llm-responses-tool-choice.test.ts` from `packages/apexo` passed two request-compilation regression tests with four assertions. The live `bun script/computer-use-live.mjs cli smoke` then used a one-step agent with no permitted tools and successfully received `TOOLLESS_XAI_DONE` from xAI. Live TextEdit, Calculator, long-document scrolling, and vision scenarios passed separately; the request regression alone does not certify them.

## BUG-20261116-007: Desktop V2 startup used an obsolete CLI command

- Scope: Desktop's existing V2 background-CLI adapter.
- Observed: a newly packaged macOS app with `APEXO_SIDECAR_V2=1` could start the daemon, but `awaitInitialization()` failed because `apexo-cli service get password` returned `Unknown subcommand "get"`.
- Expected: retrieve the daemon's configured password and connect the packaged client to its native backend.
- Reproduction: build/stage the current CLI with `APEXO_SIDECAR_V2=1`, package the app, and launch that variant with isolated test state.
- Root cause: the Desktop adapter retained an older command shape; the CLI declares `service password`.
- Fix: invoke `service password`. Password output remains redacted by the existing adapter logger.
- Verification: after rebuilding and repackaging, `bun script/computer-use-ui.mjs desktop` from `packages/apexo` passed five checks: owned native backend startup, real Session UI, UI installation/activation of the downloaded plugin, real tool/task result display, and Stop settlement. The test used the packaged `.app` and its staged compiled V2 CLI, not a source-only window.
