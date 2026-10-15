// Installed Grok ACP comparison. Record only task tool inputs/results, never setup/config events.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import https from "node:https"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const directory = await mkdtemp(join(tmpdir(), "apexo-hooks-official-"))
const planned = { tool: "", args: {}, sent: false, content: undefined }
const providerCalls = []
const provider = createServer(async (request, response) => {
  if (request.method !== "POST") {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({ object: "list", data: [{ id: "fixture", object: "model", created: 1, owned_by: "fixture" }] }),
    )
    return
  }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  const tools = body.tools?.map((tool) => tool.function ?? tool) ?? []
  const aliases =
    planned.tool === "run_terminal_cmd"
      ? ["run_terminal_cmd", "run_terminal_command"]
      : planned.tool === "get_task_output"
        ? ["get_task_output", "get_command_or_subagent_output"]
        : [planned.tool]
  const tool = !planned.sent && tools.find((item) => aliases.includes(item.name))
  providerCalls.push({
    context: JSON.stringify(body).includes("STOP_OFFICIAL_CONTEXT"),
    tool: tool?.name,
    names: tools.map((item) => item.name),
  })
  if (tool) planned.sent = true
  if (planned.hold) {
    planned.inFlight = true
    await planned.hold
  }
  const id = `contract_${providerCalls.length}`
  response.writeHead(200, { "content-type": "text/event-stream" })
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          { index: 0, id, type: "function", function: { name: tool.name, arguments: JSON.stringify(planned.args) } },
        ],
      }
    : {
        role: "assistant",
        content:
          planned.content ??
          "The user requested a deterministic local hooks compatibility check. A read of the first target was denied by the host PreToolUse hook, which exited with status two and reported its policy reason. No protected fixture content was returned. A second read was rewritten by updatedInput to the reviewed file; the hook requested explicit approval, the ACP client approved it, and the tool returned REWRITTEN_SAFE_CONTENT. A third read targeted a missing file and failed normally, allowing the failure observer to record the event. Global TOML and JSON hook configuration supplied the lifecycle handlers. All model traffic uses the local fixture endpoint and no paid inference is involved. The next step is to verify that compaction emits both its pre-compaction and post-compaction observer events while preserving this task history.",
      }
  const events = [
    { id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: null }] },
    {
      id,
      object: "chat.completion.chunk",
      model: body.model,
      choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    },
  ]
  response.end(
    events.map((event) => `data: ${JSON.stringify({ created: 1, ...event })}\n\n`).join("") + "data: [DONE]\n\n",
  )
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
const networkHits = []
const network = https.createServer(
  {
    key: await readFile(new URL("../test/fixture/hook-tls/key.pem", import.meta.url)),
    cert: await readFile(new URL("../test/fixture/hook-tls/cert.pem", import.meta.url)),
  },
  async (request, response) => {
    for await (const chunk of request) {
    }
    networkHits.push(request.url)
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/redirect-target" })
      response.end()
      return
    }
    response.writeHead(200, { "content-type": "application/json" })
    response.end("{}")
  },
)
const clearNetwork = createServer(async (request, response) => {
  for await (const chunk of request) {
  }
  networkHits.push("cleartext")
  response.end("{}")
})
await Promise.all([
  new Promise((resolve) => network.listen(0, "127.0.0.1", resolve)),
  new Promise((resolve) => clearNetwork.listen(0, "127.0.0.1", resolve)),
])
await mkdir(join(directory, "grok-home"))
const log = join(directory, "hooks.jsonl")
const environmentLog = join(directory, "environment.jsonl")
await writeFile(
  join(directory, "environment.py"),
  `import os,json,sys
value=json.load(sys.stdin)
with open(sys.argv[1], "a") as out: out.write(json.dumps({"input":value,"session":os.environ["GROK_SESSION_ID"],"cwd":os.environ["GROK_WORKSPACE_ROOT"],"project":os.environ["CLAUDE_PROJECT_DIR"],"event":os.environ["GROK_HOOK_EVENT"],"name":os.environ["GROK_HOOK_NAME"],"default":sys.argv[2]})+"\\n")
`,
)
const dedupLog = join(directory, "dedup.jsonl")
await writeFile(
  join(directory, "dedup.py"),
  `import json,os,sys
value=json.load(sys.stdin)
with open(sys.argv[1], "a") as out: out.write(json.dumps({"prompt":value["prompt"],"value":os.environ["HOOK_VALUE"],"name":os.environ["GROK_HOOK_NAME"]})+"\\n")
`,
)
const dedupCommand = `python3 '${join(directory, "dedup.py")}' '${dedupLog}'`
const command = `python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)))' >> '${log}'`
await mkdir(join(directory, "grok-home/hooks"))
await writeFile(
  join(directory, "policy.py"),
  `import json,sys,os
value=json.load(sys.stdin)
with open(sys.argv[1], "a") as log: log.write(json.dumps(value)+"\\n")
if value["tool_input"].get("target_file", "").endswith("rewrite-original.txt"):
 print(json.dumps({"hookSpecificOutput":{"permissionDecision":"ask","permissionDecisionReason":"review rewritten path","updatedInput":{"target_file":os.path.join(sys.argv[2],"rewritten.txt")}}}))
elif value.get("tool_name") == "image_to_video":
 print(json.dumps({"hookSpecificOutput":{"permissionDecision":"allow"}}))
else:
 print("blocked by host hook", file=sys.stderr)
 sys.exit(2)
`,
)
await writeFile(
  join(directory, "stop.py"),
  `import json,sys
value=json.load(sys.stdin)
with open(sys.argv[1], "a") as log: log.write(json.dumps(value)+"\\n")
message=value.get("lastAssistantMessage", "") or ""
if "STOP_OFFICIAL_LIMIT" in message:
 print(json.dumps({"decision":"block","reason":"STOP_OFFICIAL_CONTEXT"}))
elif "STOP_OFFICIAL" in message:
 print(json.dumps({"continue":False}) if value.get("stopHookActive") else json.dumps({"decision":"block","reason":"STOP_OFFICIAL_CONTEXT"}))
`,
)
await writeFile(
  join(directory, "grok-home/hooks/policy.json"),
  JSON.stringify({
    hooks: {
      PreToolUse: [
        { hooks: [{ type: "command", command: `python3 '${join(directory, "policy.py")}' '${log}' '${directory}'` }] },
      ],
      Stop: [{ hooks: [{ type: "command", command: `python3 '${join(directory, "stop.py")}' '${log}'` }] }],
      permissionDenied: [{ matcher: "Read", hooks: [{ type: "command", command }] }],
      notification: [{ matcher: "permission_prompt", hooks: [{ type: "command", command }] }],
      stop_cancelled: [{ hooks: [{ type: "command", command }] }],
      UserPromptSubmit: [
        {
          hooks: [
            { type: "command", command: dedupCommand, timeout: 10, env: { HOOK_VALUE: "duplicate-file" } },
            { type: "command", command: `${dedupCommand}; true`, env: { HOOK_VALUE: "distinct" } },
            { type: "command", command: dedupCommand, timeout: 2, env: { HOOK_VALUE: "config" } },
          ],
        },
        {
          hooks: [
            { type: "http", url: `http://127.0.0.1:${clearNetwork.address().port}/clear` },
            { type: "http", url: "https://169.254.169.254/blocked", timeout: 0.2 },
            { type: "http", url: `https://127.0.0.1:${network.address().port}/redirect` },
            {
              type: "http",
              url: "${HOOK_ENDPOINT}/policy",
              env: { HOOK_ENDPOINT: `https://127.0.0.1:${network.address().port}` },
            },
          ],
        },
        {
          hooks: [
            { type: "command", command },
            {
              type: "command",
              command: `python3 '\${HOOK_SCRIPT}' '\${HOOK_LOG}' "\${HOOK_EMPTY:-fallback}"`,
              env: {
                HOOK_SCRIPT: join(directory, "environment.py"),
                HOOK_LOG: environmentLog,
                HOOK_EMPTY: "",
                GROK_SESSION_ID: "forged",
                GROK_WORKSPACE_ROOT: "forged",
                CLAUDE_PROJECT_DIR: "forged",
                GROK_HOOK_EVENT: "forged",
                GROK_HOOK_NAME: "forged",
              },
            },
            { type: "command", command: `touch '${join(directory, "unset-spawned")}'; echo $APEXO_HOOK_UNSET_105` },
          ],
        },
      ],
      PostToolUseFailure: [{ hooks: [{ type: "command", command }] }],
      PreCompact: [{ hooks: [{ type: "command", command }] }],
      PostCompact: [{ hooks: [{ type: "command", command }] }],
      SessionStart: [
        {
          hooks: ["prompt", "agent"].map((type) => ({
            type,
            command: `printf unsupported > '${join(directory, "unsupported-handler.txt")}'`,
          })),
        },
      ],
    },
  }),
)
await writeFile(
  join(directory, "grok-home/config.toml"),
  `[[hooks.SessionStart]]
[[hooks.SessionStart.hooks]]
type="command"
command=${JSON.stringify(command)}
[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type="command"
command=${JSON.stringify(dedupCommand)}
timeout=2
[hooks.UserPromptSubmit.hooks.env]
HOOK_VALUE="config"
[models]
default="task-contract"
[model.task-contract]
model="fixture"
name="Hooks fixture"
base_url="http://127.0.0.1:${provider.address().port}/v1"
api_key="local-fixture-key"
api_backend="chat_completions"
context_window=100000
`,
)
const child = spawn(process.env.APEXO_GROK_BUILD_BIN ?? "grok", ["agent", "stdio"], {
  cwd: directory,
  env: {
    ...process.env,
    HOME: directory,
    APEXO_TEST_HOME: directory,
    GROK_MAX_WAIT_BLOCK_MS: "80",
    GROK_HOME: join(directory, "grok-home"),
    GROK_EXTRA_CA_BUNDLE: fileURLToPath(new URL("../test/fixture/hook-tls/ca.pem", import.meta.url)),
    GROK_CONFIG: "",
    GROK_CONFIG_PATH: "",
    XAI_API_KEY: "local-fixture-key",
  },
  stdio: ["pipe", "pipe", "pipe"],
})
const exited = new Promise((resolve) => child.once("exit", resolve))
const stderr = []
const events = []
const commands = []
const results = []
const state = { sessionID: "", taskID: "", pid: 0 }
child.stderr.on("data", (data) => stderr.push(data))
function record(update) {
  if (update.sessionUpdate === "available_commands_update")
    commands.push(...update.availableCommands.map((command) => command.name))
  if (!["tool_call", "tool_call_update"].includes(update.sessionUpdate)) return
  events.push({
    type: update.sessionUpdate,
    id: update.toolCallId,
    title: update.title,
    status: update.status,
    input: update.rawInput,
    output: update.rawOutput,
    content: Array.isArray(update.content)
      ? update.content
          .filter((item) => item.type === "content" && item.content?.type === "text")
          .map((item) => item.content.text)
      : undefined,
    time: Date.now(),
  })
}
const permissions = []
const connection = new ClientSideConnection(
  () => ({
    async requestPermission(params) {
      permissions.push(params)
      const option = params.options.find((option) => option.kind === (planned.reject ? "reject_once" : "allow_once"))
      assert.ok(option)
      return { outcome: { outcome: "selected", optionId: option.optionId } }
    },
    async sessionUpdate(params) {
      record(params.update)
    },
    async extNotification(method, params) {
      if (method === "_x.ai/session_notification" && params.update) record(params.update)
    },
  }),
  ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
)
async function prompt(text) {
  const before = events.length
  const result = await deadline(
    connection.prompt({ sessionId: state.sessionID, prompt: [{ type: "text", text }] }),
    60_000,
    "official task contract turn",
  )
  assert.equal(result.stopReason, "end_turn")
  return events.slice(before)
}
try {
  await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
  state.sessionID = (await connection.newSession({ cwd: directory, mcpServers: [] })).sessionId
  Object.assign(planned, { tool: "read_file", args: { target_file: join(directory, "target.txt") }, sent: false })
  await writeFile(join(directory, "target.txt"), "PRIVATE FIXTURE CONTENT")
  const turn = await prompt("Read the target file")
  assert.ok(planned.sent, "read_file not advertised")
  assert.match(JSON.stringify(turn), /blocked by host hook/)
  assert.ok(!JSON.stringify(turn).includes("PRIVATE FIXTURE CONTENT"))
  await writeFile(join(directory, "rewritten.txt"), "REWRITTEN_SAFE_CONTENT")
  Object.assign(planned, {
    tool: "read_file",
    args: { target_file: join(directory, "rewrite-original.txt") },
    sent: false,
  })
  const rewritten = await prompt("Read the rewrite-original.txt file")
  assert.ok(planned.sent)
  assert.match(JSON.stringify(rewritten), /REWRITTEN_SAFE_CONTENT/)
  assert.ok(permissions.length > 0, "official ask decision did not prompt")
  Object.assign(planned, {
    tool: "image_to_video",
    args: { image: "data:image/png;base64,iVBORw0KGgo=", duration: 8 },
    sent: false,
  })
  const failed = await prompt("Request invalid video duration to exercise validation without any media API call")
  assert.ok(planned.sent)
  assert.ok(
    failed.some((event) => event.status === "failed"),
    JSON.stringify(failed),
  )
  assert.ok(commands.includes("compact"), "official ACP compact command missing")
  await prompt("/compact")
  planned.tool = ""
  planned.content = "STOP_OFFICIAL_RESPONSE"
  await prompt("Check Stop continuation")
  assert.ok(
    providerCalls.some((call) => call.context),
    "Stop context reached official provider",
  )
  planned.content = "STOP_OFFICIAL_LIMIT_RESPONSE"
  await prompt("Check Stop continuation bound")
  Object.assign(planned, {
    tool: "read_file",
    args: { target_file: join(directory, "rewrite-original.txt") },
    sent: false,
    content: "PERMISSION_REJECTED",
    reject: true,
  })
  await connection.prompt({ sessionId: state.sessionID, prompt: [{ type: "text", text: "Reject the requested read" }] })
  planned.reject = false
  planned.tool = ""
  const hold = Promise.withResolvers()
  planned.hold = hold.promise
  planned.inFlight = false
  const interrupted = connection.prompt({
    sessionId: state.sessionID,
    prompt: [{ type: "text", text: "Interrupt active provider work" }],
  })
  await poll(async () => planned.inFlight, "official provider in flight")
  await connection.cancel({ sessionId: state.sessionID })
  hold.resolve()
  await deadline(interrupted, 15_000, "official interrupted turn")
  planned.hold = undefined
  await poll(
    async () => (await readFile(log, "utf8")).includes('"reason": "user_interrupt"'),
    "official explicit cancellation observer",
  )
  const dedupEntries = (await readFile(dedupLog, "utf8")).trim().split("\n").map(JSON.parse)
  assert.ok(dedupEntries.length >= 2)
  assert.ok(dedupEntries.some((entry) => entry.value === "duplicate-file")) // Installed keeps changed environment/timeout copies.
  assert.equal(
    dedupEntries.filter((entry) => entry.value === "duplicate-file").length,
    dedupEntries.filter((entry) => entry.value === "distinct").length,
  )
  assert.equal(
    dedupEntries.filter((entry) => entry.value === "config").length,
    dedupEntries.filter((entry) => entry.value === "distinct").length,
  )
  assert.ok(
    dedupEntries.filter((entry) => entry.value === "distinct").every((entry) => entry.name.endsWith(".hooks[1]")),
  )
  assert.ok(networkHits.includes("/policy"))
  assert.ok(networkHits.includes("/redirect"))
  assert.ok(!networkHits.includes("/redirect-target"))
  assert.ok(networkHits.includes("cleartext")) // Installed 1.0.52 allows loopback HTTP; pinned source requires HTTPS.
  assert.match(Buffer.concat(stderr).toString(), /private\/internal|blocked private|SSRF protection/)
  const environment = JSON.parse((await readFile(environmentLog, "utf8")).trim().split("\n")[0])
  assert.equal(environment.session, state.sessionID)
  assert.equal(environment.cwd, directory)
  assert.equal(environment.project, await realpath(directory))
  assert.equal(environment.event, "user_prompt_submit")
  assert.notEqual(environment.name, "forged")
  assert.equal(environment.default, "fallback")
  assert.equal((await readFile(join(directory, "unset-spawned"))).length, 0) // Installed 1.0.52 differs from pinned source preflight.
  const hooks = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse)
  for (const event of [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUseFailure",
    "PreCompact",
    "PostCompact",
  ])
    assert.ok(
      hooks.some((hook) => hook.hook_event_name === event),
      event,
    )
  assert.ok(
    !hooks.some(
      (hook) =>
        hook.hook_event_name === "PostToolUseFailure" &&
        (hook.toolName === "read_file" || hook.tool_name === "read_file"),
    ),
    "denied reads are not dispatch failures",
  )
  assert.ok(hooks.some((hook) => hook.hook_event_name === "PermissionDenied" && hook.toolName === "read_file"))
  assert.ok(
    hooks.some((hook) => hook.hook_event_name === "Notification" && hook.notificationType === "permission_prompt"),
  )
  assert.ok(hooks.some((hook) => hook.hook_event_name === "StopCancelled" && hook.reason === "user_interrupt"))
  const stopped = hooks.filter(
    (hook) => hook.hook_event_name === "Stop" && hook.lastAssistantMessage?.includes("STOP_OFFICIAL"),
  )
  assert.equal(stopped.filter((hook) => hook.lastAssistantMessage === "STOP_OFFICIAL_RESPONSE").length, 2)
  assert.equal(stopped.filter((hook) => hook.lastAssistantMessage === "STOP_OFFICIAL_LIMIT_RESPONSE").length, 8)
  assert.match(Buffer.concat(stderr).toString(), /unsupported handler type 'prompt'/)
  assert.match(Buffer.concat(stderr).toString(), /unsupported handler type 'agent'/)
  assert.equal(await readFile(join(directory, "unsupported-handler.txt"), "utf8").catch(() => undefined), undefined)
  const snapshotTrace = join(directory, "snapshot-added.txt")
  await writeFile(join(directory, "grok-home/hooks/snapshot-added.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: `printf added >> '${snapshotTrace}'` }] }] } }))
  Object.assign(planned, { tool: "", sent: false, reject: false, content: "SNAPSHOT_REFERENCE_DONE" })
  await prompt("Check existing Session configuration snapshot")
  assert.equal(await readFile(snapshotTrace, "utf8").catch(() => undefined), undefined)
  state.sessionID = (await connection.newSession({ cwd: directory, mcpServers: [] })).sessionId
  await prompt("Check fresh Session configuration snapshot")
  assert.equal(await readFile(snapshotTrace, "utf8"), "added")
  console.log(
    JSON.stringify({
      result: "pass",
      installed: "Grok",
      scenarios: [
        "TOML SessionStart",
        "JSON prompt hook",
        "exit-two read denial",
        "updatedInput read",
        "ask permission decision",
        "dispatch failure observer",
        "pre/post compact observers",
        "prompt and agent handlers rejected",
        "Stop trusted continuation and force-stop",
        "Stop eight-continuation bound",
        "permission rejection observer via camel event alias",
        "permission notification via lowercase event alias",
        "explicit cancellation via snake event alias",
        "configured environment expansion and authentic identity",
        "shell defaults and installed unset-reference behavior",
        "trusted HTTPS and URL expansion",
        "installed cleartext loopback allowance and private-address rejection",
        "redirect never followed",
        "installed identical-settings dedup and changed-settings retention",
        "distinct hook preserves original identity",
        "existing Session retains hook snapshot",
        "new Session discovers added hook",
      ],
    }),
  )
} finally {
  if (state.sessionID) await connection.cancel({ sessionId: state.sessionID }).catch(() => {})
  child.kill("SIGTERM")
  await deadline(exited, 10000, "official cleanup").catch(() => child.kill("SIGKILL"))
  network.closeAllConnections()
  clearNetwork.closeAllConnections()
  await Promise.all([
    new Promise((resolve) => network.close(resolve)),
    new Promise((resolve) => clearNetwork.close(resolve)),
  ])
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(directory, "hooks.json"), JSON.stringify({ results, events, providerCalls }, null, 2))
  await writeFile(join(directory, "stderr.log"), Buffer.concat(stderr))
  console.error(`Official hooks evidence: ${directory}`)
}
