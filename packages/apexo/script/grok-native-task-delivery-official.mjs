// Installed-runtime comparison only. Never imported by native product execution.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

assert.equal(process.platform, "darwin", "This comparison requires the macOS sandbox egress guard")
const binary = await realpath(process.env.GROK_BIN ?? "/Users/hawk_wu/.grok/bin/grok")
const output = await realpath(await mkdtemp(join(tmpdir(), "apexo-task-delivery-official-")))
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
// Only actual user-role content proves delivery. Tool arguments/history are never delivery evidence.
const textContent = (value) =>
  typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => part.text ?? "").join("\n") : ""
const users = (body) =>
  (body.messages ?? []).filter((message) => message.role === "user").map((message) => textContent(message.content))
const toolReplies = (body) => (body.messages ?? []).filter((message) => message.role === "tool")
const latestReply = (body) => textContent(toolReplies(body).at(-1)?.content)
const barrier = () => {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}
const call = (current, tools, name, args) => {
  const selected = tools.find((tool) => tool.name === name)
  assert.ok(selected, `Installed catalog has no ${name}`)
  const properties = selected.parameters?.properties ?? {}
  for (const key of Object.keys(args)) assert.ok(key in properties, `${name} does not advertise ${key}`)
  for (const key of selected.parameters?.required ?? []) assert.ok(key in args, `${name} requires ${key}`)
  current.authored.push({ name, args })
  return { tool: { name, args } }
}
const childID = (body) => {
  // The ID must come from the spawn tool's actual returned content, never injected arguments.
  const reply = toolReplies(body).find((message) => /subagent_id\s*[:=]/.test(textContent(message.content)))
  const id = textContent(reply?.content).match(/subagent_id\s*[:=]\s*["']?([0-9a-f-]{36})/i)?.[1]
  assert.ok(id, `Spawn reply lacks actual subagent_id: ${textContent(reply?.content)}`)
  return id
}
const accepted = (current, body) => {
  const reply = latestReply(body)
  assert.match(reply, /Message accepted|"outcome"\s*:\s*"accepted"/i)
  current.admissions.push(reply)
}
const marker = (kind) => `DELIVERY_${kind}_OWNED`
const send = (current, tools, delivery, text = marker(delivery.toUpperCase()), target = current.childID) =>
  call(current, tools, "send_subagent_message", { subagent_id: target, text, delivery })
const wait = (current, tools, id = current.childID) =>
  call(current, tools, "get_command_or_subagent_output", { task_ids: [id], timeout_ms: 15000 })
const decide = async (current, body, tools) => {
  const input = users(body)
  const role = input.some((text) => text.includes("ACTIVE_GRANDCHILD_OWNED"))
    ? "grandchild"
    : input.some((text) => text.includes("ACTIVE_CHILD_OWNED"))
      ? "child"
      : "root"
  current.catalogs.push({ role, tools })
  current.turns.push({ role, users: input, toolReplies: toolReplies(body) })
  if (role === "grandchild") {
    current.grandchildArrived.release()
    await bounded(current.releaseGrandchild.promise, 20000, "owned grandchild release")
    return { content: "GRANDCHILD_FINISHED_OWNED" }
  }
  if (role === "child") {
    current.childTurns++
    current.childArrived.release()
    const delivered = input.filter((text) => text.includes("DELIVERY_"))
    current.deliveries.push({ turn: current.childTurns, users: delivered })
    if (current.kind === "wait-interject") {
      if (current.childTurns === 1)
        return call(current, tools, "spawn_subagent", {
          prompt: "ACTIVE_GRANDCHILD_OWNED wait for the owned provider response",
          description: "Owned wait target",
          background: true,
        })
      if (current.childTurns === 2) {
        current.grandchildID = childID(body)
        await bounded(current.grandchildArrived.promise, 15000, "actual grandchild provider arrival")
        current.waitAuthored.release()
        return wait(current, tools, current.grandchildID)
      }
      assert.ok(
        delivered.some((text) => text.includes(marker("INTERJECT"))),
        "interject is actual user input",
      )
      current.interruptedWait = latestReply(body)
      assert.match(current.interruptedWait, /interject|interrupt/i, "recognized wait returns interruption evidence")
      current.releaseGrandchild.release()
      return { content: "CHILD_FINISHED_OWNED" }
    }
    if (current.kind === "completed-wake") {
      if (current.childTurns === 1) return { content: "CHILD_INITIAL_FINISHED_OWNED" }
      assert.ok(delivered.some((text) => text.includes(marker("STEER"))))
      return { content: "CHILD_WOKEN_FINISHED_OWNED" }
    }
    if (current.childTurns === 1) {
      await bounded(current.releaseChild.promise, 20000, "owned child provider release")
      return call(current, tools, "read_file", { target_file: "owned.txt" })
    }
    if (current.kind === "queue" && current.childTurns === 2) {
      assert.equal(delivered.length, 0, "queue must not join the current tool continuation")
      current.queueContinuationWithoutDelivery = true
      return { content: "CHILD_FIRST_TURN_FINISHED_OWNED" }
    }
    if (current.kind === "cancel-pending") {
      current.lateChildTurns++
      return { content: "UNEXPECTED_LATE_CHILD_OWNED" }
    }
    if (current.kind === "invalid") assert.equal(delivered.length, 0)
    else {
      assert.ok(delivered.length > 0, "actual child user messages contain delivery")
      const expected =
        current.kind === "priority" ? ["INTERJECT", "STEER"] : [current.kind === "queue" ? "QUEUE" : "STEER"]
      for (const kind of expected)
        assert.equal(
          delivered.join("\n").split(marker(kind)).length - 1,
          1,
          `${kind} occurs exactly once in actual child user content`,
        )
      if (current.kind === "priority") {
        const order = delivered.join("\n")
        assert.ok(order.indexOf(marker("INTERJECT")) < order.indexOf(marker("STEER")), "interject precedes steer")
      }
    }
    return { content: "CHILD_FINISHED_OWNED" }
  }
  const phase = current.rootTurns++
  if (current.kind === "default") {
    assert.equal(
      tools.some((tool) => tool.name === "send_subagent_message"),
      false,
    )
    return { content: "ROOT_FINISHED_OWNED" }
  }
  assert.ok(tools.some((tool) => tool.name === "send_subagent_message"))
  if (phase === 0)
    return call(current, tools, "spawn_subagent", {
      prompt: "ACTIVE_CHILD_OWNED execute the controlled provider plan",
      description: "Owned delivery child",
      background: current.kind !== "completed-wake",
    })
  if (phase === 1) {
    current.childID = childID(body)
    await bounded(current.childArrived.promise, 15000, "actual child provider arrival")
    if (current.kind === "wait-interject") {
      await bounded(current.waitAuthored.promise, 15000, "child provider has authored recognized wait")
      return send(current, tools, "interject")
    }
    if (current.kind === "invalid")
      return send(current, tools, "steer", "OWNED_UNKNOWN_TARGET", "01a06b44-0000-7000-8000-0000deadbeef")
    return send(current, tools, current.kind === "queue" ? "queue" : "steer")
  }
  if (current.kind === "invalid") {
    if (phase === 2) {
      current.unknownReply = latestReply(body)
      assert.match(current.unknownReply, /not found|not owned/i)
      return send(current, tools, "steer", "x".repeat(32769))
    }
    if (phase === 3) {
      current.limitReply = latestReply(body)
      assert.match(current.limitReply, /limit|size|32768|too (large|long)/i)
      current.releaseChild.release()
      return wait(current, tools)
    }
  } else if (current.kind === "priority") {
    if (phase === 2) {
      accepted(current, body)
      return send(current, tools, "interject")
    }
    if (phase === 3) {
      accepted(current, body)
      current.releaseChild.release()
      return wait(current, tools)
    }
  } else if (current.kind === "cancel-pending") {
    if (phase === 2) {
      accepted(current, body)
      return call(current, tools, "kill_command_or_subagent", { task_id: current.childID })
    }
    if (phase === 3) {
      current.cancelReply = latestReply(body)
      current.releaseChild.release()
      return wait(current, tools)
    }
    if (phase === 4) {
      current.cancelStatus = latestReply(body)
      assert.match(current.cancelStatus, /cancel|killed|stopped/i)
      assert.equal(current.lateChildTurns, 0)
    }
  } else if (phase === 2) {
    accepted(current, body)
    current.releaseChild.release()
    return wait(current, tools)
  }
  if (current.kind !== "cancel-pending") {
    current.finalTaskReply = latestReply(body)
    assert.match(current.finalTaskReply, /CHILD_(?:WOKEN_)?FINISHED_OWNED/, "parent observes actual final child output")
  }
  return { content: "ROOT_FINISHED_OWNED" }
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
    (message) => message.role === "system" && textContent(message.content).includes("ultra-short dashboard line"),
  )
  const conversation =
    request.method === "POST" &&
    request.url === "/v1/chat/completions" &&
    !title &&
    !dashboard &&
    tools.some((tool) => tool.name === "read_file")
  if (request.method === "POST") assert.ok(title || dashboard || conversation, "Unclassified provider POST")
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
  let tool = title ? { name: "session_title", args: { session_title: "Task delivery comparison" } } : undefined
  let content = "Fixture dashboard"
  if (conversation) {
    const decision = await decide(current, body, tools)
    tool = decision.tool
    content = decision.content ?? ""
  }
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `owned_call_${current.callSequence++}`,
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
  await writeFile(join(cwd, "owned.txt"), "Owned comparison file.\n")
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
  const current = {
    ...spec,
    requests: [],
    catalogs: [],
    authored: [],
    turns: [],
    deliveries: [],
    admissions: [],
    failures: [],
    childTurns: 0,
    rootTurns: 0,
    lateChildTurns: 0,
    callSequence: 0,
    childArrived: barrier(),
    releaseChild: barrier(),
    grandchildArrived: barrier(),
    releaseGrandchild: barrier(),
    waitAuthored: barrier(),
  }
  state.current = current
  const fixture = await isolated(spec.name)
  const running = launch(fixture, [
    "--leader-socket",
    join(fixture.base, "leader.sock"),
    "--no-auto-update",
    "--always-approve",
    "--print",
    "ACTIVE_ROOT_OWNED controlled direct-child delivery comparison",
    "--output-format",
    "json",
  ])
  try {
    current.exit = await bounded(running.exit, 60000, spec.name)
    assert.equal(current.failures.length, 0, JSON.stringify(current.failures))
    assert.equal(current.exit.code, 0, running.data.stderr)
    const result = JSON.parse(running.data.stdout)
    assert.ok(result.text.endsWith("ROOT_FINISHED_OWNED"), "aggregate text ends with parent completion")
    if (current.kind === "queue") assert.equal(current.queueContinuationWithoutDelivery, true)
    if (current.kind === "cancel-pending") assert.equal(current.lateChildTurns, 0)
    observations.push({
      name: spec.name,
      childTurns: current.childTurns,
      admissions: current.admissions.length,
      exit: current.exit,
    })
    console.log(JSON.stringify(observations.at(-1)))
  } finally {
    current.releaseChild.release()
    current.releaseGrandchild.release()
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
    const scenarios = [
      { name: "default-gate", kind: "default", active: false },
      { name: "active-steer", kind: "steer", active: true },
      { name: "active-queue", kind: "queue", active: true },
      { name: "interject-priority", kind: "priority", active: true },
      { name: "interject-recognized-wait", kind: "wait-interject", active: true, depth: 2 },
      { name: "unknown-target-and-byte-limit", kind: "invalid", active: true },
      { name: "completed-child-wake", kind: "completed-wake", active: true },
      { name: "cancel-pending-delivery", kind: "cancel-pending", active: true },
    ]
    const only = process.argv.find((value) => value.startsWith("--case="))?.slice(7)
    assert.ok(!only || scenarios.some((value) => value.name === only), "Unknown case filter")
    for (const scenario of scenarios.filter((value) => !only || value.name === only)) await run(scenario)
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
  console.error(`Installed active Task delivery comparison evidence: ${output}`)
}
