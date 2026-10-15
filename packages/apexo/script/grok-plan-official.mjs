import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline } from "./grok-shell-fixture.mjs"
const output = await mkdtemp(join(tmpdir(), "apexo-plan-official-"))
const home = join(output, "home"),
  cwd = join(output, "workspace")
await mkdir(home)
await mkdir(cwd)
const calls = [],
  events = [],
  requests = [],
  logs = [],
  results = []
const planned = { tool: "", sent: false, reject: false, approval: "cancelled", batch: [] }
const provider = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (request.method !== "POST") return response.end(JSON.stringify({ data: [{ id: "fixture" }] }))
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push(body)
  const tool = !planned.sent && (body.tools ?? []).map((x) => x.function ?? x).find((x) => x.name === planned.tool)
  if (tool) planned.sent = true
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: (planned.batch.length ? planned.batch : [{ name: tool.name, args: {} }]).map((item, index) => ({
          index,
          id: `plan_call_${calls.length}_${index}`,
          type: "function",
          function: { name: item.name, arguments: JSON.stringify(item.args) },
        })),
      }
    : { role: "assistant", content: "ACK" }
  const chunk = (delta, finish_reason = null) => ({
    id: "plan-reference",
    object: "chat.completion.chunk",
    created: 1,
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason }],
  })
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.write(`data: ${JSON.stringify(chunk(delta))}\n\n`)
  response.end(
    `data: ${JSON.stringify({ ...chunk({}, tool ? "tool_calls" : "stop"), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
  )
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault="fixture"\n[model.fixture]\nmodel="fixture"\nname="Plan reference"\nbase_url="http://127.0.0.1:${provider.address().port}/v1"\napi_key="fixture"\napi_backend="chat_completions"\ncontext_window=100000\n[memory]\nenabled=false\n[memory_v2]\nenabled=false\n[cli]\nuse_leader=false\n${process.env.REFERENCE_PERMISSION ? `[permission]\nrules=[{action="${process.env.REFERENCE_PERMISSION}",tool="any"}]\n` : ""}`,
)
const child = spawn(
  process.env.GROK_BIN ?? "grok",
  ["agent", "stdio", "--leader-socket", join(output, "leader.sock")],
  {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: home,
      GROK_HOME: home,
      GROK_CONFIG: "",
      GROK_CONFIG_PATH: "",
      XAI_API_KEY: "fixture",
      GROK_TITLE_REFRESH: "0",
      GROK_TURN_SUMMARY: "0",
      GROK_MANAGED_MCPS_ENABLED: "0",
      ...Object.fromEntries(
        ["CONFIG", "DATA", "STATE", "CACHE", "RUNTIME"].map((k) => [
          `XDG_${k}_HOME`,
          join(home, `xdg-${k.toLowerCase()}`),
        ]),
      ),
      XDG_RUNTIME_DIR: join(home, "xdg-runtime"),
      ...Object.fromEntries(
        ["CURSOR", "CLAUDE", "CODEX"].flatMap((v) =>
          ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"].map((s) => [`GROK_${v}_${s}_ENABLED`, "0"]),
        ),
      ),
    },
  },
)
const exited = new Promise((resolve) => child.once("exit", resolve))
child.stderr.on("data", (x) => logs.push(String(x)))
const connection = new ClientSideConnection(
  () => ({
    async requestPermission(input) {
      requests.push({ kind: "permission", input, reject: planned.reject })
      const option = input.options.find((x) => x.kind === (planned.reject ? "reject_once" : "allow_once"))
      return option
        ? { outcome: { outcome: "selected", optionId: option.optionId } }
        : { outcome: { outcome: "cancelled" } }
    },
    async sessionUpdate(input) {
      events.push(input)
    },
    async extNotification(method, params) {
      events.push({ method, params })
    },
    async extMethod(method, params) {
      requests.push({ kind: "extension", method, params, approval: planned.approval })
      if (method.includes("exit_plan_mode")) return { outcome: planned.approval }
      throw new Error(`Unexpected reverse method ${method}`)
    },
  }),
  ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
)
async function invoke(sessionId, tool, reject = false, approval = "cancelled") {
  Object.assign(planned, { tool, sent: false, reject, approval })
  const start = { calls: calls.length, events: events.length, requests: requests.length }
  const outcome = await deadline(
    connection.prompt({ sessionId, prompt: [{ type: "text", text: `PLAN_REFERENCE request ${tool}` }] }),
    20000,
    tool,
  )
  const state = await connection.extMethod("_x.ai/session/state", { sessionId, cwd })
  const result = {
    tool,
    reject,
    approval,
    sent: planned.sent,
    outcome,
    state,
    requests: requests.slice(start.requests),
    events: events.slice(start.events),
    providerCalls: calls.length - start.calls,
  }
  results.push(result)
  console.log(
    JSON.stringify({ tool, reject, approval, sent: result.sent, requests: result.requests, planMode: state.planMode }),
  )
  return result
}
try {
  await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30000,
    "initialize",
  )
  const sessionId = (await connection.newSession({ cwd, mcpServers: [] })).sessionId
  const first = await invoke(sessionId, "enter_plan_mode", true)
  const paths = first.events
    .flatMap((e) => (e.update ? [e.update] : e.params?.update ? [e.params.update] : []))
    .flatMap((e) => (e.rawOutput?.Entered?.plan_file_path ? [e.rawOutput.Entered.plan_file_path] : []))
  await invoke(sessionId, "enter_plan_mode", false)
  await invoke(sessionId, "exit_plan_mode", false, "cancelled")
  await invoke(sessionId, "exit_plan_mode", false, "invalid")
  await invoke(sessionId, "exit_plan_mode", false, "approved")
  if (!process.env.REFERENCE_PERMISSION) {
    await invoke(sessionId, "enter_plan_mode", false)
    const path = paths[0]
    assert.ok(path, "canonical plan path")
    planned.batch = [
      { name: "exit_plan_mode", args: {} },
      { name: "write", args: { file_path: path, content: "# Plan\nBATCH_FINAL_PLAN" } },
    ]
    const batch = await invoke(sessionId, "exit_plan_mode", false, "approved")
    planned.batch = []
    assert.ok(
      batch.requests.some((x) => x.params?.planContent?.includes("BATCH_FINAL_PLAN")),
      "exit approval sees later sibling plan write",
    )
  }
  const checks = []
  assert.ok(
    results.every((item) => item.sent),
    "reference model called each advertised transition",
  )
  if (process.env.REFERENCE_PERMISSION === "deny") {
    assert.ok(results.every((item) => !item.state.planMode || item.state.planMode.state === "Inactive"))
    assert.ok(results.every((item) => item.requests.length === 0))
    checks.push("configured deny blocks all transition side effects and approval requests")
  } else {
    const asked = process.env.REFERENCE_PERMISSION === "ask"
    assert.equal(
      results[0].requests.some((item) => item.kind === "permission"),
      asked,
    )
    assert.equal(results[0].state.planMode?.state, asked ? undefined : "Active")
    checks.push(asked ? "configured ask rejects before entry" : "default entry needs no permission callback")
    assert.equal(results[1].state.planMode.state, "Active")
    checks.push("allowed entry activates Plan")
    for (const index of [2, 3]) {
      assert.equal(results[index].state.planMode.state, "Active")
      assert.equal(results[index].requests.filter((item) => item.kind === "extension").length, 1)
    }
    checks.push("cancelled and unknown exit decisions retain Plan")
    assert.equal(results[4].state.planMode.state, "Inactive")
    assert.equal(results[4].requests.filter((item) => item.kind === "extension").length, 1)
    checks.push("only explicit approved exit leaves Plan")
    if (!asked) checks.push("exit first in a batch observes the later plan write before approval")
  }
  console.log(
    JSON.stringify({
      output,
      permission: process.env.REFERENCE_PERMISSION ?? "default",
      checks,
      passed: checks.length,
      providerCalls: calls.length,
    }),
  )
} finally {
  child.kill("SIGTERM")
  await deadline(exited, 10000, "exit").catch(async () => {
    child.kill("SIGKILL")
    await deadline(exited, 5000, "kill")
  })
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(output, "evidence.json"), JSON.stringify({ results, calls, requests, events }, null, 2))
  await writeFile(join(output, "stderr.log"), logs.join(""))
  console.log(`Evidence ${output}`)
}
