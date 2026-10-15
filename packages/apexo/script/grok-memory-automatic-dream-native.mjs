// Native automatic legacy Dream through the real CLI or rebuilt Desktop backend.
import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { MemoryDream } from "@apexo/core/memory-dream"
import { SessionMessage } from "@apexo/core/session/message"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const absent = process.argv.includes("--expect-absent")
const fence = process.argv.includes("--publication-fence")
const failed = process.argv.includes("--failed-source")
if (fence && (process.argv[2] ?? "cli") !== "cli")
  throw new Error("The publication-fence probe requires source CLI Bun preload instrumentation; use CLI for this mode.")
const nextInput = SessionMessage.ID.create()
const calls = []
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  ...(fence
    ? {
        env: {
          AUTOMATIC_DREAM_FENCE_INPUT: nextInput,
          AUTOMATIC_DREAM_FENCE_NEGATIVE: process.argv.includes("--without-fence") ? "1" : "0",
        },
        bunArgs: [
          "--preload",
          fileURLToPath(new URL("./grok-memory-automatic-dream-fence-preload.mjs", import.meta.url)),
        ],
      }
    : {}),
  next({ body }) {
    const messages = body.messages ?? body.input ?? []
    const system = [
      body.instructions ?? "",
      ...messages
        .filter((message) => ["system", "developer"].includes(message.role))
        .map((message) =>
          typeof message.content === "string"
            ? message.content
            : message.content.map((part) => part.text ?? "").join(""),
        ),
    ].join("\n")
    const dream = system.includes("You are a memory assistant consolidating session logs")
    calls.push({ kind: dream ? "dream" : "turn", system, body })
    if (dream) {
      assert.deepEqual(body.tools ?? [], [])
      const user = messages.findLast((message) => message.role === "user")
      const text =
        typeof user.content === "string" ? user.content : user.content.map((part) => part.text ?? "").join("")
      assert.match(text, /AUTOMATIC_DREAM_SOURCE/)
      assert.ok(!text.includes("CURRENT_SESSION_EXCLUDED"))
      return {
        content: failed
          ? "Invalid Dream response without Markdown headings"
          : "## Durable knowledge\nAUTOMATIC_DREAM_SOURCE remains useful.",
      }
    }
    return { content: "The live task is complete." }
  },
})
const checks = []
const request = async (route, body, method = body === undefined ? "GET" : "POST", expected = 200) => {
  const response = await fetch(new URL(route, runtime.url), {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  })
  const text = await response.text()
  assert.equal(response.status, expected, `${route}: ${text}`)
  return text ? JSON.parse(text) : undefined
}
try {
  const baseURL = JSON.parse(runtime.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
  await writeFile(
    join(runtime.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      memory: { enabled: true, dream: { enabled: true, min_hours: 0, min_sessions: 1, check_interval_secs: 1 } },
      memory_v2: { enabled: false },
      compaction: { memory_flush: { enabled: false } },
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      providers: {
        xai: {
          api: { type: "aisdk", package: "@ai-sdk/xai", url: baseURL, settings: { apiKey: "fixture" } },
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
  const session = (
    await request("/api/session", {
      location: { directory: runtime.directory },
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  const root = `/api/session/${session.id}/memory`
  const files = MemoryDream.paths({ directory: runtime.directory, home: runtime.env.APEXO_TEST_HOME })
  await mkdir(files.sessions, { recursive: true })
  await writeFile(join(files.sessions, "2026-10-15-other.md"), "## Source\nAUTOMATIC_DREAM_SOURCE")
  await writeFile(join(files.sessions, `2026-10-15-${session.id}.md`), "CURRENT_SESSION_EXCLUDED")
  assert.deepEqual(await request(`${root}/operation`), [])
  assert.equal(calls.length, 0)
  checks.push("creation-and-passive-list-do-not-arm-Dream")
  const input = { id: SessionMessage.ID.create(), prompt: { text: "Complete this live task." } }
  await request(`/api/session/${session.id}/prompt`, input)
  await request(`/api/session/${session.id}/wait`, undefined, "POST", 204)
  if (fence) {
    const checkpoint = join(runtime.env.XDG_STATE_HOME, "automatic-dream-before-publication")
    const release = join(runtime.env.XDG_STATE_HOME, "automatic-dream-release-publication")
    const admitted = join(runtime.env.XDG_STATE_HOME, "automatic-dream-new-input-admitted")
    await poll(() => Bun.file(checkpoint).exists(), "validated publication observer", 15000)
    const input = request(`/api/session/${session.id}/prompt`, {
      id: nextInput,
      resume: false,
      prompt: { text: "New instruction after publication starts" },
    })
    const observed = await poll(
      async () => {
        if (await Bun.file(admitted).exists()) return "admitted-before-publication"
        return undefined
      },
      "new input must remain behind publication fence",
      750,
    ).catch(() => "not-admitted")
    await writeFile(release, "release actual publication")
    await input
    const receipt = await poll(
      async () => (await request(`${root}/operation`)).find((row) => row.kind === "dream" && row.state === "finished"),
      "fenced Dream completion",
      15000,
    )
    const evidence = {
      observed,
      result: receipt.result,
      memory: await readFile(files.file, "utf8"),
      admitted: await Bun.file(admitted).exists(),
    }
    await writeFile(join(runtime.output, "publication-order.json"), JSON.stringify(evidence, null, 2))
    assert.equal(evidence.observed, "not-admitted", "new durable input overtook automatic publication")
    assert.equal(evidence.admitted, true)
    assert.match(evidence.memory, /AUTOMATIC_DREAM_SOURCE/)
    assert.equal(calls.length, 2)
    checks.push("actual-durable-input-insert-orders-after-already-started-publication")
  } else if (absent) {
    await Bun.sleep(1250)
    assert.equal(calls.filter((call) => call.kind === "dream").length, 0)
    assert.deepEqual(await request(`${root}/operation`), [])
    checks.push("before-feature-live-activity-and-periodic-window-remain-without-Dream")
  } else if (failed) {
    const first = await poll(
      async () => (await request(`${root}/operation`)).find((row) => row.kind === "dream" && row.state === "finished"),
      "failed automatic Dream",
      15000,
    )
    assert.equal(first.result.status, "failed")
    assert.equal(calls.length, 2)
    await runtime.crash()
    await runtime.reopen()
    await request(`${root}/operation`)
    await request(`/api/session/${session.id}/prompt`, input)
    await Bun.sleep(1250)
    assert.equal(calls.length, 2)
    checks.push("failed-source-passive-restart-and-exact-retry-do-not-call-provider")
    // Destination drift cannot manufacture a new automatic source identity.
    await writeFile(files.file, "## Foreign destination\nPreserve these operator bytes.")
    await request(`/api/session/${session.id}/prompt`, {
      prompt: { text: "Complete a new live task without resampling failed source." },
    })
    await request(`/api/session/${session.id}/wait`, undefined, "POST", 204)
    await Bun.sleep(1250)
    assert.equal(calls.length, 3)
    assert.equal(calls.filter((call) => call.kind === "dream").length, 1)
    assert.deepEqual(
      (await request(`${root}/operation`)).filter((row) => row.kind === "dream").map((row) => row.id),
      [first.id],
    )
    assert.equal(await readFile(files.file, "utf8"), "## Foreign destination\nPreserve these operator bytes.")
    checks.push("new-activity-periodic-ticks-and-destination-drift-do-not-resample-failed-source")
  } else {
    const first = await poll(
      async () => (await request(`${root}/operation`)).find((row) => row.kind === "dream" && row.state === "finished"),
      "automatic Dream",
      15000,
    )
    assert.equal(first.backend, "legacy")
    assert.equal(first.result.status, "completed")
    assert.match(await readFile(files.file, "utf8"), /AUTOMATIC_DREAM_SOURCE/)
    assert.equal(calls.filter((call) => call.kind === "dream").length, 1)
    checks.push("completed-live-activity-arms-legacy-Dream-with-flush-disabled")
    await request(`/api/session/${session.id}/prompt`, input)
    assert.equal(calls.length, 2)
    await writeFile(join(files.sessions, "2026-10-15-later.md"), "## Later\nAUTOMATIC_DREAM_SOURCE_LATER")
    const second = await poll(
      async () =>
        (await request(`${root}/operation`)).find(
          (row) => row.kind === "dream" && row.id !== first.id && row.state === "finished",
        ),
      "periodic Dream",
      15000,
    )
    assert.equal(second.result.status, "completed")
    assert.equal(calls.filter((call) => call.kind === "dream").length, 2)
    assert.equal(calls.filter((call) => call.kind === "turn").length, 1)
    checks.push("exact-prompt-retry-preserves-epoch-and-periodic-check-finds-new-source")
    await runtime.crash()
    await writeFile(join(files.sessions, "2026-10-15-after-restart.md"), "## Restart\nAUTOMATIC_DREAM_SOURCE_RESTART")
    await runtime.reopen()
    await request(`${root}/operation`)
    await request(`/api/session/${session.id}/prompt`, input)
    await Bun.sleep(1250)
    assert.equal(calls.length, 3)
    checks.push("restart-passive-list-and-exact-prompt-retry-do-not-rearm-timer")
    await request(`/api/session/${session.id}/prompt`, { prompt: { text: "Complete a genuinely new live task." } })
    await request(`/api/session/${session.id}/wait`, undefined, "POST", 204)
    const third = await poll(
      async () =>
        (await request(`${root}/operation`)).find(
          (row) => row.kind === "dream" && ![first.id, second.id].includes(row.id) && row.state === "finished",
        ),
      "new live activity Dream",
      15000,
    )
    assert.equal(third.result.status, "completed")
    assert.equal(calls.filter((call) => call.kind === "dream").length, 3)
    assert.equal(calls.filter((call) => call.kind === "turn").length, 2)
    checks.push("new-post-restart-live-activity-arms-new-source-without-replaying-old-receipts")
  }
  console.log(
    JSON.stringify({
      result: "pass",
      kind: process.argv[2] ?? "cli",
      absent,
      checks,
      providerCalls: calls.length,
      dreamCalls: calls.filter((call) => call.kind === "dream").length,
      output: runtime.output,
    }),
  )
} finally {
  if (fence)
    await writeFile(join(runtime.env.XDG_STATE_HOME, "automatic-dream-release-publication"), "cleanup").catch(() => {})
  await runtime.close()
  console.error(`Automatic Dream evidence: ${runtime.output}`)
}
