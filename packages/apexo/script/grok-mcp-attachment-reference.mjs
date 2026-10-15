import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, writeFile, readFile, realpath } from "node:fs/promises"
import { tmpdir, homedir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"
assert.equal(process.platform, "darwin", "Reference probe requires actual macOS sandbox isolation")
const output = await realpath(await mkdtemp(join(tmpdir(), "apexo-mcp-picker-reference-")))
const home = join(output, "home"),
  workspace = join(output, "workspace"),
  trace = join(output, "mcp.jsonl")
await mkdir(home)
await mkdir(workspace)
await mkdir(join(home, "tmp"))
const binary = await realpath(process.env.GROK_REFERENCE_BINARY ?? join(homedir(), ".grok/bin/grok"))
const bun = await realpath(process.execPath)
assert.ok(process.versions.bun, "Run this reference fixture with the repository-pinned Bun")
const resourceServer = join(output, "resource-server.mjs")
await writeFile(
  resourceServer,
  await readFile(new URL("../test/fixture/mcp-attachment-reference.mjs", import.meta.url)),
)
const calls = [],
  events = [],
  permissions = [],
  checks = [],
  stderr = []
const provider = createServer(async (request, response) => {
  if (request.method !== "POST") return response.end(JSON.stringify({ data: [{ id: "fixture", object: "model" }] }))
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  const names = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
  const systems = (body.messages ?? [])
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n")
  const user = (body.messages ?? []).findLast((message) => message.role === "user")
  const userText =
    typeof user?.content === "string" ? user.content : (user?.content ?? []).map((part) => part.text ?? "").join("\n")
  const role =
    request.url.endsWith("/responses") && names.includes("session_title")
      ? "title"
      : systems.includes("Write an ultra-short dashboard line")
        ? "dashboard"
        : userText.includes("MCP_PICKER_REFERENCE_USER")
          ? "main"
          : "unknown"
  calls.push({ role, path: request.url, body, userText })
  if (request.url.endsWith("/responses")) {
    const item = {
      type: "function_call",
      id: "fc_reference_title",
      call_id: "call_reference_title",
      name: "session_title",
      arguments: JSON.stringify({
        session_title: "Preserve the apricot decision",
      }),
      status: "completed",
    }
    const result = {
      id: "resp_reference_title",
      object: "response",
      created_at: 1,
      model: body.model,
      status: "completed",
      output: [item],
      error: null,
      incomplete_details: null,
      instructions: null,
      max_output_tokens: null,
      parallel_tool_calls: true,
      previous_response_id: null,
      reasoning: { effort: null, summary: null },
      store: false,
      temperature: 1,
      text: { format: { type: "text" } },
      tool_choice: "auto",
      tools: body.tools ?? [],
      top_p: 1,
      truncation: "disabled",
      user: null,
      metadata: {},
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }
    response.writeHead(200, { "content-type": "text/event-stream" })
    return response.end(
      [
        {
          type: "response.created",
          response: { ...result, status: "in_progress", output: [] },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, arguments: "", status: "in_progress" },
        },
        {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          item_id: item.id,
          delta: item.arguments,
        },
        {
          type: "response.function_call_arguments.done",
          output_index: 0,
          item_id: item.id,
          arguments: item.arguments,
        },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: result },
      ]
        .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
        .join(""),
    )
  }

  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(
    [
      {
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: role === "main" ? "MCP_PICKER_REFERENCE_DONE" : "Reference ancillary reply",
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ]
      .map(
        (event) =>
          `data: ${JSON.stringify({ id: "reference", object: "chat.completion.chunk", created: 1, model: body.model, ...event })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
  )
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
const url = `http://127.0.0.1:${provider.address().port}`
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "Private MCP reference"\nbase_url = "${url}/v1"\napi_key = "fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = false\n[memory_v2]\nenabled = false\n[cli]\nuse_leader = false\n`,
)
const env = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: home,
  GROK_HOME: home,
  TMPDIR: join(home, "tmp"),
  LANG: "en_US.UTF-8",
  TERM: "dumb",
  GROK_CONFIG: "",
  GROK_CONFIG_PATH: "",
  XAI_API_KEY: "fixture",
  GROK_MANAGED_MCPS_ENABLED: "0",
  GROK_TELEMETRY_ENABLED: "0",
  GROK_TELEMETRY_TRACE_UPLOAD: "0",
  GROK_TELEMETRY_MIXPANEL_ENABLED: "0",
  GROK_XAI_API_BASE_URL: `${url}/v1`,
  GROK_MODELS_LIST_URL: `${url}/v1/models`,
  GROK_CLI_CHAT_PROXY_BASE_URL: `${url}/v1`,
  GROK_CONVERSATIONS_BASE_URL: url,
  GROK_SKILLS_BASE_URL: url,
}
for (const kind of ["CONFIG", "DATA", "STATE", "CACHE", "RUNTIME"]) {
  const path = join(home, `xdg-${kind.toLowerCase()}`)
  await mkdir(path)
  env[kind === "RUNTIME" ? "XDG_RUNTIME_DIR" : `XDG_${kind}_HOME`] = path
}
for (const vendor of ["CURSOR", "CLAUDE", "CODEX"])
  for (const surface of ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"]) env[`GROK_${vendor}_${surface}_ENABLED`] = "0"
const profile = join(output, "isolation.sb")
await writeFile(
  profile,
  `(version 1)\n(allow default)\n(deny network*)\n(allow network-outbound (remote ip "localhost:${provider.address().port}"))\n(allow network-bind (local unix-socket (subpath ${JSON.stringify(output)})))\n(allow network-inbound (local unix-socket (subpath ${JSON.stringify(output)})))\n(allow network-outbound (remote unix-socket (subpath ${JSON.stringify(output)})))\n(deny file-read* file-write* (subpath ${JSON.stringify(await realpath(homedir()))}))\n(allow file-read* (literal ${JSON.stringify(binary)}))\n(allow file-read* (literal ${JSON.stringify(bun)}))\n`,
)
await writeFile(
  join(output, "isolation.json"),
  JSON.stringify({ binary, env, profile: await readFile(profile, "utf8") }, null, 2),
)
const guarded = async (args) => {
  const child = spawn("/usr/bin/sandbox-exec", ["-f", profile, ...args], {
    cwd: workspace,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  const stdout = [],
    errors = []
  child.stdout.on("data", (b) => stdout.push(b))
  child.stderr.on("data", (b) => errors.push(b))
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code) => resolve(code))
  })
  try {
    return {
      code: await deadline(exited, 15000, "guard preflight"),
      stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(errors).toString(),
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid, "SIGKILL")
      await exited
    }
  }
}
let child, exited
try {
  const blockedCalls = []
  const blocked = createServer((request, response) => {
    blockedCalls.push(request.url)
    response.end("unexpected")
  })
  try {
    const denied = await guarded(["/bin/ls", await realpath(homedir())])
    assert.notEqual(denied.code, 0)
    assert.equal(denied.stdout, "")
    assert.match(denied.stderr, /Operation not permitted|Permission denied/)
    await new Promise((resolve) => blocked.listen(0, "127.0.0.1", resolve))
    assert.notEqual(
      (
        await guarded([
          "/usr/bin/curl",
          "--silent",
          "--max-time",
          "2",
          `http://127.0.0.1:${blocked.address().port}/denied`,
        ])
      ).code,
      0,
    )
    assert.equal(blockedCalls.length, 0)
    assert.equal((await guarded(["/usr/bin/curl", "--silent", "--max-time", "2", `${url}/v1/models`])).code, 0)
    const version = await guarded([binary, "--version"])
    assert.equal(version.code, 0)
    await writeFile(join(output, "version.json"), JSON.stringify(version))
    checks.push("actual-home-denial-and-exact-provider-port-guard")
  } finally {
    blocked.closeAllConnections()
    if (blocked.listening) await new Promise((resolve) => blocked.close(resolve))
  }
  child = spawn(
    "/usr/bin/sandbox-exec",
    ["-f", profile, binary, "agent", "stdio", "--leader-socket", join(output, "leader.sock")],
    { cwd: workspace, env, detached: true, stdio: ["pipe", "pipe", "pipe"] },
  )
  exited = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })
  child.stderr.on("data", (b) => stderr.push(b))
  const connection = new ClientSideConnection(
    () => ({
      async sessionUpdate(value) {
        events.push(value)
      },
      async extNotification(method, params) {
        events.push({ method, params })
      },
      async requestPermission(params) {
        permissions.push(params)
        const option = params.options.find((o) => o.kind === "allow_once")
        return {
          outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" },
        }
      },
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  )
  await deadline(
    connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "apexo-private-resource-reference", version: "1" },
    }),
    20000,
    "reference initialize",
  )
  const session = await deadline(
    connection.newSession({
      cwd: workspace,
      mcpServers: [
        {
          name: "reference",
          command: bun,
          args: [resourceServer],
          env: [{ name: "REFERENCE_MCP_TRACE", value: trace }],
        },
      ],
    }),
    20000,
    "reference session",
  )
  await poll(
    () => events.some((e) => e.method === "_x.ai/mcp_initialized" && e.params?.sessionId === session.sessionId),
    "reference MCP initialized",
    30000,
  )
  assert.equal(calls.length, 0)
  checks.push("initialized-private-mcp-without-provider-work")
  const catalog = await connection.extMethod("_x.ai/mcp/list", {
    sessionId: session.sessionId,
  })
  await writeFile(join(output, "catalog.json"), JSON.stringify(catalog, null, 2))
  const read = async (uri, server = "reference") => {
    const result = await connection.extMethod("_x.ai/mcp/read_resource", {
      sessionId: session.sessionId,
      server,
      uri,
    })
    return result.result ?? result
  }
  const value = await read("fixture://note/one")
  assert.equal(value.contents.length, 3)
  assert.equal(value.contents[0].text, "MCP_REFERENCE_RETURNED_BYTES_é中文")
  assert.equal(value.contents[0]._meta.origin, "private-read")
  assert.equal(value.contents[2].blob, Buffer.from("UNSUPPORTED_REFERENCE_BINARY").toString("base64"))
  checks.push("all-returned-blocks-and-metadata-preserved")
  const templateUri = "fixture://note/name%20with%20space?view=full%2Fdetail"
  const expanded = await read(templateUri)
  assert.equal(expanded.contents[0].uri, templateUri)
  checks.push("caller-expanded-opaque-template-uri-forwarded-exactly")
  for (const [uri, server] of [
    ["fixture://empty", "reference"],
    ["fixture://note/one", "missing"],
  ]) {
    const error = await read(uri, server).then(
      () => undefined,
      (e) => e,
    )
    assert.ok(error)
    checks.push(server === "missing" ? "unknown-server-explicit-error" : "empty-read-explicit-error")
  }
  assert.equal(calls.length, 0)
  checks.push("catalog-and-explicit-reads-made-zero-provider-requests")
  const beforeReads = (await readFile(trace, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse)
    .filter((r) => r.method === "resources/read").length
  await deadline(
    connection.prompt({
      sessionId: session.sessionId,
      prompt: [
        {
          type: "text",
          text: "MCP_PICKER_REFERENCE_USER: inspect this explicitly attached snapshot.",
        },
        {
          type: "resource",
          resource: {
            uri: value.contents[0].uri,
            mimeType: "text/plain",
            text: value.contents[0].text,
          },
        },
      ],
    }),
    60000,
    "reference embedded snapshot prompt",
  )
  const main = calls.filter((call) => call.role === "main")
  assert.equal(main.length, 1)
  assert.ok(main[0].userText.includes("MCP_REFERENCE_RETURNED_BYTES_é中文"))
  assert.ok(
    events.some(
      (e) =>
        e.update?.sessionUpdate === "agent_message_chunk" &&
        e.update.content?.text?.includes("MCP_PICKER_REFERENCE_DONE"),
    ),
  )
  assert.equal(
    (await readFile(trace, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse)
      .filter((r) => r.method === "resources/read").length,
    beforeReads,
  )
  checks.push("embedded-snapshot-reaches-current-user-provider-input-without-reread")
  assert.ok(!calls.some((call) => call.role === "unknown"))
  checks.push("every-provider-request-classified-by-authoritative-fields")
  console.log(
    JSON.stringify(
      {
        checks,
        providerCalls: calls.length,
        classified: Object.fromEntries(
          ["main", "title", "dashboard"].map((role) => [role, calls.filter((call) => call.role === role).length]),
        ),
        permissionRequests: permissions.length,
        output,
      },
      null,
      2,
    ),
  )
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    process.kill(-child.pid, "SIGTERM")
    await deadline(exited, 10000, "reference joined exit").catch(async () => {
      process.kill(-child.pid, "SIGKILL")
      await exited
    })
  }
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(output, "requests.json"), JSON.stringify(calls, null, 2))
  await writeFile(join(output, "events.json"), JSON.stringify(events, null, 2))
  await writeFile(join(output, "permissions.json"), JSON.stringify(permissions, null, 2))
  await writeFile(join(output, "stderr.log"), Buffer.concat(stderr))
  await writeFile(join(output, "checks.json"), JSON.stringify(checks, null, 2))
  console.error(`Reference evidence: ${output}`)
}
