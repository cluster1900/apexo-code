// Installed-runtime comparison only. Never imported by native product execution.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

assert.equal(process.platform, "darwin", "This comparison requires the macOS sandbox egress guard")
const binary = await realpath(process.env.GROK_BIN ?? "/Users/hawk_wu/.grok/bin/grok")
const output = await realpath(await mkdtemp(join(tmpdir(), "apexo-subagent-hooks-official-")))
const observations = []
const requests = []
const state = { current: undefined }
const bounded = async (promise, ms, label) => {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
const handleRequest = async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString()
  const body = raw ? JSON.parse(raw) : undefined
  const current = state.current
  const tools = (body?.tools ?? []).map((value) => value.function ?? value)
  const title = tools.some((tool) => tool.name === "session_title")
  const dashboard = (body?.messages ?? []).some(
    (message) =>
      message.role === "system" &&
      (typeof message.content === "string"
        ? message.content
        : (message.content ?? []).map((part) => part.text ?? "").join("\n")
      ).includes("ultra-short dashboard line"),
  )
  const conversation =
    request.method === "POST" &&
    request.url === "/v1/chat/completions" &&
    !title &&
    !dashboard &&
    tools.some((tool) => tool.name === "read_file")
  const record = {
    scenario: current?.name ?? "preflight",
    method: request.method,
    host: request.headers.host,
    path: request.url,
    conversation,
    title,
    dashboard,
    body,
  }
  requests.push(record)
  current?.requests.push(record)
  if (request.method === "POST") assert.ok(title || dashboard || conversation, "Unclassified provider POST")
  if (request.method !== "POST") {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({ object: "list", data: [{ id: "fixture", object: "model", created: 1, owned_by: "fixture" }] }),
    )
    return
  }
  if (!current) {
    response.writeHead(503)
    response.end()
    return
  }
  if (title && request.url === "/v1/responses") {
    const item = {
      type: "function_call",
      id: "fc_title",
      call_id: "call_title",
      name: "session_title",
      arguments: JSON.stringify({ session_title: "Headless comparison" }),
      status: "completed",
    }
    const result = {
      id: "resp_title",
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
      tools: body.tools,
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
    response.end(
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
    return
  }
  const user = body.messages?.findLast((message) => message.role === "user")
  const userText = typeof user?.content === "string" ? user.content : JSON.stringify(user?.content)
  const text = userText?.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/)?.[1] ?? userText ?? ""
  let tool = title ? { name: "session_title", args: { session_title: "Task child comparison" } } : undefined
  let content = "Fixture dashboard"
  if (conversation) {
    current.catalogs.push({ text, tools: tools.map((value) => value.name) })
    content = "ROOT_DONE"
    if (text.startsWith("TASK_ROOT") && !current.rootSent) {
      current.rootSent = true
      tool = tools.find((value) => ["task", "spawn_subagent"].includes(value.name))
      assert.ok(tool)
      tool = { ...tool, args: { description: "Owned child probe", prompt: "TASK_NESTED_CHILD", background: false } }
    } else if (
      body.messages?.some(
        (message) => message.role === "user" && JSON.stringify(message.content).includes("TASK_NESTED_CHILD"),
      )
    ) {
      current.childCalls = (current.childCalls ?? 0) + 1
      if (current.childCalls > 1)
        assert.ok(
          body.messages.some(
            (message) => message.role === "user" && JSON.stringify(message.content).includes("HOOK_VERIFY"),
          ),
        )
      content = "CHILD_DONE"
    }
  }
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "owned_call",
            type: "function",
            function: { name: tool.name, arguments: JSON.stringify(tool.args) },
          },
        ],
      }
    : { role: "assistant", content }
  const chunk = (delta, finish_reason) => ({
    id: "fixture",
    object: "chat.completion.chunk",
    created: 1,
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason }],
  })
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`)
  response.end(
    `data: ${JSON.stringify({ ...chunk({}, tool ? "tool_calls" : "stop"), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
  )
}
const provider = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    if (state.current) state.current.failures.push({ message: error.message, stack: error.stack })
    response.writeHead(500, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: { message: "Owned comparison fixture failed" } }))
  })
})
await new Promise((done) => provider.listen(0, "127.0.0.1", done))
const url = `http://127.0.0.1:${provider.address().port}`
const profile = join(output, "isolation.sb")
await writeFile(
  profile,
  `(version 1)\n(allow default)\n(deny network*)\n(allow network-outbound (remote ip "localhost:${provider.address().port}"))\n(allow network-bind (local unix-socket (subpath ${JSON.stringify(output)})))\n(allow network-inbound (local unix-socket (subpath ${JSON.stringify(output)})))\n(allow network-outbound (remote unix-socket (subpath ${JSON.stringify(output)})))\n(deny file-read* file-write* (subpath ${JSON.stringify(homedir())}))\n(allow file-read* (literal ${JSON.stringify(binary)}))\n`,
)
const isolated = async (name) => {
  const base = join(output, name),
    home = join(base, "home"),
    cwd = join(base, "workspace")
  await mkdir(home, { recursive: true })
  await mkdir(cwd)
  await mkdir(join(base, "tmp"))
  const env = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: home,
    GROK_HOME: home,
    TMPDIR: join(base, "tmp"),
    LANG: "en_US.UTF-8",
    TERM: "dumb",
    XAI_API_KEY: "local-fixture-key",
    GROK_CONFIG: "",
    GROK_CONFIG_PATH: "",
    GROK_MEMORY: "0",
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
  await writeFile(
    join(home, "config.toml"),
    `[models]\ndefault="fixture"\n[model.fixture]\nmodel="fixture"\nname="Headless comparison"\nbase_url="${url}/v1"\napi_key="local-fixture-key"\napi_backend="chat_completions"\ncontext_window=100000\n[subagents]\nmax_depth=${state.current?.depth ?? 1}\n[features]\nactive_agent_messages=${Boolean(state.current?.active)}\n[memory]\nenabled=false\n[cli]\nuse_leader=false\n`,
  )
  await mkdir(join(home, "hooks"))
  await writeFile(
    join(home, "hook.py"),
    `import json,sys
value=json.load(sys.stdin)
with open(sys.argv[1], 'a') as out: out.write(json.dumps(value)+'\\n')
if value['hook_event_name'] in ['SubagentStop','subagent_stop']:
 print(json.dumps({'continue':False} if value.get('stop_hook_active',value.get('stopHookActive',False)) else {'decision':'block','reason':'HOOK_VERIFY'}))
`,
  )
  const group = {
    hooks: [
      {
        type: "command",
        command: `/usr/bin/python3 '${join(home, "hook.py")}' '${join(home, "trace.jsonl")}'`,
        timeout: 5,
      },
    ],
  }
  await writeFile(
    join(home, "hooks/subagent.json"),
    JSON.stringify({ hooks: { SubagentStart: [group], [state.current?.alias ?? "SubagentStop"]: [group] } }),
  )
  return { base, home, cwd, env }
}
const launch = (fixture, args, executable = binary) => {
  const child = spawn("/usr/bin/sandbox-exec", ["-f", profile, executable, ...args], {
    cwd: fixture.cwd,
    env: fixture.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const data = { stdout: "", stderr: "" }
  child.stdout.on("data", (chunk) => (data.stdout += chunk))
  child.stderr.on("data", (chunk) => (data.stderr += chunk))
  const exit = new Promise((done, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => done({ code, signal }))
  })
  return { child, data, exit }
}
const close = async (running) => {
  if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill("SIGTERM")
  const killGroup = () => {
    try {
      process.kill(-running.child.pid, "SIGKILL")
    } catch (error) {
      if (error.code !== "ESRCH") throw error
    }
  }
  try {
    await bounded(running.exit, 5000, "owned process shutdown").catch(async () => {
      killGroup()
      running.child.kill("SIGKILL")
      await bounded(running.exit, 5000, "owned process forced shutdown")
    })
  } finally {
    killGroup()
  }
}
const run = async (spec) => {
  const current = { ...spec, requests: [], catalogs: [], failures: [], grandchildren: 0 }
  state.current = current
  const fixture = await isolated(spec.name)
  const running = launch(fixture, [
    "--leader-socket",
    join(fixture.base, "leader.sock"),
    "--no-auto-update",
    "--always-approve",
    "--print",
    "TASK_ROOT controlled advanced task probe",
    "--output-format",
    "json",
  ])
  try {
    current.exit = await bounded(running.exit, 30000, spec.name)
    current.stdout = running.data.stdout
    current.stderr = running.data.stderr
    assert.equal(current.failures.length, 0, JSON.stringify(current.failures))
    assert.equal(current.exit.code, 0, current.stderr)
    current.result = JSON.parse(current.stdout)
    assert.ok(current.result.text.endsWith("ROOT_DONE"))
    const parentReply = current.requests
      .filter((request) => request.conversation)
      .findLast((request) =>
        request.body.messages?.some(
          (message) => message.role === "tool" && String(message.content).includes("CHILD_DONE"),
        ),
      )
    assert.ok(parentReply, "parent receives completed child output")
    assert.equal(current.childCalls, 2)
    current.hooks = (await readFile(join(fixture.home, "trace.jsonl"), "utf8")).trim().split("\n").map(JSON.parse)
    assert.equal(current.hooks.filter((hook) => hook.hook_event_name === "SubagentStart").length, 1)
    assert.equal(current.hooks.filter((hook) => hook.hook_event_name === "SubagentStop").length, 2)
    const root = current.catalogs.find((entry) => entry.text.startsWith("TASK_ROOT"))
    current.activeMessageTool = root.tools.includes("send_subagent_message")
    assert.equal(current.activeMessageTool, Boolean(spec.active))
    observations.push(current)
    console.log(
      JSON.stringify({
        name: spec.name,
        childCalls: current.childCalls,
        hookEvents: current.hooks.map((hook) => hook.hook_event_name),
        activeMessageTool: current.activeMessageTool,
        exit: current.exit,
        conversations: current.requests.filter((request) => request.conversation).length,
      }),
    )
  } finally {
    await close(running)
    current.stdout = running.data.stdout
    current.stderr = running.data.stderr
    state.current = undefined
    await writeFile(join(fixture.base, "evidence.json"), JSON.stringify(current, null, 2))
  }
}
try {
  const preflight = await isolated("help")
  const version = launch(preflight, ["--version"])
  try {
    assert.equal((await bounded(version.exit, 10000, "version")).code, 0, version.data.stderr)
    assert.match(version.data.stdout, /1\.0\.52/)
  } finally {
    await close(version)
  }
  const help = launch(preflight, ["--help"])
  try {
    assert.equal((await bounded(help.exit, 10000, "help")).code, 0, help.data.stderr)
  } finally {
    await close(help)
  }
  await writeFile(join(output, "version.txt"), version.data.stdout)
  await writeFile(join(output, "help.txt"), help.data.stdout)
  for (const flag of ["--prompt-file", "--prompt-json", "--output-format", "--always-approve", "--deny"])
    assert.ok(help.data.stdout.includes(flag), `Installed help missing ${flag}`)
  const denied = launch(preflight, [join(homedir(), "Desktop/apexo-grok/AGENTS.md")], "/bin/cat")
  try {
    assert.notEqual((await bounded(denied.exit, 5000, "host-home read guard")).code, 0)
    assert.equal(denied.data.stdout, "")
    assert.ok(denied.data.stderr.includes("Operation not permitted"), denied.data.stderr)
  } finally {
    await close(denied)
  }
  const allowed = launch(
    preflight,
    ["--silent", "--show-error", "--max-time", "3", `${url}/v1/models`],
    "/usr/bin/curl",
  )
  try {
    assert.equal((await bounded(allowed.exit, 5000, "local provider guard")).code, 0, allowed.data.stderr)
    assert.equal(JSON.parse(allowed.data.stdout).data[0].id, "fixture")
  } finally {
    await close(allowed)
  }
  let blockedRequests = 0
  const blocked = createServer((_, response) => {
    blockedRequests++
    response.end("unexpected")
  })
  await new Promise((done) => blocked.listen(0, "127.0.0.1", done))
  try {
    const attempt = launch(
      preflight,
      ["--silent", "--show-error", "--max-time", "3", `http://127.0.0.1:${blocked.address().port}`],
      "/usr/bin/curl",
    )
    try {
      assert.notEqual((await bounded(attempt.exit, 5000, "other port denial")).code, 0)
      assert.equal(blockedRequests, 0)
    } finally {
      await close(attempt)
    }
  } finally {
    blocked.closeAllConnections()
    await new Promise((done) => blocked.close(done))
  }
  observations.push({
    name: "isolation",
    hostHomeReadDenied: true,
    localProviderAllowed: true,
    otherOwnedPortDenied: true,
  })
  if (process.argv.includes("--inspect")) console.log(JSON.stringify({ version: version.data.stdout.trim(), output }))
  else {
    await run({ name: "canonical-stop", depth: 1, alias: "SubagentStop" })
    await run({ name: "end-alias", depth: 1, alias: "SubagentEnd" })
  }
} finally {
  provider.closeAllConnections()
  await new Promise((done) => provider.close(done))
  await writeFile(join(output, "summary.json"), JSON.stringify({ binary, observations, requests }, null, 2))
  console.log(
    JSON.stringify({
      completedScenarios: observations.filter((value) => value.name !== "isolation").length,
      conversationRequests: requests.filter((value) => value.conversation).length,
      auxiliaryRequests: requests.filter((value) => !value.conversation).length,
      output,
    }),
  )
  console.error(`Installed Subagent Hooks comparison evidence: ${output}`)
}
