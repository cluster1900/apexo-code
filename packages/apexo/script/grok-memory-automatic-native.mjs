// Automatic legacy Memory acceptance through the real source CLI or rebuilt Desktop backend.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const calls = []
const holds = new Map()
const content = (item) =>
  typeof item?.content === "string" ? item.content : (item?.content ?? []).map((part) => part.text ?? "").join("\n")
const fixture = await startShellFixture(kind, {
  async next({ body, input }) {
    const system = input
      .filter((item) => item.role === "system")
      .map(content)
      .join("\n")
    const user = content(input.findLast((item) => item.role === "user"))
    const flush = system.includes("You are a memory assistant extracting durable knowledge")
    const summary = !system && user.includes("Create a new anchored summary from the conversation history")
    const source = flush ? JSON.parse(user).conversation.join("\n") : user
    const call = { kind: flush ? "flush" : summary ? "summary" : "main", source, system, body }
    calls.push(call)
    if (flush) {
      assert.deepEqual(body.tools ?? [], [])
      const hold = [...holds].find(([marker]) => source.includes(marker))?.[1]
      if (hold) await hold.promise
      if (source.includes("AUTO_EMPTY")) return { content: "NO_REPLY" }
      if (source.includes("AUTO_FAILED")) return { error: { status: 400, message: "Intentional automatic failure" } }
      return { content: "## Project convention\nAUTOMATIC_DURABLE_FACT use bounded queue ownership." }
    }
    if (summary) {
      const hold = [...holds].find(([marker]) => source.includes(marker))?.[1]
      if (hold) await hold.promise
      return { content: "## Objective\nContinue the project.\n## Important Details\nUse bounded queue ownership." }
    }
    return {
      content:
        source.includes("AUTO_COMPACT") || source.includes("AUTO_STOP")
          ? "Project convention " + "context ".repeat(6000)
          : "Use bounded queue ownership.",
    }
  },
})
const checks = []
const request = async (path, body, method = body === undefined ? "GET" : "POST", expected = 200) => {
  const response = await fetch(new URL(path, fixture.url), {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  })
  const text = await response.text()
  assert.equal(response.status, expected, `${method} ${path}: ${text}`)
  return text ? JSON.parse(text) : undefined
}
const create = async () =>
  (
    await request("/api/session", {
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
const root = (session) => `/api/session/${session.id}`
const list = (session) => request(`${root(session)}/memory/operation`)
const receipt = (session, status) =>
  poll(
    async () => (await list(session)).find((item) => item.result?.status === status),
    `automatic ${status} receipt`,
    15000,
  )
const prompt = async (session, text, extra = {}) => {
  const admitted = await request(`${root(session)}/prompt`, { prompt: { text }, ...extra })
  if (extra.resume !== false) await request(`${root(session)}/wait`, undefined, "POST", 204)
  return admitted
}
const disable = (session) => request(`${root(session)}/memory`, { enabled: false }, "PATCH")
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  const baseURL = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      memory: { enabled: true },
      memory_v2: { enabled: false },
      compaction: { memory_flush: { enabled: true, idle_timeout_secs: 1, soft_threshold_tokens: 100000 } },
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      providers: {
        xai: {
          api: { type: "aisdk", package: "@ai-sdk/xai", url: baseURL, settings: { apiKey: "local-fixture" } },
          models: {
            "grok-4.7": {
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  const idle = await create()
  const id = `msg_${randomUUID()}`
  const original = await prompt(idle, "AUTO_IDLE retain the bounded project queue convention.", { id })
  const retried = await request(`${root(idle)}/prompt`, {
    id,
    prompt: { text: "AUTO_IDLE retain the bounded project queue convention." },
  })
  assert.equal(retried.data.id, original.data.id)
  assert.equal(retried.data.admittedSeq, original.data.admittedSeq)
  assert.deepEqual(retried.data.prompt, original.data.prompt)
  const completed = await receipt(idle, "completed")
  assert.equal(completed.backend, "legacy")
  assert.equal(completed.result.processed, 1)
  assert.equal(calls.length, 2)
  await list(idle)
  await request(`${root(idle)}/memory/operation/${completed.id}`)
  await request(`${root(idle)}/memory/flush`, { id: completed.id })
  await pause(1200)
  assert.equal(calls.length, 2)
  checks.push("owned-idle-flush-once-exact-retry-and-passive-reads-zero-provider")
  await disable(idle)

  const pending = await create()
  await prompt(pending, "AUTO_PENDING retain the project queue ownership convention.")
  const beforePending = calls.length
  await prompt(pending, "Fresh input must suppress idle automatic work.", { resume: false })
  await pause(1250)
  assert.equal(calls.length, beforePending)
  assert.deepEqual(await list(pending), [])
  checks.push("admit-only-invalidates-idle-timer-without-model-execution")
  await disable(pending)

  const cancelled = await create()
  holds.set("AUTO_CANCEL", Promise.withResolvers())
  await prompt(cancelled, "AUTO_CANCEL retain bounded ownership while a provider is held.")
  await poll(
    () => calls.find((call) => call.kind === "flush" && call.source.includes("AUTO_CANCEL")),
    "held automatic provider",
  )
  const running = (await list(cancelled))[0]
  assert.equal(running.state, "running")
  await request(`${root(cancelled)}/interrupt`, undefined, "POST", 204)
  assert.equal((await request(`${root(cancelled)}/memory/operation/${running.id}`)).state, "running")
  const beforeCancel = calls.length
  await prompt(cancelled, "Admit a fresh instruction and join old automatic inference.", { resume: false })
  assert.equal((await request(`${root(cancelled)}/memory/operation/${running.id}`)).result.status, "cancelled")
  holds.get("AUTO_CANCEL").resolve()
  assert.equal(calls.length, beforeCancel)
  assert.equal(
    (await request(`${root(cancelled)}/memory/notes`)).some((note) => note.path.includes(cancelled.id)),
    false,
  )
  checks.push("idle-stop-noop-and-new-admission-joins-held-automatic-provider")
  await disable(cancelled)

  const compact = await create()
  await prompt(compact, "AUTO_COMPACT_FIRST retain the first original source.")
  await prompt(compact, "AUTO_COMPACT_SECOND retain the second original source.")
  const beforeCompact = calls.length
  await request(`${root(compact)}/compact`, undefined, "POST", 204)
  await receipt(compact, "completed")
  const compactCalls = calls.slice(beforeCompact)
  assert.equal(compactCalls.filter((call) => call.kind === "summary").length, 1)
  const flushed = compactCalls.filter((call) => call.kind === "flush")
  assert.equal(flushed.length, 1)
  assert.match(flushed[0].source, /AUTO_COMPACT_FIRST/)
  assert.match(flushed[0].source, /AUTO_COMPACT_SECOND/)
  checks.push("actual-compaction-captures-original-source-and-one-flush")
  await disable(compact)

  const stopped = await create()
  await prompt(stopped, "AUTO_STOP_FIRST retain the first original source.")
  await prompt(stopped, "AUTO_STOP_SECOND retain the second original source.")
  holds.set("AUTO_STOP", Promise.withResolvers())
  const stopStart = calls.length
  const compacting = request(`${root(stopped)}/compact`, undefined, "POST", 503)
  await poll(
    () => calls.slice(stopStart).filter((call) => call.kind === "flush" || call.kind === "summary").length === 2,
    "held summary and automatic flush",
  )
  await request(`${root(stopped)}/interrupt`, undefined, "POST", 204)
  await compacting
  await receipt(stopped, "cancelled")
  holds.get("AUTO_STOP").resolve()
  assert.equal(calls.length, stopStart + 2)
  checks.push("accepted-active-stop-joins-compaction-and-automatic-flush")
  await disable(stopped)

  const disabled = await create()
  await prompt(disabled, "AUTO_DISABLED retain the bounded queue convention.")
  const beforeDisable = calls.length
  await disable(disabled)
  await pause(1250)
  assert.equal(calls.length, beforeDisable)
  assert.deepEqual(await list(disabled), [])
  checks.push("disable-revokes-armed-idle-timer-with-zero-transmission")

  for (const [marker, status] of [
    ["AUTO_EMPTY", "no_work"],
    ["AUTO_FAILED", "failed"],
  ]) {
    const session = await create()
    await prompt(session, `${marker} retain the bounded queue convention.`)
    const outcome = await receipt(session, status)
    const count = calls.length
    await request(`${root(session)}/memory/flush`, { id: outcome.id })
    await pause(1200)
    assert.equal(calls.length, count)
    await disable(session)
    checks.push(`persisted-${status}-receipt-exact-retry-zero-provider`)
  }
  const beforeRestart = calls.length
  await fixture.crash()
  await fixture.reopen()
  assert.equal((await request(`${root(idle)}/memory/operation/${completed.id}`)).result.status, "completed")
  await request(`${root(idle)}/memory/operation`)
  await pause(1250)
  assert.equal(calls.length, beforeRestart)
  checks.push("backend-reopen-and-persisted-operation-reads-remain-passive")
  console.log(
    JSON.stringify(
      {
        result: "pass",
        runtime: kind,
        checks,
        counts: Object.fromEntries(
          ["main", "flush", "summary"].map((value) => [value, calls.filter((call) => call.kind === value).length]),
        ),
        output: fixture.output,
      },
      null,
      2,
    ),
  )
} finally {
  for (const hold of holds.values()) hold.resolve()
  await writeFile(join(fixture.output, "automatic-provider-calls.json"), JSON.stringify(calls, null, 2))
  await fixture.close()
}
