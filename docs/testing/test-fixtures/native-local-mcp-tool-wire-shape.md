# BUG-20261015-181: Native local MCP fixture selected the wrong tool wire shape

- **Status:** Fixed in the acceptance fixture; no production defect established.
- **Scope:** Native local host ownership acceptance for an active MCP call.
- **Observed:** The fixture started its MCP server but timed out waiting for the tool-call trace. The provider received one turn and no MCP call began.
- **Expected:** Select the actually advertised MCP tool, hold its call, then verify joined host disposal reaps its process.
- **Root cause:** The provider callback looked only at Chat Completions `tool.function.name`. The actual native provider request used Responses tools with flat `tool.name`. The resulting undefined tool selection caused an ordinary response instead of the intended held call.
- **Fix:** Read the two supported wire shapes, then assert that the expected advertised tool exists before constructing the response. This is one fixture-authoring episode; unrelated response-event or finish-reason mistakes are not recurrence evidence.
- **Reproduction:** From `packages/apexo`, run `bun script/grok-native-local-lifecycle.mjs mcp`.
- **Verification:** The corrected command passed four ownership checks with one provider call: the real MCP call started, host shutdown joined, and the MCP process was no longer alive. The script was formatted and passed `node --check` before execution. The original timeout is retained as fixture evidence, not relabeled as a product fix.

The final strengthened MCP command passed six checks / one provider call, additionally reopening native history and proving it neither restarts model work nor restores an active interaction. This is the same corrected fixture, not another independent occurrence.
