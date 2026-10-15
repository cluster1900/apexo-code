// Installed official runtime; isolated config/storage, no recording of setup or credentials.
import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Readable, Writable } from "node:stream"
import { fileURLToPath } from "node:url"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const directory = await realpath(await mkdtemp(join(tmpdir(), "apexo-memory-official-")))
const home = join(directory, "grok-home")
// Official Memory disables temporary workspaces. Keep only disposable Git fixtures under this checkout.
const fixture = await mkdtemp(join(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."), ".memory-scope-test-"))
const original = join(fixture, "original")
const clone = join(fixture, "clone")
const worktree = join(fixture, "linked")
const other = join(fixture, "unrelated")
await mkdir(join(home, "memory"), { recursive: true })
await mkdir(original)
await mkdir(other)
function git(cwd, ...args) {
  execFileSync("git", ["-c", "commit.gpgSign=false", ...args], { cwd, stdio: "pipe" })
}
git(original, "init")
git(
  original,
  "-c",
  "user.name=Memory fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "commit",
  "--allow-empty",
  "-m",
  "fixture",
)
git(original, "remote", "add", "origin", "https://example.invalid/acme/scopes.git")
git(directory, "clone", original, clone)
git(clone, "remote", "set-url", "origin", "git@example.invalid:acme/scopes.git")
git(original, "worktree", "add", "--detach", worktree)
git(other, "init")
git(other, "remote", "add", "origin", "https://example.invalid/acme/unrelated.git")
await writeFile(join(home, "memory/MEMORY.md"), "# Preferences\n\nGLOBAL_PREFERENCE: use concise answers.\n")

const planned = { tool: "", args: {}, sent: false }
const names = new Set()
const retrievalSchemas = new Map()
const events = []
const evidence = []
const flushes = []
const dreams = []
const retention = { checks: [] }
const dreamModels = []
const reviews = []
const workEvents = []
const captureStatus = process.argv.includes("--capture-status")
const compactIndex = process.argv.includes("--compact-index")
const contextEnabled = process.argv.includes("--context") || compactIndex
const captureMode = { invalid: false }
const captureReport = { status: "not_requested" }
const contexts = []
const toggleHold = { value: undefined }
const terminalReview = { child: undefined, text: "", offset: 0 }
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
  const capture =
    (process.argv.includes("--flush") || process.argv.includes("--dream") || contextEnabled) &&
    JSON.stringify(body.messages ?? body.input).includes("Extract durable, reusable observations")
  const dreaming =
    process.argv.includes("--dream") &&
    JSON.stringify(body.messages ?? body.input).includes("Consolidate only the supplied claimed observations")
  const content = (() => {
    if (capture && captureMode.invalid) return "PRIVATE_CAPTURE_FAILURE"
    if (
      process.argv.includes("--review") &&
      JSON.stringify(body.messages ?? body.input).includes("memory note formatter")
    ) {
      reviews.push({ model: body.model, tools: body.tools?.length ?? 0 })
      return "## Preferences\nOFFICIAL_REVIEW_REWRITE: use concise replies."
    }
    if (dreaming) {
      const message = (body.messages ?? body.input).findLast((item) => item.role === "user").content
      const input = JSON.parse(typeof message === "string" ? message : message.map((part) => part.text ?? "").join(""))
      const evidence = input.claimed_observations.map((item) => item[0])
      dreamModels.push({ evidence, tools: body.tools?.length ?? 0 })
      return JSON.stringify({
        operations: [
          {
            op: "create",
            path: "topics/dream-parity.md",
            content: "# Database\nOFFICIAL_DREAM_FACT: use WAL for concurrent readers.",
            evidence,
          },
        ],
      })
    }
    if (capture)
      return JSON.stringify(
        process.argv.includes("--dream") && JSON.stringify(body.messages ?? body.input).includes("OFFICIAL_DREAM_FACT")
          ? {
              outcome: "observations",
              observations: [
                {
                  type: "project",
                  topic_hint: "database",
                  statement: "OFFICIAL_DREAM_FACT: use WAL for concurrent readers.",
                  keywords: ["database", "WAL"],
                  aliases: [],
                  body: captureStatus ? "OFFICIAL_CAPTURE_DETAIL" : null,
                },
              ],
            }
          : { outcome: "noop", observations: [] },
      )
    if (
      contextEnabled &&
      JSON.stringify(body.messages ?? body.input).includes("Your task is to produce a faithful, concise summary")
    )
      return [
        "## Task\nThe user is checking saved memory across repositories and sessions using an isolated local fixture.",
        "## Completed work\nThe original repository, another clone, and a linked worktree expose the same workspace notes. An unrelated repository has its own workspace scope and can still read the global preferences. File reads have completed successfully.",
        "## Current context\nThe repository note lives in topics/parity.md. A new note named context-added.md was written after the current conversation's first model turn. This session's existing memory context stayed unchanged during continuation and session reload. A newly created session included the new note in its workspace manifest.",
        "## Next step\nFinish context compaction, then continue the conversation and check that the refreshed workspace manifest includes context-added.md. Preserve the global manifest and workspace manifest distinction. No external services, user credentials, or production repositories are needed for the remaining check.",
        "## Validation boundaries\nThis run uses the installed official Memory V2 behavior. It checks manifest injection and prompt prefix stability. Legacy full-text ranking and snippet formatting are validated separately against the corresponding official source tests; they must not be reported as installed V2 tool behavior.",
      ].join("\n\n")
    return "MEMORY_ACK"
  })()
  const tools = body.tools?.map((tool) => tool.function ?? tool) ?? []
  if ((contextEnabled || process.argv.includes("--toggle")) && tools.length && !capture && !dreaming) {
    const system = (body.messages ?? body.input)
      .map((item) =>
        typeof item.content === "string" ? item.content : item.content.map((part) => part.text ?? "").join("\n"),
      )
      .join("\n")
    contexts.push(
      Array.from(system.matchAll(/<memory-context>[\s\S]*?<\/memory-context>/g), (match) => match[0]).join("\n\n"),
    )
  }
  if (
    process.argv.includes("--toggle") &&
    tools.length &&
    JSON.stringify(body.messages ?? body.input).includes("OFFICIAL_MODE_HOLD") &&
    toggleHold.value
  )
    await toggleHold.value.promise
  tools.forEach((tool) => names.add(tool.name))
  tools
    .filter((tool) => ["memory_search", "memory_get", "grep", "read_file"].includes(tool.name))
    .forEach((tool) => retrievalSchemas.set(tool.name, tool.parameters))
  const tool = !planned.sent && tools.find((tool) => tool.name === planned.tool)
  if (tool) planned.sent = true
  const id = `memory_${events.length}`
  response.writeHead(200, { "content-type": "text/event-stream" })
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          { index: 0, id, type: "function", function: { name: tool.name, arguments: JSON.stringify(planned.args) } },
        ],
      }
    : { role: "assistant", content }
  response.end(
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      {
        choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
    ]
      .map(
        (event) =>
          `data: ${JSON.stringify({ id, created: 1, object: "chat.completion.chunk", model: body.model, ...event })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
  )
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault = "memory-fixture"\n[model.memory-fixture]\nmodel = "fixture"\nname = "Memory fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture-key"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = ${process.argv.includes("--toggle") ? "false" : "true"}\n[memory_v2]\nenabled = ${captureStatus || compactIndex ? "true" : "false"}\n${compactIndex ? "compact_index_enabled = true\n" : ""}${captureStatus ? "capture_status_enabled = true\n" : ""}${process.argv.includes("--retention") ? "archived_retention_days = 0\njob_retention_days = 0\n" : ""}`,
)
const direct = process.argv.includes("--direct")
const child = spawn(
  direct ? "grok" : "bun",
  direct ? ["agent", "stdio"] : ["run", "src/index.ts", "acp", "--backend", "grok-build", "--cwd", original],
  {
    cwd: direct ? original : resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    env: {
      ...process.env,
      GROK_HOME: home,
      GROK_CONFIG: "",
      GROK_CONFIG_PATH: "",
      GROK_MEMORY: "1",
      XAI_API_KEY: "local-fixture-key",
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
)
const exited = new Promise((resolve) => child.once("exit", resolve))
child.stderr.resume()
function record(update) {
  if (!["tool_call", "tool_call_update"].includes(update.sessionUpdate)) return
  events.push({
    type: update.sessionUpdate,
    id: update.toolCallId,
    status: update.status,
    input: update.rawInput,
    output: update.rawOutput,
    content: update.content
      ?.filter((item) => item.type === "content" && item.content?.type === "text")
      .map((item) => item.content.text),
  })
}
const connection = new ClientSideConnection(
  () => ({
    async requestPermission(params) {
      const option = params.options.find((option) => option.kind === "allow_once")
      assert.ok(option)
      return { outcome: { outcome: "selected", optionId: option.optionId } }
    },
    async sessionUpdate(params) {
      record(params.update)
    },
    async extNotification(method, params) {
      // The official transient gateway omits the underscore used by durable updates.
      if (!["_x.ai/session_notification", "x.ai/session_notification"].includes(method)) return
      if (params.update) record(params.update)
      if (params.update?.sessionUpdate?.startsWith("memory_")) workEvents.push(params.update)
    },
  }),
  ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
)
async function listing(sessionId) {
  const response = await deadline(connection.extMethod("_x.ai/memory/list", { sessionId }), 30_000, "memory list")
  const result = response.result ?? response
  evidence.push({ sessionId, listing: result })
  return result
}
async function invoke(sessionId, tool, args) {
  const before = events.length
  Object.assign(planned, { tool, args, sent: false })
  const result = await deadline(
    connection.prompt({
      sessionId,
      prompt: [{ type: "text", text: `Use ${tool} once to inspect the requested saved memory.` }],
    }),
    60_000,
    "memory file read",
  )
  assert.equal(result.stopReason, "end_turn")
  assert.ok(planned.sent, `${tool} not advertised; available tools: ${[...names].join(", ")}`)
  const completed = events.slice(before).findLast((event) => event.status === "completed")
  assert.ok(completed)
  evidence.push({ sessionId, tool, args, result: completed })
  return JSON.stringify(completed.output ?? completed.content)
}
async function read(sessionId, path, token) {
  assert.ok((await invoke(sessionId, "read_file", { target_file: path })).includes(token))
}
try {
  await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
  const first = (await connection.newSession({ cwd: original, mcpServers: [] })).sessionId
  const initial = await listing(first)
  assert.equal(initial.enabled, true)
  const globalFile = initial.files.find((file) => file.source === "global" && !file.generated)?.path
  const workspace = initial.files.find((file) => file.source === "workspace")
  assert.ok(globalFile, "Official runtime did not load or migrate the seeded global note")
  assert.ok(workspace, "Official runtime did not initialize repository memory")
  const workspaceFile = workspace.generated ? join(dirname(workspace.path), "topics", "parity.md") : workspace.path
  await mkdir(dirname(workspaceFile), { recursive: true })
  await writeFile(workspaceFile, "# Repository\n\nWORKSPACE_SAVED: repository convention.\n")
  for (const cwd of [original, clone, worktree]) {
    const sessionId = (await connection.newSession({ cwd, mcpServers: [] })).sessionId
    const files = await listing(sessionId)
    assert.ok(
      files.files.some((file) => file.path === workspaceFile),
      `Shared memory not visible from ${cwd}`,
    )
    await read(sessionId, workspaceFile, "WORKSPACE_SAVED")
    await read(sessionId, globalFile, "GLOBAL_PREFERENCE")
  }
  const separate = (await connection.newSession({ cwd: other, mcpServers: [] })).sessionId
  const files = await listing(separate)
  assert.ok(!files.files.some((file) => file.path === workspaceFile))
  await read(separate, globalFile, "GLOBAL_PREFERENCE")
  if (process.argv.includes("--review")) {
    const before = await readFile(globalFile, "utf8")
    const rewrite = await connection.extMethod("_x.ai/memory/rewrite", {
      sessionId: first,
      rawText: "Use concise replies",
      contextSummary: "This note concerns response preferences.",
    })
    assert.match(rewrite.rewritten ?? rewrite.result?.rewritten ?? "", /OFFICIAL_REVIEW_REWRITE/)
    assert.equal(await readFile(globalFile, "utf8"), before)
    assert.equal(reviews.length, 1)
    assert.equal(reviews[0].tools, 0)
    await assert.rejects(() =>
      connection.extMethod("_x.ai/memory/rewrite", {
        sessionId: first,
        rawText: "界".repeat(11000),
        contextSummary: "",
      }),
    )
    evidence.push({
      scenario: "review-rewrite",
      checks: ["rewrite-result", "no-write-before-confirmation", "no-tools", "utf8-limit"],
      reviews,
    })
    console.log(JSON.stringify(evidence.at(-1)))
    if (process.argv.includes("--review-tui")) {
      const plain = () => terminalReview.text.slice(terminalReview.offset).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      const decoder = new TextDecoder()
      terminalReview.child = Bun.spawn(["grok", "--cwd", original, "--fullscreen"], {
        env: {
          ...process.env,
          GROK_HOME: home,
          GROK_CONFIG: "",
          GROK_CONFIG_PATH: "",
          GROK_MEMORY: "1",
          XAI_API_KEY: "local-fixture-key",
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
        terminal: {
          cols: 120,
          rows: 40,
          data(terminal, bytes) {
            const text = decoder.decode(bytes, { stream: true })
            terminalReview.text += text
            if (text.includes("\x1b[6n")) terminal.write("\x1b[1;1R")
          },
        },
      })
      await poll(() => /Memory fixture|memory-fixture/.test(plain()), "official terminal ready", 30_000)
      terminalReview.child.terminal.write("\x1b[200~OFFICIAL_REVIEW_INIT\x1b[201~")
      await poll(() => plain().includes("OFFICIAL_REVIEW_INIT"), "official first input")
      terminalReview.child.terminal.write("\r")
      await poll(() => plain().includes("MEMORY_ACK"), "official session established", 30_000)
      const notes = async () => {
        const files = await Array.fromAsync(
          new Bun.Glob("{memory,memory-v2}/**/*.md").scan({ cwd: home, absolute: true }),
        )
        return (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n")
      }
      const open = async (content) => {
        terminalReview.offset = terminalReview.text.length
        terminalReview.child.terminal.write(`\x1b[200~/remember ${content}\x1b[201~`)
        await poll(() => plain().includes(content), "official note entered")
        terminalReview.child.terminal.write("\r")
        await poll(() => plain().includes("Memory Note"), "official review modal")
      }
      const checks = []
      await open("OFFICIAL_REVIEW_CANCEL")
      await poll(() => plain().includes("Tab enhanced"), "official rewrite available")
      terminalReview.child.terminal.write("\t")
      await poll(() => plain().includes("OFFICIAL_REVIEW_REWRITE"), "official rewrite preview")
      assert.doesNotMatch(await notes(), /OFFICIAL_REVIEW_CANCEL|OFFICIAL_REVIEW_REWRITE/)
      terminalReview.offset = terminalReview.text.length
      terminalReview.child.terminal.write("\x1b")
      await poll(() => /❯|Enter:.*send|Shift\+Tab:mode/.test(plain()), "official cancel returned")
      assert.doesNotMatch(await notes(), /OFFICIAL_REVIEW_CANCEL|OFFICIAL_REVIEW_REWRITE/)
      checks.push("review-before-save", "optional-rewrite-preview", "cancel-without-save")
      await open("OFFICIAL_REVIEW_RAW_SAVE")
      terminalReview.child.terminal.write("y")
      await poll(async () => (await notes()).includes("OFFICIAL_REVIEW_RAW_SAVE"), "official original saved")
      assert.doesNotMatch(await notes(), /OFFICIAL_REVIEW_REWRITE|OFFICIAL_REVIEW_CANCEL/)
      checks.push("confirm-original")
      await open("OFFICIAL_REVIEW_SELECT_REWRITE")
      await poll(() => plain().includes("Tab enhanced"), "official second rewrite available")
      terminalReview.child.terminal.write("\t")
      await poll(() => plain().includes("OFFICIAL_REVIEW_REWRITE"), "official second rewrite preview")
      terminalReview.child.terminal.write("y")
      await poll(async () => (await notes()).includes("OFFICIAL_REVIEW_REWRITE"), "official rewrite saved")
      assert.doesNotMatch(await notes(), /OFFICIAL_REVIEW_SELECT_REWRITE/)
      checks.push("confirm-selected-rewrite")
      evidence.push({ scenario: "review-terminal", checks })
      console.log(JSON.stringify(evidence.at(-1)))
    }
  }
  if (contextEnabled) {
    assert.ok(workspace.generated, "This installed-runtime comparison expects the observed Memory V2 manifests")
    async function context(sessionId, text) {
      Object.assign(planned, { tool: "", sent: true })
      const before = contexts.length
      const result = await deadline(
        connection.prompt({ sessionId, prompt: [{ type: "text", text }] }),
        60_000,
        "official memory context",
      )
      assert.equal(result.stopReason, "end_turn")
      assert.ok(contexts.length > before)
      return contexts.at(-1)
    }
    if (compactIndex) {
      await Promise.all(
        Array.from({ length: 200 }, (_, i) =>
          writeFile(
            join(dirname(workspaceFile), `topic-${String(i).padStart(3, "0")}.md`),
            `# Topic ${String(i).padStart(3, "0")}\nCOMPACT_PRIVATE_DESCRIPTION\n`,
          ),
        ),
      )
    }
    const sessionId = (await connection.newSession({ cwd: original, mcpServers: [] })).sessionId
    const firstContext = await context(sessionId, "Inspect the repository conventions and saved preferences.")
    assert.match(firstContext, /Global memory manifest/)
    assert.match(firstContext, /Workspace memory manifest/)
    assert.match(firstContext, /parity\.md/)
    if (compactIndex) {
      const disk = await readFile(workspace.path, "utf8")
      assert.match(disk, /## More topics/)
      assert.doesNotMatch(disk, /COMPACT_PRIVATE_DESCRIPTION/)
      assert.ok(Buffer.byteLength(disk) <= 8192)
      assert.ok(firstContext.includes(disk))
      const last = join(dirname(workspaceFile), "topic-199.md")
      for (let i = 0; i < 4; i++) await read(sessionId, last, "COMPACT_PRIVATE_DESCRIPTION")
      assert.equal(await context(sessionId, "Continue after reading a memory topic."), firstContext)
      const ranked = (await connection.newSession({ cwd: original, mcpServers: [] })).sessionId
      const rankedContext = await context(ranked, "Refresh the compact index.")
      assert.ok(rankedContext.indexOf("**Topic 199**") < rankedContext.indexOf("**Topic 000**"))
      evidence.push({
        scenario: "compact-index",
        checks: [
          "titles-and-slugs",
          "no-descriptions",
          "utf8-budget",
          "disk-matches-context",
          "read-keeps-prefix",
          "fresh-session-read-ranking",
        ],
      })
    }
    const added = join(dirname(workspaceFile), "context-added.md")
    await writeFile(added, "# Context Added\nA newly saved repository convention.\n")
    assert.equal(await context(sessionId, "Continue checking the same conventions."), firstContext)
    await deadline(
      connection.loadSession({ sessionId, cwd: original, mcpServers: [] }),
      30_000,
      "official memory context resume",
    )
    assert.equal(await context(sessionId, "Resume checking the same conventions."), firstContext)
    const fresh = (await connection.newSession({ cwd: original, mcpServers: [] })).sessionId
    assert.match(await context(fresh, "Inspect the saved repository conventions."), /context-added\.md/)
    await deadline(
      connection.prompt({ sessionId, prompt: [{ type: "text", text: "/compact" }] }),
      60_000,
      "official compaction",
    )
    assert.match(await context(sessionId, "Continue after compaction."), /context-added\.md/)
    evidence.push({
      scenario: "v2-context",
      checks: ["both-manifests", "stable-prefix", "persisted-resume", "new-session-refresh", "post-compaction-refresh"],
      contexts,
    })
    await rm(added)
  }
  if (process.argv.includes("--search")) {
    // The installed V2 runtime advertises ordinary file tools for curated memory; assert the actual contract.
    assert.ok(retrievalSchemas.get("grep")?.properties?.pattern)
    assert.ok(retrievalSchemas.get("grep")?.properties?.path)
    assert.ok(retrievalSchemas.get("read_file")?.properties?.offset)
    const topic = join(dirname(workspaceFile), "search-parity.md")
    await writeFile(topic, "# Retrieval\nDATABASE_ORIGINAL\n中文数据库连接池配置\n")
    assert.ok(
      (await invoke(first, "grep", { pattern: "DATABASE_ORIGINAL", path: dirname(topic) })).includes(
        "DATABASE_ORIGINAL",
      ),
    )
    assert.ok(
      (await invoke(first, "grep", { pattern: "数据库", path: dirname(topic) })).includes("中文数据库连接池配置"),
    )
    const range = await invoke(first, "read_file", { target_file: topic, offset: 2, limit: 1 })
    assert.ok(range.includes("DATABASE_ORIGINAL"))
    assert.ok(!range.includes("中文数据库"))
    await writeFile(`${topic}.tmp`, "# Updated\nDATABASE_REPLACED\n")
    await rename(`${topic}.tmp`, topic)
    assert.ok(
      !(await invoke(first, "grep", { pattern: "DATABASE_ORIGINAL", path: dirname(topic) })).includes(
        "DATABASE_ORIGINAL",
      ),
    )
    assert.ok(
      (await invoke(first, "grep", { pattern: "DATABASE_REPLACED", path: dirname(topic) })).includes(
        "DATABASE_REPLACED",
      ),
    )
    await rm(topic)
    assert.ok(
      !(await invoke(first, "grep", { pattern: "DATABASE_REPLACED", path: dirname(topic) })).includes(
        "DATABASE_REPLACED",
      ),
    )
  }
  if (process.argv.includes("--inspect-tools"))
    console.log(JSON.stringify({ retrievalSchemas: Object.fromEntries(retrievalSchemas) }))
  if (process.argv.includes("--flush")) {
    for (const session_id of [first, separate]) {
      const response = await deadline(
        connection.extMethod("_x.ai/memory/flush", { session_id }),
        60_000,
        "official memory flush",
      )
      const result = response.result ?? response
      flushes.push({ session_id, result })
      assert.equal(result.flushed, true)
      assert.equal(result.disposition, "flushed")
    }
    evidence.push({ scenario: "flush-barrier-noop", flushes })
  }
  if (process.argv.includes("--dream")) {
    const noWork = await deadline(
      connection.extMethod("_x.ai/memory/dream", { session_id: first }),
      60_000,
      "empty official dream",
    )
    dreams.push(noWork.result ?? noWork)
    assert.equal(dreams[0].disposition, "no_work")
    Object.assign(planned, { tool: "", sent: true })
    await deadline(
      connection.prompt({
        sessionId: first,
        prompt: [
          {
            type: "text",
            text: "OFFICIAL_DREAM_FACT: use WAL for concurrent database readers. Retain this architecture decision.",
          },
        ],
      }),
      60_000,
      "official observation input",
    )
    const capture = await deadline(
      connection.extMethod("_x.ai/memory/flush", { session_id: first }),
      60_000,
      "official observation persistence",
    )
    assert.equal((capture.result ?? capture).flushed, true)
    const response = await deadline(
      connection.extMethod("_x.ai/memory/dream", { session_id: first }),
      60_000,
      "official model dream",
    )
    dreams.push(response.result ?? response)
    assert.equal(dreams[1].disposition, "completed")
    assert.equal(dreamModels.length, 1)
    assert.equal(dreamModels[0].tools, 0)
    assert.ok(dreamModels[0].evidence.length > 0)
    assert.ok((await readFile(join(dirname(workspaceFile), "dream-parity.md"), "utf8")).includes("OFFICIAL_DREAM_FACT"))
    evidence.push({ scenario: "v2-model-dream", dreams, dreamModels })
    if (process.argv.includes("--retention")) {
      const { Database } = await import("bun:sqlite")
      const root = dirname(dirname(workspaceFile))
      const counts = () => {
        // Bun's read-only connection cannot recreate absent WAL sidecars after
        // another SQLite runtime checkpoints. Open only this fixture's existing
        // database, then prevent SQL writes while inspecting it.
        using db = new Database(join(root, "memory_state.sqlite"), { readwrite: true, create: false })
        db.run("PRAGMA query_only = ON")
        db.run("PRAGMA busy_timeout = 5000")
        return {
          archives: db.query("SELECT count(*) AS n FROM consolidation_archives").get().n,
          jobs: db.query("SELECT count(*) AS n FROM capture_jobs").get().n,
          files: db.query("SELECT count(*) AS n FROM capture_observation_files").get().n,
        }
      }
      assert.ok(counts().archives > 0)
      // Official capture only schedules maintenance when it publishes new
      // observations; a noop flush does not run the follow-up worker.
      await deadline(
        connection.prompt({
          sessionId: first,
          prompt: [{ type: "text", text: "OFFICIAL_DREAM_FACT: keep using WAL for concurrent database readers." }],
        }),
        60_000,
        "official maintenance trigger",
      )
      const flushed = await deadline(
        connection.extMethod("_x.ai/memory/flush", { session_id: first }),
        60_000,
        "official retention barrier",
      )
      assert.equal((flushed.result ?? flushed).flushed, true)
      await poll(
        () => counts().archives === 0 && counts().jobs === 1 && counts().files === 1,
        "official zero-day retention",
        30_000,
      )
      assert.match(await readFile(join(dirname(workspaceFile), "dream-parity.md"), "utf8"), /OFFICIAL_DREAM_FACT/)
      assert.match(await readFile(workspaceFile, "utf8"), /WORKSPACE_SAVED/)
      assert.equal(dreamModels.length, 1)
      retention.checks.push(
        "zero-day-archive-retention",
        "terminal-job-retention",
        "archive-and-capture-rows-removed-together",
        "new-live-observation-and-job-preserved",
        "topic-preserved",
        "no-extra-dream-model-call",
      )
      evidence.push({ scenario: "v2-retention", checks: retention.checks, counts: counts() })
    }
  }
  if (process.argv.includes("--work")) {
    const checks = []
    const sessionId = (await connection.newSession({ cwd: original, mcpServers: [] })).sessionId
    const disabled = await connection.extMethod("_x.ai/memory/toggle", { sessionId, enabled: false })
    assert.equal((disabled.result ?? disabled).enabled, false)
    for (const kind of ["flush", "dream"]) {
      const response = await connection.extMethod(`_x.ai/memory/${kind}`, { session_id: sessionId })
      assert.equal((response.result ?? response).disposition, "disabled")
      checks.push(`${kind}-disabled-result`)
    }
    await connection.extMethod("_x.ai/memory/toggle", { sessionId, enabled: true })
    assert.ok(flushes.every((value) => value.result.disposition === "flushed"))
    assert.equal(dreams[0].disposition, "no_work")
    assert.equal(dreams[1].disposition, "completed")
    assert.ok(dreams[1].observation_count > 0)
    assert.ok(dreams[1].topics_affected > 0)
    assert.ok(workEvents.some((event) => event.sessionUpdate === "memory_flush_started"))
    assert.ok(workEvents.some((event) => event.sessionUpdate === "memory_flush_completed"))
    assert.ok(workEvents.some((event) => event.sessionUpdate === "memory_dream_started"))
    assert.ok(workEvents.some((event) => event.sessionUpdate === "memory_dream_completed"))
    checks.push(
      "flush-result",
      "dream-no-work",
      "dream-completed-counts",
      "flush-progress-notifications",
      "dream-progress-notifications",
    )
    evidence.push({ scenario: "memory-work", checks, workEvents })
    console.log(JSON.stringify({ scenario: "memory-work", checks }))
  }
  if (process.argv.includes("--toggle")) {
    const checks = []
    const sessionId = (await connection.newSession({ cwd: original, mcpServers: [] })).sessionId
    Object.assign(planned, { tool: "", sent: true })
    const config = await readFile(join(home, "config.toml"), "utf8")
    const toggle = async (enabled) => {
      const response = await deadline(
        connection.extMethod("_x.ai/memory/toggle", { sessionId, enabled }),
        30_000,
        "official memory toggle",
      )
      return response.result ?? response
    }
    const prompt = async (text) => {
      const before = contexts.length
      await deadline(
        connection.prompt({ sessionId, prompt: [{ type: "text", text }] }),
        30_000,
        "official memory mode prompt",
      )
      assert.ok(contexts.length > before)
      return contexts.at(-1)
    }
    assert.ok((await prompt("Check the repository's saved memory configuration.")).length > 0)
    const before = contexts.length
    assert.equal((await toggle(false)).enabled, false)
    assert.equal((await listing(sessionId)).enabled, false)
    assert.equal(contexts.length, before)
    assert.match(await readFile(workspaceFile, "utf8"), /WORKSPACE_SAVED/)
    assert.equal(await prompt("Continue after memory has been disabled."), "")
    checks.push(
      "initially-enabled",
      "disable-without-model-call",
      "disable-preserves-files",
      "disabled-context-removed",
    )
    const fresh = (await connection.newSession({ cwd: original, mcpServers: [] })).sessionId
    assert.equal((await listing(fresh)).enabled, true)
    assert.equal(await readFile(join(home, "config.toml"), "utf8"), config)
    assert.equal((await toggle(true)).enabled, true)
    assert.ok((await prompt("Continue with memory enabled again.")).length > 0)
    checks.push("new-session-follows-config", "config-unchanged", "reenable-restores-context")
    await toggle(false)
    toggleHold.value = Promise.withResolvers()
    const count = contexts.length
    const running = prompt("OFFICIAL_MODE_HOLD verify enabling during this turn.")
    await deadline(
      (async () => {
        while (contexts.length === count) await new Promise((resolve) => setTimeout(resolve, 20))
      })(),
      10_000,
      "official held provider turn",
    )
    const refused = await toggle(true)
    assert.equal(refused.enabled, false)
    assert.match(refused.message, /turn is running/)
    toggleHold.value.resolve()
    await running
    assert.equal((await listing(sessionId)).enabled, false)
    assert.equal((await toggle(true)).enabled, true)
    assert.equal((await listing(sessionId)).enabled, true)
    checks.push(
      "busy-enable-refused",
      "idle-does-not-auto-enable",
      "retry-after-idle-enables",
      "environment-opt-in-beats-config",
    )
    evidence.push({ scenario: "session-memory-toggle", checks })
    console.log(JSON.stringify({ result: "pass", scenario: "session-memory-toggle", checks }))
  }
  if (process.argv.includes("--browse")) {
    const { blake3 } = await import(process.env.BLAKE3_MODULE ?? "@noble/hashes/blake3.js")
    const hash = (bytes) => Buffer.from(blake3(bytes)).toString("hex")
    const checks = []
    const forget = async (path, expectedContentHash, sessionId = first) => {
      const response = await connection.extMethod("_x.ai/memory/forget", { sessionId, path, expectedContentHash })
      return response.result ?? response
    }
    const note = join(dirname(workspaceFile), "browser-parity.md")
    await writeFile(note, "# Browser\n数据库 ORIGINAL_NOTE\n")
    assert.ok((await listing(first)).files.some((file) => file.path === note))
    await read(first, note, "ORIGINAL_NOTE")
    checks.push("list", "preview-file-tool")
    const before = hash(await readFile(note))
    await writeFile(note, "EDITED_NOTE")
    assert.equal((await forget(note, before)).reason, "changed")
    assert.equal(await readFile(note, "utf8"), "EDITED_NOTE")
    checks.push("reject-changed-preview")
    const current = hash(await readFile(note))
    assert.equal((await forget(note, current, separate)).reason, "not_deletable")
    checks.push("repository-isolation")
    assert.equal((await forget(note, current)).outcome, "forgotten")
    assert.ok(!(await listing(first)).files.some((file) => file.path === note))
    assert.match(await readFile(workspaceFile, "utf8"), /WORKSPACE_SAVED/)
    checks.push("single-delete", "preserve-other-notes")
    if (workspace.generated) {
      assert.equal((await forget(workspace.path, hash(await readFile(workspace.path)))).reason, "not_deletable")
      checks.push("generated-manifest-protected")
    }
    await writeFile(note, "x".repeat(256 * 1024 + 1))
    assert.equal((await forget(note, hash(await readFile(note)))).reason, "changed")
    checks.push("large-delete-refused")
    evidence.push({ scenario: "browser-management", checks })
    console.log(JSON.stringify({ result: "pass", scenario: "browser-management", checks }))
  }
  if (captureStatus && !workEvents.some((event) => event.sessionUpdate === "memory_capture_activity")) {
    captureReport.status = "not_observed"
    evidence.push({ scenario: "capture-status", status: captureReport.status, workEvents })
    console.log(
      JSON.stringify({
        scenario: "capture-status",
        status: "not_observed",
        explanation:
          "Installed Grok emitted flush/Dream updates but no capture diagnostics with the switch explicitly enabled. This is not a capture parity pass.",
      }),
    )
  }
  if (captureStatus && captureReport.status !== "not_observed") {
    assert.ok(
      workEvents.some((event) => event.sessionUpdate === "memory_capture_activity" && event.activity === "no_op"),
      JSON.stringify(workEvents),
    )
    const completed = workEvents.find(
      (event) =>
        event.sessionUpdate === "memory_capture_activity" && event.activity === "completed" && event.memories?.length,
    )
    assert.ok(completed)
    assert.equal(completed.memories[0].body, "OFFICIAL_CAPTURE_DETAIL")
    assert.ok(completed.memories[0].path.startsWith("/"))
    assert.match(await readFile(completed.memories[0].path, "utf8"), /OFFICIAL_DREAM_FACT/)
    captureMode.invalid = true
    const failed = (await connection.newSession({ cwd: original, mcpServers: [] })).sessionId
    Object.assign(planned, { tool: "", sent: true })
    await deadline(
      connection.prompt({
        sessionId: failed,
        prompt: [{ type: "text", text: "Capture malformed extraction separately." }],
      }),
      60_000,
      "official failed capture prompt",
    )
    await deadline(
      connection.extMethod("_x.ai/memory/flush", { session_id: failed }),
      60_000,
      "official failed capture flush",
    )
    await poll(
      () =>
        workEvents.some((event) => event.sessionUpdate === "memory_capture_activity" && event.activity === "failed"),
      "official terminal capture failure",
      60_000,
    )
    const diagnostics = workEvents.filter((event) => event.sessionUpdate === "memory_capture_activity")
    for (const activity of ["queued", "running", "completed", "no_op", "retry", "failed"])
      assert.ok(
        diagnostics.some((event) => event.activity === activity),
        activity,
      )
    assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE_CAPTURE_FAILURE/)
    assert.ok(diagnostics.every((event) => !event.detail))
    captureReport.status = "verified"
    evidence.push({ scenario: "capture-status", diagnostics })
    console.log(
      JSON.stringify({
        scenario: "capture-status",
        checks: ["six-lifecycle-phases", "debug-observation-body-and-path", "failure-content-hidden"],
        diagnostics,
      }),
    )
  }
  if (process.argv.includes("--scan")) {
    assert.ok(workspace.generated, "Scan comparison requires Memory V2")
    const topics = dirname(workspaceFile)
    const seed = async (from, through) => {
      for (let start = from; start < through; start += 128)
        await Promise.all(
          Array.from({ length: Math.min(128, through - start) }, (_, offset) => {
            const name = String(start + offset).padStart(5, "0")
            return writeFile(join(topics, `scan-${name}.md`), `# SCAN_${name}\nSaved topic\n`)
          }),
        )
    }
    await seed(0, 4097)
    console.error("Official scan: seeded 4097 topics; requesting list")
    assert.equal((await listing(first)).files.filter((file) => /scan-\d+\.md$/.test(file.path)).length, 4097)
    console.error("Official scan: 4097-topic listing passed")
    await seed(4097, 10001)
    console.error("Official scan: seeded 10001 topics; requesting capped list")
    assert.equal((await listing(first)).files.length, 10000)
    assert.match(await readFile(join(topics, "scan-10000.md"), "utf8"), /SCAN_10000/)
    evidence.push({
      scenario: "file-scan",
      checks: ["more-than-4096-topics", "10000-file-list-cap", "omitted-files-preserved"],
    })
    console.log(JSON.stringify(evidence.at(-1)))
  }
  if (process.argv.includes("--clear")) {
    child.kill("SIGTERM")
    await deadline(exited, 10_000, "official exit before CLI clear")
    if (workspace.generated) {
      const config = join(home, "config.toml")
      await writeFile(
        config,
        (await readFile(config, "utf8")).replace("[memory_v2]\nenabled = false", "[memory_v2]\nenabled = true"),
      )
    }
    const kept = join(dirname(files.files.find((file) => file.source === "workspace").path), "topics", "keep.md")
    await mkdir(dirname(kept), { recursive: true })
    await writeFile(kept, "OTHER_REPOSITORY_KEEP")
    const large = process.argv.includes("--large")
    if (large) {
      await writeFile(workspaceFile, "# WORKSPACE_SAVED\n" + "界😀".repeat(500000))
      await writeFile(globalFile, "# GLOBAL_PREFERENCE\n" + "界😀".repeat(500000))
      if (workspace.generated) await writeFile(workspace.path, "# OVERSIZED_INDEX\n" + "界😀".repeat(500000))
    }
    const cleared = []
    function clear(args, input = "") {
      const result = spawnSync("grok", ["memory", "clear", ...args], {
        cwd: original,
        env: {
          ...process.env,
          GROK_HOME: home,
          GROK_CONFIG: "",
          GROK_CONFIG_PATH: "",
          GROK_MEMORY: "1",
          XAI_API_KEY: "local-fixture-key",
        },
        input,
        encoding: "utf8",
        timeout: 30_000,
      })
      if (result.error) throw result.error
      cleared.push({ args, code: result.status, stdout: result.stdout, stderr: result.stderr })
      return result
    }
    for (const input of ["n\n", "\n", ""]) {
      const result = clear([], input)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /Cancelled/)
      assert.match(await readFile(workspaceFile, "utf8"), /WORKSPACE_SAVED/)
    }
    assert.notEqual(clear(["--workspace", "--global", "--yes"]).status, 0)
    const global = clear(["--global", "-y"])
    assert.equal(global.status, 0, global.stderr)
    assert.equal(await readFile(globalFile, "utf8").catch(() => undefined), undefined)
    assert.match(await readFile(workspaceFile, "utf8"), /WORKSPACE_SAVED/)
    const local = clear(["--yes"])
    assert.equal(local.status, 0, local.stderr)
    assert.equal(await readFile(workspaceFile, "utf8").catch(() => undefined), undefined)
    if (process.argv.includes("--scan"))
      assert.equal(
        await readFile(join(dirname(workspaceFile), "scan-10000.md"), "utf8").catch(() => undefined),
        undefined,
      )
    assert.equal(await readFile(kept, "utf8"), "OTHER_REPOSITORY_KEEP")
    await mkdir(dirname(workspaceFile), { recursive: true })
    await mkdir(dirname(globalFile), { recursive: true })
    await writeFile(workspaceFile, "NEW_WORKSPACE" + (large ? "界😀".repeat(500000) : ""))
    await writeFile(globalFile, "NEW_GLOBAL" + (large ? "界😀".repeat(500000) : ""))
    const all = clear(["--all"], "YES\n")
    assert.equal(all.status, 0, all.stderr)
    assert.equal(await readFile(workspaceFile, "utf8").catch(() => undefined), undefined)
    assert.equal(await readFile(globalFile, "utf8").catch(() => undefined), undefined)
    assert.equal(await readFile(kept, "utf8"), "OTHER_REPOSITORY_KEEP")
    const empty = clear(["--workspace", "--yes"])
    assert.equal(empty.status, 0, empty.stderr)
    assert.match(empty.stdout, /Nothing to clear/)
    evidence.push({
      scenario: large ? "cli-large-clear" : "cli-clear",
      checks: [
        "decline",
        "default-no",
        "EOF",
        "scope-conflict",
        "global",
        "default-workspace",
        "all",
        "other-repository",
        "empty",
      ],
      commands: cleared,
    })
  }
  console.log(
    JSON.stringify({
      result: captureReport.status === "not_observed" ? "partial" : "pass",
      ...(captureStatus ? { captureDiagnostics: captureReport } : {}),
      directory,
      mode: workspace.generated ? "v2" : "legacy",
      reads: 7,
      ...(flushes.length ? { flushes } : {}),
      ...(dreams.length ? { dreams, dreamModels } : {}),
      ...(retention.checks.length ? { retention: retention.checks } : {}),
      ...(process.argv.includes("--search") ? { retrievalCalls: 6, retrievalTools: ["grep", "read_file"] } : {}),
      scenarios: ["global", "clone", "worktree", "repository-isolation"],
    }),
  )
} finally {
  terminalReview.child?.kill("SIGTERM")
  if (terminalReview.child) {
    await deadline(terminalReview.child.exited, 10_000, "official review terminal cleanup").catch(() =>
      terminalReview.child.kill("SIGKILL"),
    )
    terminalReview.child.terminal?.close()
    await writeFile(join(directory, "memory-review-tui.ansi"), terminalReview.text)
  }
  toggleHold.value?.resolve()
  child.kill("SIGTERM")
  await deadline(exited, 10_000, "official memory cleanup").catch(() => child.kill("SIGKILL"))
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(
    join(directory, "memory-scopes.json"),
    JSON.stringify(
      { evidence, names: [...names], events, workEvents, ...(contexts.length ? { contexts } : {}) },
      null,
      2,
    ),
  )
  await rm(fixture, { recursive: true, force: true })
  console.error(`Official memory evidence: ${directory}`)
}
