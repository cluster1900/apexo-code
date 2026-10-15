// Installed-runtime comparison only. Never imported by native product execution.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

assert.equal(process.platform, "darwin", "This comparison requires the macOS sandbox egress guard")
const binary = await realpath(process.env.GROK_BIN ?? "/Users/hawk_wu/.grok/bin/grok")
const output = await realpath(await mkdtemp(join(tmpdir(), "apexo-headless-official-")))
const observations = []
const requests = []
const state = { current: undefined }
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg=="
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
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
const poll = async (read, label, ms = 15000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const value = await read()
    if (value) return value
    await delay(20)
  }
  throw new Error(`${label} exceeded ${ms}ms`)
}
const provider = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString()
  const body = raw ? JSON.parse(raw) : undefined
  const current = state.current
  const tools = (body?.tools ?? []).map((value) => value.function ?? value)
  const title = tools.some((tool) => tool.name === "session_title")
  const conversation = request.method === "POST" && !title && tools.length > 0
  const record = {
    scenario: current?.name ?? "preflight",
    method: request.method,
    host: request.headers.host,
    path: request.url,
    conversation,
    title,
    body,
  }
  requests.push(record)
  current?.requests.push(record)
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
  if (conversation) current.arrived = true
  if (conversation && current.kind === "held-provider") return
  if (title) {
    assert.equal(request.url, "/v1/responses")
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
  const tool =
    conversation && current.kind === "tool" && !current.sent
      ? tools.find((value) => current.aliases.includes(value.name))
      : undefined
  if (tool) current.sent = true
  if (conversation && current.kind === "tool" && !current.sent) current.missingTool = current.aliases
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "owned_call",
            type: "function",
            function: { name: tool.name, arguments: JSON.stringify(current.args) },
          },
        ],
      }
    : { role: "assistant", content: conversation ? "OFFICIAL_HEADLESS_DONE" : "Fixture title" }
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
    `[models]\ndefault="fixture"\n[model.fixture]\nmodel="fixture"\nname="Headless comparison"\nbase_url="${url}/v1"\napi_key="local-fixture-key"\napi_backend="chat_completions"\ncontext_window=100000\n[memory]\nenabled=false\n[cli]\nuse_leader=false\n`,
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
const pidIdentity = async (pid) => {
  const child = spawn("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin" },
  })
  const chunks = []
  child.stdout.on("data", (chunk) => chunks.push(chunk))
  await new Promise((done) => child.once("close", done))
  return Buffer.concat(chunks).toString().trim()
}
const currentUser = (body) => body.messages?.findLast((item) => item.role === "user")
const run = async (spec) => {
  const fixture = await isolated(spec.name)
  const current = { ...spec, requests: [], sent: false, arrived: false, owned: [] }
  state.current = current
  const text = "HEADLESS_REFERENCE current input"
  const args = ["--leader-socket", join(fixture.base, "leader.sock"), "--no-auto-update", ...(spec.flags ?? [])]
  if (spec.promptFile) {
    const file = join(fixture.cwd, "prompt.txt")
    await writeFile(file, "FILE_TEXT_BYTES 世界\n")
    args.push("--prompt-file", file)
  } else if (spec.blocks) args.push("--prompt-json", JSON.stringify(spec.blocks))
  else args.push("--print", text)
  if (spec.format) args.push("--output-format", spec.format)
  const running = launch(fixture, args)
  try {
    if (spec.signal) {
      if (spec.heldCommand) {
        const pids = await poll(async () => {
          const raw = await readFile(join(fixture.cwd, "owned-shell.pid"), "utf8").catch(() => "")
          const values = raw.trim().split(/\s+/).map(Number)
          return values.length === 2 && values.every((pid) => Number.isSafeInteger(pid) && pid > 1) ? values : undefined
        }, "owned shell and sleep PID admission")
        for (const pid of pids) {
          const identity = await pidIdentity(pid)
          assert.ok(identity)
          current.owned.push({ pid, identity })
        }
      } else await poll(() => current.arrived, "actual conversation provider arrival")
      running.child.kill(spec.signal)
    }
    current.exit = await bounded(running.exit, 30000, spec.name)
    current.stdout = running.data.stdout
    current.stderr = running.data.stderr
    assert.equal(current.missingTool, undefined, "requested official tool must be advertised")
    const conversations = current.requests.filter((request) => request.conversation)
    current.conversationRequests = conversations.length
    current.auxiliaryRequests = current.requests.length - conversations.length
    current.toolResults = conversations
      .flatMap((request) => request.body.messages ?? [])
      .filter((message) => message.role === "tool")
      .map((message) => ({ id: message.tool_call_id, content: message.content }))
    current.marker = await readFile(join(fixture.cwd, "effect.txt"), "utf8").catch(() => undefined)
    if (spec.signal) {
      assert.equal(current.exit.code, spec.signal === "SIGINT" ? 130 : 143)
      current.joined = true
      for (const owned of current.owned) {
        owned.afterExit = await pidIdentity(owned.pid)
        if (owned.afterExit === owned.identity) current.joined = false
      }
      current.lateOutput = await readFile(join(fixture.cwd, "late.txt"), "utf8").catch(() => undefined)
      assert.equal(current.lateOutput, undefined)
    } else {
      assert.equal(current.exit.code, 0, current.stderr)
      if (!spec.kind && (spec.format === undefined || spec.format === "plain"))
        assert.equal(current.stdout.trim(), "OFFICIAL_HEADLESS_DONE")
      if (spec.format === "json") {
        current.result = JSON.parse(current.stdout)
        if (!spec.kind) assert.equal(current.result.text, "OFFICIAL_HEADLESS_DONE")
      }
      if (spec.format?.startsWith("streaming")) {
        current.events = current.stdout.trim().split("\n").map(JSON.parse)
        assert.ok(current.events.length > 0)
        if (spec.format === "streaming-json") {
          assert.equal(
            current.events
              .filter((event) => event.type === "text")
              .map((event) => event.data)
              .join(""),
            "OFFICIAL_HEADLESS_DONE",
          )
          assert.equal(current.events.find((event) => event.type === "end").stopReason, "end_turn")
        }
        if (spec.format === "streaming-messages-json") {
          const text = current.events
            .filter((event) => event.type === "assistant")
            .flatMap((event) => event.message.content)
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("")
          assert.equal(text, "OFFICIAL_HEADLESS_DONE")
          assert.equal(current.events.find((event) => event.type === "result").is_error, false)
        }
      }
      if (spec.effect !== undefined) assert.equal(current.marker, spec.effect ? "OWNED_EFFECT" : undefined)
      if (spec.promptFile)
        assert.ok(JSON.stringify(currentUser(conversations[0].body)).includes("FILE_TEXT_BYTES 世界"))
      if (spec.attachment === "text")
        assert.ok(JSON.stringify(currentUser(conversations[0].body)).includes("EMBEDDED_TEXT_BYTES 世界"))
      if (spec.attachment === "image") {
        const content = currentUser(conversations[0].body).content
        assert.ok(Array.isArray(content))
        assert.ok(
          content.some(
            (part) => part.type === "image_url" && /^data:image\/(png|jpeg);base64,/.test(part.image_url.url),
          ),
        )
      }
    }
    observations.push(current)
    console.log(
      JSON.stringify({
        name: current.name,
        exit: current.exit,
        conversationRequests: current.conversationRequests,
        auxiliaryRequests: current.auxiliaryRequests,
        marker: current.marker,
        joined: current.joined,
      }),
    )
  } finally {
    current.stdout = running.data.stdout
    current.stderr = running.data.stderr
    try {
      for (const owned of current.owned) {
        if ((await pidIdentity(owned.pid)) !== owned.identity) continue
        current.harnessCleanup = true
        process.kill(owned.pid, "SIGKILL")
        await poll(async () => (await pidIdentity(owned.pid)) !== owned.identity, "owned PID cleanup", 5000)
      }
    } finally {
      try {
        await close(running)
      } finally {
        state.current = undefined
        await writeFile(join(fixture.base, "evidence.json"), JSON.stringify(current, null, 2))
      }
    }
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
    for (const format of [undefined, "plain", "json", "streaming-json", "streaming-messages-json"]) {
      if (format && !help.data.stdout.includes(format)) {
        observations.push({ name: format, unsupported: "not advertised by installed help" })
        continue
      }
      await run({ name: format ?? "default", format })
    }
    await run({ name: "prompt-file", format: "json", promptFile: true })
    await run({
      name: "text-resource",
      format: "json",
      attachment: "text",
      blocks: [
        { type: "text", text: "Read user-supplied evidence" },
        {
          type: "resource",
          resource: { uri: "file:///owned.txt", mimeType: "text/plain", text: "EMBEDDED_TEXT_BYTES 世界" },
        },
      ],
    })
    await run({
      name: "image",
      format: "json",
      attachment: "image",
      blocks: [
        { type: "text", text: "Describe user-supplied image" },
        { type: "image", mimeType: "image/png", data: PNG },
      ],
    })
    const tool = {
      kind: "tool",
      aliases: ["run_terminal_command", "run_terminal_cmd"],
      args: { command: "printf OWNED_EFFECT > effect.txt", description: "Owned permission evidence" },
      format: "json",
    }
    await run({ ...tool, name: "ask", effect: false })
    await run({ ...tool, name: "auto", flags: ["--always-approve"], effect: true })
    await run({ ...tool, name: "deny-auto", flags: ["--always-approve", "--deny", "Bash"], effect: false })
    await run({
      name: "question",
      kind: "tool",
      format: "json",
      aliases: ["ask_user_question"],
      args: {
        questions: [
          {
            question: "Choose an option?",
            options: [
              { label: "One", description: "First" },
              { label: "Two", description: "Second" },
            ],
          },
        ],
      },
    })
    for (const signal of ["SIGINT", "SIGTERM"]) {
      await run({ name: `provider-${signal}`, kind: "held-provider", signal, format: "streaming-json" })
      await run({
        ...tool,
        name: `shell-${signal}`,
        signal,
        heldCommand: true,
        flags: ["--always-approve"],
        args: {
          command:
            'printf \'%s\\n\' "$$" > owned-shell.pid; sleep 30 & sleeper=$!; printf \'%s\\n\' "$sleeper" >> owned-shell.pid; wait "$sleeper"; printf LATE > late.txt',
          description: "Owned cancellation evidence",
        },
      })
    }
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
      ownedCommandScenarios: observations.filter((value) => value.heldCommand).length,
      ownedCommandsJoinedByReference: observations.some((value) => value.heldCommand)
        ? observations.filter((value) => value.heldCommand).every((value) => value.joined)
        : null,
      output,
    }),
  )
  console.error(`Installed headless comparison evidence: ${output}`)
}
