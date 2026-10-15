// Isolated installed Grok evidence; no Apexo runtime depends on this process.
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { createServer } from "node:http"
import net from "node:net"
import { mkdir, mkdtemp, writeFile, readFile, realpath } from "node:fs/promises"
import { tmpdir, homedir } from "node:os"
import { join, resolve } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const directory = await mkdtemp(join(tmpdir(), "apexo-lsp-official-"))
const home = join(directory, "home")
const workspace = join(directory, "workspace")
const operations = ["hover"]
const binary = await realpath(process.env.GROK_BINARY ?? Bun.which("grok") ?? join(homedir(), ".grok/bin/grok"))
const lspEvents = []
const sockets = new Set()
const lsp = net.createServer((socket) => {
  sockets.add(socket)
  socket.on("close", () => sockets.delete(socket))
  let buffer = Buffer.alloc(0)
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const split = buffer.indexOf("\r\n\r\n")
      if (split < 0) return
      const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, split).toString())?.[1])
      if (buffer.length < split + 4 + length) return
      const message = JSON.parse(buffer.subarray(split + 4, split + 4 + length).toString())
      buffer = buffer.subarray(split + 4 + length)
      lspEvents.push(message)
      if (message.id === undefined) continue
      const result =
        message.method === "initialize"
          ? { capabilities: { hoverProvider: true, textDocumentSync: 1 } }
          : message.method === "textDocument/hover"
            ? { contents: { kind: "plaintext", value: "PLUGIN_SOCKET_HOVER add" } }
            : message.method === "textDocument/diagnostic"
              ? { kind: "full", items: [] }
              : null
      const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }))
      socket.write(`Content-Length: ${body.length}\r\n\r\n`)
      socket.write(body)
    }
  })
})
await new Promise((resolve) => lsp.listen(0, "127.0.0.1", resolve))
const state = { operation: undefined }
const sourceText =
  "struct Shape { virtual int area() = 0; };\nstruct Square : Shape { int area() override { return 4; } };\nint add(int a, int b) { return a+b; }\nint main() { return add(1,2); }\n"
await mkdir(home)
await mkdir(workspace)
const calls = []
const events = []
const logs = []
const checks = []
const provider = createServer(async (request, response) => {
  if (request.method !== "POST") return response.end(JSON.stringify({ data: [{ id: "fixture", object: "model" }] }))
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push(body)
  if (request.url.endsWith("/responses")) {
    const item = {
      type: "function_call",
      id: "fc_reference_title",
      call_id: "call_reference_title",
      name: "session_title",
      arguments: JSON.stringify({ session_title: "Preserve the apricot decision" }),
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
        { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, arguments: "", status: "in_progress" },
        },
        { type: "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: item.arguments },
        { type: "response.function_call_arguments.done", output_index: 0, item_id: item.id, arguments: item.arguments },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: result },
      ]
        .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
        .join(""),
    )
  }
  const names = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
  const results = (body.messages ?? [])
    .slice((body.messages ?? []).findLastIndex((message) => message.role === "user"))
    .filter((message) => message.role === "tool")
  const operation = state.operation
  const line = operation === "goToImplementation" ? 0 : 3
  const name = results.length ? undefined : names.find((name) => name.toLowerCase() === "lsp")
  assert.ok(results.length || name, `Reference advertises LSP: ${names.join(", ")}`)
  const args = {
    operation,
    file_path: join(workspace, "example.cpp"),
    line,
    character: sourceText.split("\n")[line].indexOf(operation === "goToImplementation" ? "area" : "add"),
    query: "add",
  }
  const delta = name
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `call_lsp_${operation}`,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      }
    : { role: "assistant", content: "LSP reference completed" }
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      {
        choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
    ]
      .map(
        (event) =>
          `data: ${JSON.stringify({ id: "mcp-reference", object: "chat.completion.chunk", created: 1, model: body.model, ...event })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
  )
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
const url = `http://127.0.0.1:${provider.address().port}/v1`
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "MCP fixture"\nbase_url = "${url}"\napi_key = "fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = false\n[memory_v2]\nenabled = false\n`,
)
const plugin = join(directory, "plugin")
await mkdir(plugin)
await mkdir(join(workspace, "nested"))
await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "lsp-reference", version: "1.0.0" }))
await writeFile(
  join(plugin, ".lsp.json"),
  JSON.stringify({
    cpp: {
      command: `127.0.0.1:${lsp.address().port}`,
      transport: "socket",
      extensionToLanguage: { ".cpp": "cpp" },
      workspaceFolder: join(workspace, "nested"),
      workspaceOpen: { solution: "App.sln", projects: ["One.csproj", "Two.csproj"] },
    },
  }),
)
await writeFile(join(workspace, "example.cpp"), sourceText)
const profile = join(directory, "isolation.sb")
await writeFile(
  profile,
  `(version 1)\n(allow default)\n(deny network*)\n(allow network-outbound (remote ip "localhost:${provider.address().port}") (remote ip "localhost:${lsp.address().port}"))\n(allow network-bind (local unix-socket (subpath ${JSON.stringify(directory)})))\n(allow network-inbound (local unix-socket (subpath ${JSON.stringify(directory)})))\n(allow network-outbound (remote unix-socket (subpath ${JSON.stringify(directory)})))\n(deny file-read* file-write* (subpath ${JSON.stringify(homedir())}))\n(allow file-read* (literal ${JSON.stringify(binary)}))\n`,
)
const env = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: home,
  GROK_HOME: home,
  TMPDIR: directory,
  LANG: "en_US.UTF-8",
  TERM: "dumb",
  GROK_CONFIG: "",
  GROK_CONFIG_PATH: "",
  XAI_API_KEY: "fixture",
  GROK_LSP_TOOLS: "1",
  GROK_TITLE_REFRESH: "0",
  GROK_TURN_SUMMARY: "0",
  GROK_MANAGED_MCPS_ENABLED: "0",
  GROK_TELEMETRY_ENABLED: "0",
  GROK_TELEMETRY_TRACE_UPLOAD: "0",
  GROK_TELEMETRY_MIXPANEL_ENABLED: "0",
  GROK_MEMORY: "0",
  GROK_XAI_API_BASE_URL: url,
  GROK_MODELS_LIST_URL: `${url}/models`,
  GROK_CLI_CHAT_PROXY_BASE_URL: url,
  GROK_CONVERSATIONS_BASE_URL: url.replace(/\/v1$/, ""),
  GROK_SKILLS_BASE_URL: url.replace(/\/v1$/, ""),
}
for (const kind of ["CONFIG", "DATA", "STATE", "CACHE", "RUNTIME"]) {
  const dir = join(home, `xdg-${kind.toLowerCase()}`)
  await mkdir(dir)
  env[kind === "RUNTIME" ? "XDG_RUNTIME_DIR" : `XDG_${kind}_HOME`] = dir
}
for (const vendor of ["CURSOR", "CLAUDE", "CODEX"])
  for (const surface of ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"]) env[`GROK_${vendor}_${surface}_ENABLED`] = "0"
const installed = execFileSync(
  "/usr/bin/sandbox-exec",
  ["-f", profile, binary, "plugin", "install", plugin, "--trust"],
  { cwd: workspace, env, encoding: "utf8", timeout: 30000 },
)
await writeFile(join(directory, "plugin-install.txt"), installed)
const child = spawn(
  "/usr/bin/sandbox-exec",
  ["-f", profile, binary, "agent", "stdio", "--leader-socket", join(directory, "leader.sock")],
  { cwd: workspace, env, stdio: ["pipe", "pipe", "pipe"], detached: true },
)
const exited = new Promise((resolve) => child.once("exit", resolve))
child.stderr.on("data", (chunk) => logs.push(chunk.toString()))
const connection = new ClientSideConnection(
  () => ({
    async requestPermission(params) {
      const option = params.options.find((item) => item.kind === "allow_once")
      return { outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" } }
    },
    async sessionUpdate(params) {
      events.push(params)
    },
    async extNotification(method, params) {
      events.push({ method, params })
    },
  }),
  ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
)
try {
  await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30_000,
    "reference initialize",
  )
  assert.equal(calls.length, 0)
  const session = await deadline(
    connection.newSession({ cwd: workspace, mcpServers: [] }),
    30000,
    "reference LSP session",
  )
  for (const operation of operations) {
    state.operation = operation
    const before = calls.length
    await deadline(
      connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: `LSP_REFERENCE_${operation}` }],
      }),
      60000,
      `reference ${operation}`,
    )
    const outputs = calls
      .slice(before)
      .flatMap((body) =>
        (body.messages ?? []).filter(
          (message) => message.role === "tool" && message.tool_call_id === `call_lsp_${operation}`,
        ),
      )
    assert.ok(outputs.length, `${operation} returns a tool result`)
    assert.ok(
      outputs.some(
        (message) =>
          JSON.stringify(message).includes("example.cpp") ||
          JSON.stringify(message).includes("add") ||
          JSON.stringify(message).includes("area"),
      ),
      JSON.stringify(outputs),
    )
    checks.push(operation)
  }
  const init = lspEvents.find((event) => event.method === "initialize")
  assert.equal(init.params.rootUri, new URL(`file://${join(workspace, "nested")}`).href)
  assert.equal(init.params.workspaceFolders[0].uri, init.params.rootUri)
  assert.deepEqual(lspEvents.find((event) => event.method === "solution/open").params, {
    solution: `${init.params.rootUri}/App.sln`,
  })
  assert.deepEqual(lspEvents.find((event) => event.method === "project/open").params, {
    projects: [`${init.params.rootUri}/One.csproj`, `${init.params.rootUri}/Two.csproj`],
  })
  checks.push("socket-transport", "workspace-root", "solution-open", "project-open")
  console.log(
    JSON.stringify({ kind: "official-installed", passed: checks.length, checks, providerCalls: calls.length }),
  )
} finally {
  process.kill(-child.pid, "SIGTERM")
  await deadline(exited, 10_000, "reference exit").catch(() => child.kill("SIGKILL"))
  for (const socket of sockets) socket.destroy()
  await new Promise((resolve) => lsp.close(resolve))
  await writeFile(join(directory, "lsp-events.json"), JSON.stringify(lspEvents, null, 2))
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(directory, "stderr.log"), logs.join(""))
  await writeFile(join(directory, "requests.json"), JSON.stringify(calls))
  await writeFile(join(directory, "events.json"), JSON.stringify(events))
  console.error(`LSP reference evidence: ${directory}`)
}
