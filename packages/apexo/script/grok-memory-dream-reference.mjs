// Comparison only: installed Grok owns its own isolated ACP Sessions. No Apexo acceptance claim.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline } from "./grok-shell-fixture.mjs"

assert.equal(process.platform, "darwin", "This comparison requires the macOS sandbox egress guard")
const binary = await realpath(process.env.GROK_BIN ?? "/Users/hawk_wu/.grok/bin/grok")
const output = await realpath(await mkdtemp(join(tmpdir(), "apexo-memory-native-reference-")))
// Installed Memory excludes temporary workspaces; this disposable Git root contains no user data.
const workspace = await realpath(await mkdtemp(join(homedir(), ".memory-native-reference-")))
const checks = []
const calls = []
const requests = []
const providerErrors = []
const controls = []
const domainCalls = () => calls.filter((item) => ["main", "capture", "dream"].includes(item.kind))
const provider = createServer((request, response) => {
  void respond(request, response).catch((error) => {
    providerErrors.push(String(error))
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
})
async function respond(request, response) {
  if (request.method !== "POST") {
    response.end(JSON.stringify({ data: [{ id: "fixture" }] }))
    return
  }
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
    assert.ok(chunks.reduce((size, item) => size + item.length, 0) <= 2 * 1024 * 1024, "Bounded fixture request")
  }
  const body = JSON.parse(Buffer.concat(chunks).toString())
  const messages = body.messages ?? body.input ?? []
  const text = (value) =>
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.flatMap((part) => (typeof part.text === "string" ? [part.text] : [])).join("\n")
        : ""
  const systems = [
    text(body.instructions),
    ...messages.filter((item) => item.role === "system" || item.role === "developer").map((item) => text(item.content)),
  ]
  const names = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
  const current = messages.findLast((item) => item.role === "user")
  const kind = names.includes("session_title")
    ? "title"
    : systems.some((value) => value.startsWith("Extract durable, reusable observations"))
      ? "capture"
      : systems.some((value) => value.startsWith("Consolidate only the supplied claimed observations"))
        ? "dream"
        : systems.some((value) => value.startsWith("Write an ultra-short dashboard line"))
          ? "dashboard"
          : names.length > 0 && text(current?.content).includes("REFERENCE_MEMORY_FACT")
            ? "main"
            : "unknown"
  requests.push({ path: request.url, kind, body })
  assert.notEqual(kind, "unknown", "Classify actual current system/tool request before replying")
  const input = kind === "dream" ? JSON.parse(text(current.content)) : undefined
  const content =
    kind === "capture"
      ? JSON.stringify({
          outcome: "observations",
          observations: [
            {
              type: "project",
              statement: "REFERENCE_MEMORY_FACT request identifiers are immutable.",
              topic_hint: "requests",
              keywords: [],
              aliases: [],
              body: null,
            },
          ],
        })
      : kind === "dream"
        ? JSON.stringify({
            operations: [
              {
                op: "create",
                path: "topics/requests.md",
                content:
                  "# Request identifiers\nRequest identity invariants.\n\n## Identity\nRequest identifiers are immutable.",
                evidence: input.claimed_observations.map((item) => item[0]),
              },
            ],
          })
        : "REFERENCE_MEMORY_DONE"
  calls.push({
    kind,
    names,
    path: request.url,
    model: body.model,
    input,
  })
  if (request.url.endsWith("/responses")) {
    const item =
      kind === "title"
        ? {
            type: "function_call",
            id: "fc_title",
            call_id: "call_title",
            name: "session_title",
            arguments: JSON.stringify({ session_title: "Memory comparison" }),
            status: "completed",
          }
        : {
            type: "message",
            id: "msg_memory",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: content, annotations: [] }],
          }
    const result = {
      id: "resp_memory",
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
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }
    if (!body.stream) {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(result))
      return
    }
    const events = [
      {
        type: "response.created",
        response: { ...result, status: "in_progress", output: [] },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item:
          kind === "title"
            ? { ...item, arguments: "", status: "in_progress" }
            : { ...item, content: [], status: "in_progress" },
      },
      ...(kind === "title"
        ? [
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
          ]
        : [
            {
              type: "response.content_part.added",
              output_index: 0,
              item_id: item.id,
              content_index: 0,
              part: { type: "output_text", text: "", annotations: [] },
            },
            {
              type: "response.output_text.delta",
              output_index: 0,
              item_id: item.id,
              content_index: 0,
              delta: content,
            },
            {
              type: "response.output_text.done",
              output_index: 0,
              item_id: item.id,
              content_index: 0,
              text: content,
            },
            {
              type: "response.content_part.done",
              output_index: 0,
              item_id: item.id,
              content_index: 0,
              part: item.content[0],
            },
          ]),
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: result },
    ]
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(
      events.map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(""),
    )
    return
  }
  assert.ok(request.url.endsWith("/chat/completions"), "Supported provider wire endpoint")
  if (!body.stream) {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        id: "reference",
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    )
    return
  }
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(
    [
      {
        id: "reference",
        object: "chat.completion.chunk",
        model: body.model,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content },
            finish_reason: null,
          },
        ],
      },
      {
        id: "reference",
        object: "chat.completion.chunk",
        model: body.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ]
      .map((item) => `data: ${JSON.stringify({ created: 1, ...item })}\n\n`)
      .join("") + "data: [DONE]\n\n",
  )
}
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
const url = `http://127.0.0.1:${provider.address().port}`
const profile = join(output, "isolation.sb")
await writeFile(
  profile,
  `(version 1)\n(allow default)\n(deny network*)\n(allow network-outbound (remote ip "localhost:${provider.address().port}"))\n(allow network-bind (local unix-socket (subpath ${JSON.stringify(output)})))\n(allow network-inbound (local unix-socket (subpath ${JSON.stringify(output)})))\n(allow network-outbound (remote unix-socket (subpath ${JSON.stringify(output)})))\n(deny file-read* file-write* (subpath ${JSON.stringify(await realpath(homedir()))}))\n(allow file-read* (literal ${JSON.stringify(binary)}))\n(allow file-read* file-write* (subpath ${JSON.stringify(workspace)}))\n`,
)
const runChild = async (command, args, options) => {
  const child = spawn(command, args, {
    ...options,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stdout = [],
    stderr = []
  child.stdout.on("data", (chunk) => stdout.push(chunk))
  child.stderr.on("data", (chunk) => stderr.push(chunk))
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal }))
  })
  try {
    return {
      ...(await deadline(exited, 10000, "bounded reference command")),
      stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(stderr).toString(),
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid, "SIGKILL")
      await exited
    }
  }
}

try {
  assert.equal(
    (
      await runChild("/usr/bin/git", ["init", "--quiet"], {
        cwd: workspace,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: output,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
      })
    ).code,
    0,
  )
  for (const enabled of [true]) {
    const home = join(output, enabled ? "v2" : "legacy")
    await mkdir(home)
    await mkdir(join(home, "memory"))
    const legacy = "# Memory\n\n## Curated knowledge\nREFERENCE_CARRYOVER_FACT: use immutable request identifiers.\n"
    await writeFile(join(home, "memory", "MEMORY.md"), legacy)
    await writeFile(
      join(home, "config.toml"),
      `[models]\ndefault = "memory-fixture"\n[model.memory-fixture]\nmodel = "fixture"\nname = "Memory reference"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = true\n[memory_v2]\nenabled = ${enabled}\nautomatic_dream_enabled = false\n[cli]\nuse_leader = false\n`,
    )
    await mkdir(join(home, "tmp"))
    const env = {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: home,
      GROK_HOME: home,
      TMPDIR: join(home, "tmp"),
      LANG: "en_US.UTF-8",
      TERM: "dumb",
      GROK_CONFIG: "",
      GROK_CONFIG_PATH: "",
      GROK_MEMORY: "1",
      GROK_MANAGED_MCPS_ENABLED: "0",
      XAI_API_KEY: "local-fixture",
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
      for (const surface of ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"])
        env[`GROK_${vendor}_${surface}_ENABLED`] = "0"
    await writeFile(
      join(output, "isolation.json"),
      JSON.stringify(
        {
          binary,
          workspace,
          home,
          environment: env,
          policy: await readFile(profile, "utf8"),
        },
        null,
        2,
      ),
    )
    const guarded = (args) =>
      runChild("/usr/bin/sandbox-exec", ["-f", profile, ...args], {
        cwd: workspace,
        env,
      })
    const deniedDirectory = await mkdtemp(join(homedir(), ".memory-isolation-probe-"))
    const blockedRequests = []
    const blocked = createServer((request, response) => {
      blockedRequests.push(request.url)
      response.end("unexpected")
    })
    try {
      await writeFile(join(deniedDirectory, "sentinel"), "owned-private-isolation-sentinel")
      const denied = await guarded(["/bin/cat", join(deniedDirectory, "sentinel")])
      assert.notEqual(denied.code, 0, "Real home is denied outside owned reference workspace")
      assert.ok(!denied.stdout.includes("owned-private-isolation-sentinel"))
      await writeFile(join(workspace, "isolation.txt"), "owned-workspace-readable")
      assert.equal((await guarded(["/bin/cat", join(workspace, "isolation.txt")])).stdout, "owned-workspace-readable")
      await new Promise((resolve) => blocked.listen(0, "127.0.0.1", resolve))
      const rejected = await guarded([
        "/usr/bin/curl",
        "--silent",
        "--max-time",
        "2",
        `http://127.0.0.1:${blocked.address().port}/blocked`,
      ])
      assert.notEqual(rejected.code, 0, "Non-whitelisted network port is denied")
      assert.equal(blockedRequests.length, 0)
      const allowed = await guarded(["/usr/bin/curl", "--silent", "--max-time", "2", `${url}/v1/models`])
      assert.equal(allowed.code, 0, "Owned provider is reachable")
      const version = await guarded([binary, "--version"])
      assert.equal(version.code, 0)
      controls.push({
        name: "isolation-preflight",
        homeDenied: true,
        workspaceAllowed: true,
        otherPortDenied: true,
        ownedProviderAllowed: true,
        version: version.stdout.trim(),
      })
    } finally {
      blocked.closeAllConnections()
      if (blocked.listening) await new Promise((resolve) => blocked.close(resolve))
      await rm(deniedDirectory, { recursive: true, force: true })
    }
    const curatedPaths = []
    const child = spawn("/usr/bin/sandbox-exec", ["-f", profile, binary, "agent", "stdio"], {
      cwd: workspace,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", resolve)
    })
    const stderr = []
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    const connection = new ClientSideConnection(
      () => ({
        async sessionUpdate() {},
        async extNotification() {},
        async requestPermission(params) {
          const option = params.options.find((item) => item.kind === "allow_once")
          assert.ok(option)
          return {
            outcome: { outcome: "selected", optionId: option.optionId },
          }
        },
      }),
      ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
    )
    try {
      await deadline(
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "apexo-memory-comparison", version: "1" },
        }),
        15000,
        "official initialization",
      )
      const session = await deadline(
        connection.newSession({ cwd: workspace, mcpServers: [] }),
        15000,
        "official Session",
      )
      const method = (name, args) =>
        deadline(connection.extMethod(`_x.ai/memory/${name}`, args), 30000, `official ${name}`)
      const listing = await method("list", { sessionId: session.sessionId })
      assert.equal(calls.length, 0)
      const carried = listing.files.filter((file) => file.source === "global" && file.path.includes("/topics/"))
      assert.ok(carried.length > 0)
      curatedPaths.push(...carried.map((file) => file.path))
      const contents = await Promise.all(
        carried.map((file) => {
          assert.ok(file.path.startsWith(home + "/"))
          return readFile(file.path, "utf8")
        }),
      )
      assert.ok(contents.some((content) => content.includes("REFERENCE_CARRYOVER_FACT")))
      assert.equal(await readFile(join(home, "memory", "MEMORY.md"), "utf8"), legacy)
      const another = await deadline(
        connection.newSession({ cwd: workspace, mcpServers: [] }),
        15000,
        "repeat carryover Session",
      )
      const repeated = await method("list", { sessionId: another.sessionId })
      assert.deepEqual(
        repeated.files
          .filter((file) => file.source === "global" && file.path.includes("/topics/"))
          .map((file) => file.path),
        carried.map((file) => file.path),
      )
      assert.equal(calls.length, 0)
      checks.push({
        name: "session-start-curated-carryover-source-preserved-deduplicated-zero-provider",
        topics: carried.length,
      })
      checks.push({
        name: "passive-list",
        result: listing,
        providerCalls: calls.length,
      })
      const emptyFlush = await method("flush", {
        session_id: session.sessionId,
      })
      const emptyDream = await method("dream", {
        session_id: session.sessionId,
      })
      assert.equal(calls.length, 0)
      checks.push({
        name: "empty-flush-dream",
        flush: emptyFlush,
        dream: emptyDream,
        providerCalls: calls.length,
      })
      const result = await deadline(
        connection.prompt({
          sessionId: session.sessionId,
          prompt: [
            {
              type: "text",
              text: "REFERENCE_MEMORY_FACT request identifiers are immutable. Reply briefly without tools.",
            },
          ],
        }),
        30000,
        "official main turn",
      )
      assert.equal(result.stopReason, "end_turn")
      const flush = await method("flush", { session_id: session.sessionId })
      checks.push({
        name: "completed-turn-flush",
        result: flush,
        calls: calls.map((x) => x.kind),
      })
      assert.equal(flush.disposition, "flushed")
      assert.equal(calls.filter((x) => x.kind === "capture").length, 1)
      assert.equal(calls.find((x) => x.kind === "capture").names.length, 0)
      const beforeRepeat = domainCalls().length
      const repeat = await method("flush", { session_id: session.sessionId })
      assert.equal(domainCalls().length, beforeRepeat)
      checks.push({
        name: "repeat-flush-no-extraction",
        result: repeat,
        domainProviderCalls: domainCalls().length - beforeRepeat,
      })
      const dream = await method("dream", { session_id: session.sessionId })
      checks.push({
        name: "manual-dream",
        result: dream,
        calls: calls.map((x) => x.kind),
      })
      assert.equal(dream.disposition, "completed")
      assert.equal(calls.filter((x) => x.kind === "dream").length, 1)
      assert.equal(calls.find((x) => x.kind === "dream").names.length, 0)
      const published = await method("list", { sessionId: session.sessionId })
      const topic = published.files.find((file) => file.path.endsWith("/topics/requests.md"))
      assert.ok(topic && topic.path.startsWith(home + "/"), "Dream publishes the fixture's actual topic")
      assert.ok((await readFile(topic.path, "utf8")).includes("Request identifiers are immutable."))
      curatedPaths.push(...published.files.filter((file) => file.path.includes("/topics/")).map((file) => file.path))

      const beforeEmpty = domainCalls().length
      const emptyAfter = await method("dream", {
        session_id: session.sessionId,
      })
      assert.equal(domainCalls().length, beforeEmpty)
      assert.equal(emptyAfter.disposition, "no_work")
      checks.push({
        name: "repeat-dream-no-provider",
        result: emptyAfter,
        domainProviderCalls: domainCalls().length - beforeEmpty,
      })
      assert.deepEqual(providerErrors, [])
      assert.equal(calls.filter((item) => item.kind === "main").length, 1)
      await method("toggle", { sessionId: session.sessionId, enabled: false })
      const disabledFlush = await method("flush", {
        session_id: session.sessionId,
      })
      const disabledDream = await method("dream", {
        session_id: session.sessionId,
      })
      assert.equal(domainCalls().length, beforeEmpty)
      assert.equal(disabledFlush.disposition, "disabled")
      assert.equal(disabledDream.disposition, "disabled")
      checks.push({
        name: "disabled-no-provider",
        flush: disabledFlush,
        dream: disabledDream,
      })
    } finally {
      if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, "SIGTERM")
      await deadline(exited, 10000, "official joined shutdown").catch(async () => {
        process.kill(-child.pid, "SIGKILL")
        await exited
      })
      await writeFile(join(output, "official-stderr.log"), Buffer.concat(stderr))
    }
    const help = await guarded([binary, "memory", "clear", "--help"])
    controls.push({
      name: "clear-help",
      code: help.code,
      stdout: help.stdout,
      stderr: help.stderr,
    })
    assert.equal(help.code, 0)
    assert.ok(help.stdout.includes("--all") && help.stdout.includes("--yes"))
    const beforeClear = calls.length
    const cleared = await guarded([binary, "memory", "clear", "--all", "--yes"])
    assert.equal(cleared.code, 0)
    const remaining = await Promise.all(
      [...new Set(curatedPaths)].map(async (path) => ({
        path,
        exists: await Bun.file(path).exists(),
      })),
    )
    assert.ok(
      remaining.every((item) => !item.exists),
      "Clear removes fixture's curated V2 topics",
    )
    assert.equal(calls.length, beforeClear)
    controls.push({
      name: "isolated-cli-clear",
      code: cleared.code,
      stdout: cleared.stdout,
      removedTopics: remaining.length,
      providerCalls: 0,
    })
  }
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify({ checks, calls, requests, providerErrors, controls }, null, 2),
  )
  console.log(
    JSON.stringify(
      {
        result: "pass",
        comparisonOnly: true,
        checks,
        providerCalls: calls.length,
        classifiedCalls: Object.fromEntries(
          ["main", "capture", "dream", "title", "dashboard"].map((kind) => [
            kind,
            calls.filter((item) => item.kind === kind).length,
          ]),
        ),
        controls,
        output,
      },
      null,
      2,
    ),
  )
} finally {
  await writeFile(
    join(output, "observed.json"),
    JSON.stringify({ checks, calls, requests, providerErrors, controls }, null, 2),
  )
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await rm(workspace, { recursive: true, force: true })
  console.error(`Memory reference evidence: ${output}`)
}
