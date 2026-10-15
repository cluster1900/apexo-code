// Installed Grok process, isolated Git workspace and provider, actual five-minute lease.
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Readable, Writable } from "node:stream"
import { Database } from "bun:sqlite"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const output = await realpath(await mkdtemp(join(tmpdir(), "apexo-memory-recovery-official-")))
const home = join(output, "home")
const cwd = await mkdtemp(join(resolve(import.meta.dir, "../../.."), ".memory-recovery-test-"))
await mkdir(home)
execFileSync("git", ["init"], { cwd, stdio: "pipe" })
execFileSync("git", ["remote", "add", "origin", "https://example.invalid/isolated/recovery.git"], {
  cwd,
  stdio: "pipe",
})
const calls = [],
  checks = [],
  evidence = [],
  events = [],
  logs = []
const failureOnly = process.argv.includes("--failure-only")
const timeouts = process.argv.includes("--timeouts")
const planned = { hold: !failureOnly, gate: Promise.withResolvers() }
const provider = createServer(async (request, response) => {
  if (request.method !== "POST") {
    response.setHeader("content-type", "application/json")
    return response.end(JSON.stringify({ data: [{ id: "fixture", object: "model" }] }))
  }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  const capture = JSON.stringify(body.messages ?? body.input).includes("Extract durable, reusable observations")
  if (capture) {
    calls.push({ at: Date.now(), body })
    if (planned.hold) await planned.gate.promise
  }
  const content = capture
    ? failureOnly
      ? "INVALID_CAPTURE_OUTPUT"
      : JSON.stringify({
          outcome: "observations",
          observations: [
            {
              type: "project",
              statement: "OFFICIAL_RECOVERY_FACT preserve immutable request IDs",
              topic_hint: "requests",
              keywords: [],
              aliases: [],
              body: null,
            },
          ],
        })
    : "MAIN_RECOVERY_ACK"
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(
    [
      { choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] },
      {
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
    ]
      .map(
        (event) =>
          `data: ${JSON.stringify({ id: "recovery", created: 1, object: "chat.completion.chunk", model: body.model, ...event })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
  )
})
provider.on("error", (error) => {
  throw error
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "Recovery fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture-key"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = true\n[memory_v2]\nenabled = true\nautomatic_dream_enabled = false\n`,
)
const launch = async () => {
  const child = spawn("grok", ["agent", "stdio"], {
    cwd,
    env: {
      ...process.env,
      GROK_HOME: home,
      GROK_CONFIG: "",
      GROK_CONFIG_PATH: "",
      GROK_MEMORY: "1",
      XAI_API_KEY: "local-fixture-key",
    },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })))
  child.stderr.on("data", (chunk) => logs.push(chunk))
  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(params) {
        const option = params.options.find((item) => item.kind === "allow_once")
        assert.ok(option)
        return { outcome: { outcome: "selected", optionId: option.optionId } }
      },
      async sessionUpdate(params) {
        events.push(params)
      },
      async extNotification() {},
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  )
  await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30_000,
    "official initialize",
  )
  return { child, exited, connection }
}
const state = { current: undefined, db: undefined }
const stop = async (signal) => {
  state.current.child.kill(signal)
  return deadline(state.current.exited, 10_000, "official isolated child exit")
}
try {
  state.current = await launch()
  const id = (await state.current.connection.newSession({ cwd, mcpServers: [] })).sessionId
  const listed = await state.current.connection.extMethod("_x.ai/memory/list", { sessionId: id })
  const list = listed.result ?? listed
  assert.equal(list.enabled, true)
  const root = dirname(list.files.find((file) => file.source === "workspace" && file.generated).path)
  const result = await deadline(
    state.current.connection.prompt({
      sessionId: id,
      prompt: [{ type: "text", text: "OFFICIAL_RECOVERY_FACT preserve immutable request IDs." }],
    }),
    30_000,
    "official main turn",
  )
  assert.equal(result.stopReason, "end_turn")
  await poll(() => calls.length === 1, "official extraction held")
  // Grok closes connections between operations; allow SQLite to recreate WAL sidecars.
  // This observer only executes SELECT statements and never edits lease timestamps.
  state.db = new Database(join(root, "memory_state.sqlite"), { readwrite: true, create: false })
  state.db.run("PRAGMA query_only = ON")
  state.db.run("PRAGMA busy_timeout = 5000")
  const row = () => state.db.query("SELECT * FROM capture_jobs WHERE session_id = ?").get(id)
  if (!failureOnly) {
    const claimed = row()
    assert.equal(claimed.status, "running")
    assert.equal(claimed.attempt, 1)
    assert.ok(claimed.lease_expires_at * 1000 - calls[0].at > 285_000)
    evidence.push({ stage: "claimed", job: claimed, exit: await stop("SIGKILL") })
    assert.equal(evidence[0].exit.signal, "SIGKILL")
    assert.deepEqual(row(), claimed)
    planned.hold = false
    planned.gate.resolve()
    checks.push("official-sigkill-preserves-five-minute-lease")
    state.current = await launch()
    await state.current.connection.loadSession({ sessionId: id, cwd, mcpServers: [] })
    if (timeouts) {
      const started = Date.now()
      const result = await deadline(
        state.current.connection.extMethod("_x.ai/memory/flush", { session_id: id }),
        255_000,
        "official real four-minute flush",
      )
      const elapsed = Date.now() - started
      evidence.push({ stage: "flush-timeout", elapsed, result, job: row() })
      assert.equal(result.flushed, false)
      assert.equal(result.disposition, "timed_out")
      assert.ok(elapsed >= 239_000 && elapsed < 255_000)
      assert.deepEqual(row(), claimed)
      assert.equal(calls.length, 1)
      checks.push("official-four-minute-flush-timeout-preserves-lease")
    }
    const progress = setInterval(
      () =>
        console.error(
          `Official actual lease expiry: ${Math.max(0, Math.ceil((claimed.lease_expires_at * 1000 - Date.now()) / 1000))}s`,
        ),
      30_000,
    )
    await poll(
      () => {
        assert.equal(calls.length, 1)
        assert.equal(row().lease_owner, claimed.lease_owner)
        return Date.now() >= claimed.lease_expires_at * 1000
      },
      "official live lease not stolen",
      320_000,
    ).finally(() => clearInterval(progress))
    checks.push("official-live-lease-not-stolen")
    // The official worker exits on a live lease. Flush provides an explicit wake after expiry.
    const flushed = await deadline(
      state.current.connection.extMethod("_x.ai/memory/flush", { session_id: id }),
      30_000,
      "official recovered flush",
    )
    await poll(() => row().status === "completed", "official completed recovery")
    assert.equal(row().attempt, 2)
    assert.equal(calls.length, 2)
    assert.ok(calls[1].at >= claimed.lease_expires_at * 1000)
    assert.equal(calls[1].body.tools?.length ?? 0, 0)
    const cursors = state.db
      .query("SELECT requested_cursor,captured_cursor,indexed_cursor FROM capture_sessions WHERE session_id = ?")
      .get(id)
    assert.deepEqual(cursors, { requested_cursor: 1, captured_cursor: 1, indexed_cursor: 1 })
    assert.equal(
      state.db.query("SELECT COUNT(*) AS n FROM capture_observation_files WHERE job_id = ?").get(claimed.job_id).n,
      1,
    )
    assert.match(await readFile(join(root, "MEMORY.md"), "utf8"), /OFFICIAL_RECOVERY_FACT/)
    evidence.push({ stage: "recovered", job: row(), flushed, cursors })
    checks.push("official-expired-lease-reclaimed", "official-result-indexed-once")
    await state.current.connection.extMethod("_x.ai/memory/flush", { session_id: id })
    assert.equal(calls.length, 2)
    checks.push("official-repeat-flush-does-not-reextract")
    if (timeouts) {
      const timed = (await state.current.connection.newSession({ cwd, mcpServers: [] })).sessionId
      const count = calls.length
      planned.gate = Promise.withResolvers()
      planned.hold = true
      await deadline(
        state.current.connection.prompt({
          sessionId: timed,
          prompt: [{ type: "text", text: "TIMEOUT_CAPTURE_FACT preserve immutable request IDs." }],
        }),
        30_000,
        "official timeout main turn",
      )
      await poll(() => calls.length === count + 1, "official timeout extraction held")
      const result = await deadline(
        state.current.connection.extMethod("_x.ai/memory/flush", { session_id: timed }),
        135_000,
        "official real two-minute extraction",
      )
      const elapsed = Date.now() - calls[count].at
      const timedRow = () => state.db.query("SELECT * FROM capture_jobs WHERE session_id = ?").get(timed)
      evidence.push({ stage: "capture-timeout", elapsed, result, job: timedRow() })
      assert.equal(result.flushed, false)
      assert.equal(result.disposition, "retry_required")
      assert.ok(elapsed >= 119_000 && elapsed < 135_000)
      assert.equal(timedRow().status, "failed")
      assert.equal(timedRow().attempt, 1)
      planned.hold = false
      planned.gate.resolve()
      for (let index = 0; index < 10; index++)
        await state.current.connection.extMethod("_x.ai/memory/list", { sessionId: timed })
      assert.equal(calls.length, count + 1)
      assert.equal(
        state.db.query("SELECT COUNT(*) AS n FROM capture_observation_files WHERE job_id = ?").get(timedRow().job_id).n,
        0,
      )
      const retried = await deadline(
        state.current.connection.extMethod("_x.ai/memory/flush", { session_id: timed }),
        30_000,
        "official explicit timeout retry",
      )
      assert.equal(retried.flushed, true)
      assert.equal(timedRow().attempt, 2)
      assert.equal(calls.length, count + 2)
      assert.equal(
        state.db.query("SELECT COUNT(*) AS n FROM capture_observation_files WHERE job_id = ?").get(timedRow().job_id).n,
        1,
      )
      checks.push(
        "official-two-minute-capture-timeout-requires-retry",
        "official-list-does-not-retry",
        "official-explicit-retry-publishes-once",
      )
    }
  }
  if (failureOnly) {
    await poll(() => row()?.status === "failed", "official first malformed extraction")
    assert.equal(row().attempt, 1)
    assert.equal(
      state.db.query("SELECT captured_cursor FROM capture_sessions WHERE session_id = ?").get(id).captured_cursor,
      0,
    )
    checks.push("official-retryable-failure-not-captured")
    for (const attempt of [2, 3]) {
      const flushed = await deadline(
        state.current.connection.extMethod("_x.ai/memory/flush", { session_id: id }),
        30_000,
        "official failed flush",
      )
      evidence.push({ attempt, job: row(), flushed })
      assert.equal(row().status, "failed")
      assert.equal(row().attempt, attempt)
      assert.equal(flushed.flushed, false)
      assert.equal(flushed.disposition, attempt === 2 ? "retry_required" : "failed")
      assert.equal(flushed.through_turn, 1)
    }
    checks.push("official-flush-reports-retry-required", "official-terminal-failure-not-success")
    assert.equal(calls.length, 3)
    const again = await state.current.connection.extMethod("_x.ai/memory/flush", { session_id: id })
    assert.equal(again.flushed, false)
    assert.equal(again.disposition, "failed")
    assert.equal(calls.length, 3)
    checks.push("official-three-attempt-limit", "official-repeat-terminal-flush-does-not-extract")
  }
  console.log(JSON.stringify({ passed: checks.length, checks, output }, null, 2))
} finally {
  planned.hold = false
  planned.gate.resolve()
  state.db?.close()
  if (state.current)
    await stop("SIGTERM").catch(async () => {
      state.current.child.kill("SIGKILL")
      await state.current.exited
    })
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(output, "evidence.json"), JSON.stringify({ checks, evidence, calls, events }, null, 2))
  await writeFile(join(output, "stderr.log"), Buffer.concat(logs))
  await rm(cwd, { recursive: true, force: true })
  console.error(`Official production recovery evidence: ${output}`)
}
