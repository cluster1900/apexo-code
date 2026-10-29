import assert from "node:assert/strict"
import { createServer } from "node:http"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const modelFixture = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  const hasComputerResult = body.messages?.some((item) => item.role === "tool" && (item.name === "computer" || item.tool_call_id)) === true
  const call = !hasComputerResult
  const id = `computer-desktop-${body.messages?.length ?? 0}`
  const delta = call
    ? { role: "assistant", tool_calls: [{ index: 0, id: "computer-desktop-call", type: "function", function: { name: "computer", arguments: JSON.stringify({ action: "open" }) } }] }
    : { role: "assistant", content: "AUTO_COMPUTER_DONE" }
  const events = [
    { id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: null }] },
    { id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ]
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n")
})
await new Promise((resolve) => modelFixture.listen(0, "127.0.0.1", resolve))
const modelURL = `http://127.0.0.1:${modelFixture.address().port}/v1`
const runtime = await startShellFixture("desktop", {
  server: "v2",
  deferBackend: true,
  env: { APEXO_COMPUTER_BACKEND: "fixture", XAI_BASE_URL: modelURL },
  config: { provider: { xai: { npm: "@ai-sdk/openai-compatible", options: { apiKey: "local-parity-key", baseURL: modelURL }, models: { "grok-4.7": { name: "Computer Use fixture", tool_call: true, limit: { context: 100000, output: 10000 } } } } } },
})
try {
  await writeFile(join(runtime.directory, "apexo.json"), JSON.stringify({ permission: { "*": "allow" }, provider: { xai: { npm: "@ai-sdk/openai-compatible", options: { apiKey: "local-parity-key", baseURL: modelURL }, models: { "grok-4.7": { name: "Computer Use fixture", tool_call: true, limit: { context: 100000, output: 10000 } } } } } }))
  runtime.env.APEXO_CONFIG = join(runtime.directory, "apexo.json")
  await runtime.reopen()
  const session = await runtime.api("/session", { title: "Automatic computer fixture", agent: "build", model: { providerID: "xai", id: "grok-4.7" } })
  await runtime.api(`/session/${session.id}/message`, { model: { providerID: "xai", modelID: "grok-4.7" }, parts: [{ type: "text", text: "AUTO_COMPUTER" }] })
  const history = await runtime.api(`/session/${session.id}/message`)
  const computerPart = history.flatMap((message) => message.parts).find((part) => part.type === "tool" && part.tool === "computer")
  assert.equal(computerPart?.state.status, "completed")
  const info = JSON.parse(computerPart.state.output)
  assert.equal(info.status, "ready")
  console.log(JSON.stringify({ kind: "desktop-v1-auto", sessionID: session.id, computerSessionID: info.id, tool: "computer", status: info.status }))
} finally {
  await runtime.close()
  modelFixture.closeAllConnections()
  await new Promise((resolve) => modelFixture.close(resolve))
}
