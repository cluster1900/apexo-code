// Actual Apexo native batch Dream/migration ownership through CLI or the coordinated Desktop backend.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const kind = process.argv[2] ?? "cli"
const held = Promise.withResolvers()
const state = { main: 0, capture: 0, dream: 0, hold: false }
const fixture = await startShellFixture(kind, {
  async next({ body }) {
    const text = JSON.stringify(body)
    if (text.includes("Maintain durable Markdown memory topics")) {
      state.dream++
      assert.deepEqual(body.tools ?? [], [])
      const messages = body.messages ?? body.input
      const last = messages.findLast((message) => message.role === "user")
      const input = JSON.parse(
        typeof last.content === "string" ? last.content : last.content.map((part) => part.text ?? "").join(""),
      )
      if (state.hold) await held.promise
      return {
        content: JSON.stringify({
          actions: null,
          plan: {
            edits: [
              {
                kind: "create",
                id: "E1",
                path: `topics/dream-${state.dream}.md`,
                content:
                  "# Durable knowledge\nRequest identity invariants.\n\n## Identity\nNATIVE_DREAM_FACT: requests retain their original identity.",
              },
            ],
            outcomes: input.notes.map((note) => ({ outcome: "applied", note: note.label, edits: ["E1"] })),
          },
        }),
      }
    }
    if (text.includes("You extract durable memory observations")) {
      state.capture++
      assert.deepEqual(body.tools ?? [], [])
      return {
        content: JSON.stringify({
          outcome: "observations",
          observations: [
            {
              type: "project",
              statement: `NATIVE_DREAM_SOURCE_${state.capture}: requests retain original identity.`,
              topic_hint: null,
              keywords: [],
              aliases: [],
              body: null,
            },
          ],
        }),
      }
    }
    state.main++
    return { content: `NATIVE_DREAM_MAIN_${state.main}` }
  },
})
const checks = []
const id = () => `mop_${randomUUID()}`
const request = async (path, body, method = body === undefined ? "GET" : "POST", expected = 200) => {
  const response = await fetch(new URL(path, fixture.url), {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  })
  const text = await response.text()
  assert.equal(response.status, expected, `${method} ${path}: ${text}`)
  return text ? JSON.parse(text) : undefined
}
const settled = (root, operation) =>
  poll(
    async () => {
      const value = await request(`${root}/operation/${operation}`)
      return value.state === "finished" ? value : undefined
    },
    "Memory operation settled",
    20000,
  )
try {
  const baseURL = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      memory_v2: { enabled: true, automatic_dream_enabled: false, batch_dream_enabled: true },
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
  const session = (
    await request("/api/session", {
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  const root = `/api/session/${session.id}/memory`
  const empty = id()
  await request(`${root}/dream`, { id: empty })
  assert.equal((await settled(root, empty)).result.status, "no_work")
  assert.equal(state.main + state.capture + state.dream, 0)
  checks.push("empty-and-passive-no-provider")
  await request(`/api/session/${session.id}/prompt`, { prompt: { text: "Remember request identity." } })
  await request(`/api/session/${session.id}/wait`, undefined, "POST", 204)
  await poll(
    async () => {
      const rows = await request(`${root}/operation`)
      return rows.some((row) => row.kind === "capture" && row.state === "finished" && row.result.status === "completed")
    },
    "terminal capture",
    20000,
  )
  const first = id()
  await request(`${root}/dream`, { id: first })
  assert.equal((await settled(root, first)).result.status, "completed")
  assert.equal(state.dream, 1)
  const topic = (await request(`${root}/notes`)).find((note) => note.name === "topics/dream-1.md")
  assert.ok(topic)
  assert.match((await request(`${root}/note?path=${encodeURIComponent(topic.path)}`)).content, /NATIVE_DREAM_FACT/)
  await request(`${root}/dream`, { id: first })
  assert.equal(state.dream, 1)
  checks.push("manual-dream-publishes-topic-and-exact-retry-passive")
  await request(`/api/session/${session.id}/prompt`, { prompt: { text: "Another fact to consolidate." } })
  await request(`/api/session/${session.id}/wait`, undefined, "POST", 204)
  await poll(() => state.capture === 2, "second capture", 20000)
  await poll(
    async () => {
      const rows = await request(`${root}/operation`)
      return rows.filter((row) => row.kind === "capture" && row.state === "finished").length === 2
    },
    "second capture settled",
    20000,
  )
  state.hold = true
  const interrupted = id()
  await request(`${root}/dream`, { id: interrupted })
  await poll(() => state.dream === 2, "held Dream provider", 20000)
  await fixture.crash()
  await fixture.reopen()
  assert.equal((await request(`${root}/operation/${interrupted}`)).ownership, "unverified")
  await request(`${root}/dream`, { id: interrupted })
  await request(`${root}/operation`)
  assert.equal(state.dream, 2)
  await request(`${root}/operation/${interrupted}/cancel`, undefined, "POST", 409)
  checks.push("crash-restart-status-exact-retry-no-provider")
  state.hold = false
  held.resolve()
  const retry = id()
  await request(`${root}/dream`, { id: retry, retryOf: interrupted })
  assert.equal((await settled(root, retry)).result.status, "completed")
  assert.equal(state.dream, 3)
  assert.equal(state.main, 2)
  checks.push("explicit-original-claim-recovery-without-main-replay")
  const legacy = join(fixture.env.APEXO_TEST_HOME, ".grok", "memory", "MEMORY.md")
  await mkdir(join(fixture.env.APEXO_TEST_HOME, ".grok", "memory"), { recursive: true })
  const original =
    "# Memory\n\n## Curated knowledge\nNATIVE_CARRYOVER_FACT: durable source history remains unchanged.\n"
  await writeFile(legacy, original)
  const preview = await request(`${root}/migration?kind=carryover&scope=global`)
  assert.equal(preview.available, true)
  const before = { ...state }
  const migration = id()
  await request(`${root}/migration`, { id: migration, preview })
  assert.equal((await settled(root, migration)).result.status, "completed")
  await request(`${root}/migration`, { id: migration, preview })
  assert.equal(await readFile(legacy, "utf8"), original)
  const imported = (await request(`${root}/notes`)).find(
    (note) => note.source === "global" && note.name.startsWith("topics/legacy-"),
  )
  assert.ok(imported)
  assert.match(
    (await request(`${root}/note?path=${encodeURIComponent(imported.path)}`)).content,
    /NATIVE_CARRYOVER_FACT/,
  )
  assert.deepEqual(state, before)
  checks.push("explicit-curated-migration-source-preserved-deduplicated-zero-provider")
  await fixture.crash()
  await fixture.reopen()
  await request(`${root}/migration`, { id: migration, preview })
  await request(`${root}/dream`, { id: retry, retryOf: interrupted })
  assert.deepEqual(state, before)
  checks.push("settled-dream-migration-reload-remains-passive")
  console.log(
    JSON.stringify(
      {
        result: "pass",
        runtime: kind,
        checks,
        mainCalls: state.main,
        captureCalls: state.capture,
        dreamCalls: state.dream,
        output: fixture.output,
      },
      null,
      2,
    ),
  )
} finally {
  held.resolve()
  await fixture.close()
  console.error(`Dream fixture output: ${fixture.output}`)
}
