// Real Bun/Electron server, model, SSE, files and database; no event injection.
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const enabled = !process.argv.includes("--disabled")
const rollout = process.argv.includes("--record-only") ? "record_only" : "active"
const plan = { mode: "observe", hold: undefined, calls: 0 }
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  config: {
    memory_v2: {
      enabled: true,
      rollout,
      automatic_dream_enabled: false,
      ...(enabled ? { capture_status_enabled: true } : {}),
    },
    memory: { dream: { enabled: false }, session: { save_on_end: false } },
    compaction: { auto: false, memory_flush: { enabled: false } },
  },
  async next({ input }) {
    if (!JSON.stringify(input).includes("You extract durable memory observations")) return { content: "CAPTURE_ACK" }
    plan.calls++
    if (plan.hold) await plan.hold.promise
    return {
      content:
        plan.mode === "invalid"
          ? "PRIVATE_CAPTURE_FAILURE"
          : JSON.stringify(
              plan.mode === "noop"
                ? { outcome: "noop", observations: [] }
                : {
                    outcome: "observations",
                    observations: [
                      {
                        type: "project",
                        topic_hint: "status",
                        statement: "CAPTURE_STATUS_FACT",
                        body: "PRIVATE_CAPTURE_DETAIL",
                        keywords: ["status"],
                        aliases: [],
                      },
                    ],
                  },
            ),
    }
  },
})
const all = []
const checks = []
const abort = new AbortController()
let stream
const prompt = (id) =>
  runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Remember durable project conventions." }],
  })
const flush = async (id) => {
  const endpoint = `/experimental/session/${id}/memory/operation`
  await runtime.api(endpoint, { kind: "flush" })
  return poll(
    async () => {
      const result = await runtime.api(endpoint)
      return result?.state === "finished" && result.result
    },
    "flush settles",
    30_000,
  )
}
const events = (id) =>
  all
    .filter((event) => event.type === "memory.capture.activity" && event.properties.sessionID === id)
    .map((event) => event.properties)
try {
  const response = await fetch(`${runtime.url}/event?directory=${encodeURIComponent(runtime.directory)}`, {
    signal: abort.signal,
  })
  assert.ok(response.ok)
  stream = (async () => {
    const decoder = new TextDecoder()
    let pending = ""
    for await (const bytes of response.body) {
      pending += decoder.decode(bytes, { stream: true })
      let boundary
      while ((boundary = pending.indexOf("\n\n")) !== -1) {
        const frame = pending.slice(0, boundary)
        pending = pending.slice(boundary + 2)
        for (const line of frame.split("\n")) if (line.startsWith("data: ")) all.push(JSON.parse(line.slice(6)))
      }
    }
  })().catch((error) => {
    if (!abort.signal.aborted) throw error
  })
  await poll(() => all.some((event) => event.type === "server.connected"), "SSE ready")
  const id = (await runtime.api("/session", { title: "Capture status" })).id
  plan.hold = Promise.withResolvers()
  await prompt(id)
  await poll(() => plan.calls === 1, "capture running")
  if (enabled) {
    await poll(() => events(id).some((event) => event.activity === "running"), "running notification")
    assert.deepEqual(
      events(id).map((event) => event.activity),
      ["queued", "running"],
    )
    assert.equal(events(id)[0].fromTurn, 1)
    assert.equal(events(id)[0].throughTurn, 1)
    assert.equal(events(id)[1].attempt, 1)
    checks.push("queued-running-range-and-attempt")
  }
  assert.equal((await runtime.api("/session/status"))[id], undefined)
  checks.push("diagnostics-do-not-keep-main-session-busy")
  plan.hold.resolve()
  plan.hold = undefined
  assert.equal((await flush(id)).status, "completed")
  if (enabled) {
    await poll(() => events(id).some((event) => event.activity === "completed"), "completion notification")
    const result = events(id).find((event) => event.activity === "completed")
    assert.equal(result.memories[0].statement, "CAPTURE_STATUS_FACT")
    assert.equal(result.memories[0].body, "PRIVATE_CAPTURE_DETAIL")
    assert.match(await readFile(result.memories[0].path, "utf8"), /CAPTURE_STATUS_FACT/)
    assert.ok(result.memories[0].path.startsWith("/"))
    const count = events(id).length
    await flush(id)
    assert.equal(events(id).length, count)
    checks.push("completed-details-match-persisted-file", "repeat-flush-does-not-repeat-notifications")
  }
  assert.doesNotMatch(
    JSON.stringify(await runtime.api(`/session/${id}/message`)),
    /PRIVATE_CAPTURE_DETAIL|memory.capture.activity/,
  )
  checks.push("diagnostics-absent-from-session-transcript")
  plan.mode = "noop"
  await prompt(id)
  await flush(id)
  if (enabled) {
    await poll(() => events(id).some((event) => event.activity === "no_op"), "noop notification")
    assert.equal(events(id).at(-1).memories, undefined)
    checks.push("noop-without-memory-details")
  }
  const failed = (await runtime.api("/session", { title: "Failed capture" })).id
  plan.mode = "invalid"
  await prompt(failed)
  const retries = []
  for (let attempt = 0; attempt < 3; attempt++) {
    retries.push((await flush(failed)).status)
    if (retries.at(-1) === "failed") break
    assert.equal(retries.at(-1), "retry_required")
  }
  assert.equal(retries.at(-1), "failed")
  if (enabled) {
    await poll(() => events(failed).at(-1)?.activity === "failed", "terminal notification")
    assert.deepEqual(
      events(failed).map((event) => event.activity),
      ["queued", "running", "retry", "running", "retry", "running", "failed"],
    )
    assert.deepEqual(
      events(failed)
        .filter((event) => event.activity === "running")
        .map((event) => event.attempt),
      [1, 2, 3],
    )
    assert.doesNotMatch(JSON.stringify(events(failed)), /PRIVATE_CAPTURE_FAILURE|memories|detail/)
    checks.push("three-attempt-retry-failed-order", "failure-excludes-raw-provider-content")
  }
  plan.mode = "observe"
  for (const stop of ["mode", "permission"]) {
    const stopped = (await runtime.api("/session", { title: stop })).id
    plan.hold = Promise.withResolvers()
    const calls = plan.calls
    await prompt(stopped)
    await poll(() => plan.calls > calls, "capture before revocation")
    if (stop === "mode") await runtime.api(`/experimental/session/${stopped}/memory/toggle`, { enabled: false })
    if (stop === "permission")
      await runtime.api(
        `/session/${stopped}`,
        { permission: [{ permission: "read", pattern: "*", action: "deny" }] },
        "PATCH",
      )
    plan.hold.resolve()
    plan.hold = undefined
    if (stop === "permission")
      await poll(
        () => events(stopped).some((event) => event.activity === "failed") || !enabled,
        "permission failure notification",
      )
    await flush(stopped)
    assert.ok(events(stopped).every((event) => !event.memories))
    assert.ok(!events(stopped).some((event) => event.activity === "completed"))
    checks.push(`${stop}-revocation-suppresses-captured-content`)
  }
  if (!enabled) {
    assert.ok(all.every((event) => event.type !== "memory.capture.activity"))
    checks.push("default-disabled-suppresses-all-diagnostics")
  }
  const databases = [...new Bun.Glob("**/*.db").scanSync({ cwd: runtime.env.XDG_DATA_HOME, absolute: true })]
  const main = databases.find((file) => /\/apexo[^/]*\.db$/.test(file))
  assert.ok(main)
  using db = new Database(main, { readonly: true })
  assert.equal(
    db.query("SELECT COUNT(*) AS count FROM event WHERE type LIKE 'memory.capture.activity%'").get().count,
    0,
  )
  checks.push("diagnostics-not-persisted-in-event-replay")
  console.log(JSON.stringify({ enabled, rollout, passed: checks.length, checks, output: runtime.output }, null, 2))
} finally {
  plan.hold?.resolve()
  abort.abort()
  await stream
  await runtime.close()
  await writeFile(
    join(runtime.output, "capture-status.json"),
    JSON.stringify({ checks, events: all.filter((event) => event.type === "memory.capture.activity") }, null, 2),
  )
  console.error(`Capture status evidence: ${runtime.output}`)
}
