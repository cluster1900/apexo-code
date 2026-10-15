// Real native lifecycle through CLI or the coordinated Desktop backend. All state and providers are isolated.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const held = Promise.withResolvers()
const state = { main: 0, extraction: 0, hold: false }
const fixture = await startShellFixture(kind, {
  async next({ body }) {
    if (!JSON.stringify(body).includes("You extract durable memory observations")) {
      state.main++
      return { content: "The deployment target is staging. NATIVE_LIFECYCLE_SOURCE" }
    }
    state.extraction++
    assert.deepEqual(body.tools ?? [], [])
    if (state.hold) await held.promise
    return {
      content: JSON.stringify(
        state.extraction === 1
          ? {
              outcome: "observations",
              observations: [
                {
                  type: "project",
                  statement: "NATIVE_LIFECYCLE_FACT: The deployment target is staging.",
                  topic_hint: null,
                  keywords: ["deployment"],
                  aliases: [],
                  body: null,
                },
              ],
            }
          : { outcome: "noop", observations: [] },
      ),
    }
  },
})
const checks = []
const operationID = () => `mop_${randomUUID()}`
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
const settled = (root, id) =>
  poll(
    async () => {
      const value = await request(`${root}/operation/${id}`)
      return value.state === "finished" ? value : undefined
    },
    "native Memory operation settlement",
    20000,
  )
try {
  const baseURL = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      memory_v2: { enabled: true },
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
  const create = async () =>
    (
      await request("/api/session", {
        location: { directory: fixture.directory },
        model: { providerID: "xai", id: "grok-4.7" },
      })
    ).data
  const first = await create()
  const firstRoot = `/api/session/${first.id}/memory`
  assert.deepEqual(await request(`${firstRoot}/operation`), [])
  const empty = operationID()
  await request(`${firstRoot}/flush`, { id: empty })
  assert.equal((await settled(firstRoot, empty)).result.status, "no_work")
  assert.equal(state.main + state.extraction, 0)
  await request(`${firstRoot}/operation/${operationID()}`, undefined, "GET", 404)
  checks.push("empty-flush-and-passive-receipts-zero-provider")
  await request(`/api/session/${first.id}/prompt`, { prompt: { text: "Remember our deployment target." } })
  await request(`/api/session/${first.id}/wait`, undefined, "POST", 204)
  const automatic = (await request(`${firstRoot}/operation`)).find((item) => item.kind === "capture")
  assert.ok(automatic)
  assert.equal((await settled(firstRoot, automatic.id)).result.status, "completed")
  const notes = await request(`${firstRoot}/notes`)
  const observations = notes.filter((item) => item.path.includes("/observations/_inbox/"))
  assert.equal(observations.length, 1)
  assert.ok(notes.some((item) => item.name === "MEMORY.md"))
  const detail = await request(`${firstRoot}/note?path=${encodeURIComponent(observations[0].path)}`)
  assert.match(detail.content, /NATIVE_LIFECYCLE_FACT/)
  assert.equal(state.main, 1)
  assert.equal(state.extraction, 1)
  const repeat = operationID()
  await request(`${firstRoot}/flush`, { id: repeat })
  assert.equal((await settled(firstRoot, repeat)).result.processed, 0)
  await request(`${firstRoot}/flush`, { id: repeat })
  assert.equal(state.extraction, 1)
  checks.push("automatic-terminal-capture-published-and-flush-deduplicates")

  const second = await create()
  const root = `/api/session/${second.id}/memory`
  await request(root, { enabled: false }, "PATCH")
  await request(`/api/session/${second.id}/prompt`, { prompt: { text: "A second durable source for crash recovery." } })
  await request(`/api/session/${second.id}/wait`, undefined, "POST", 204)
  await request(root, { enabled: true }, "PATCH")
  state.hold = true
  const interrupted = operationID()
  await request(`${root}/flush`, { id: interrupted })
  await poll(() => state.extraction === 2, "held extraction entered", 20000)
  assert.equal((await request(`${root}/operation/${interrupted}`)).state, "running")
  await fixture.crash()
  await fixture.reopen()
  const recovered = await request(`${root}/operation/${interrupted}`)
  assert.equal(recovered.state, "running")
  assert.equal(recovered.ownership, "unverified")
  await request(`${root}/operation`)
  await request(`${root}/operation/${interrupted}/cancel`, undefined, "POST", 409)
  await request(`${root}/flush`, { id: interrupted })
  assert.equal(state.extraction, 2)
  checks.push("crash-restart-list-exact-retry-do-not-wake-or-guess-owner-dead")
  state.hold = false
  held.resolve()
  const retry = operationID()
  await request(`${root}/flush`, { id: retry, retryOf: interrupted })
  const retried = await settled(root, retry)
  assert.equal(retried.result.status, "completed")
  assert.equal(state.extraction, 3)
  await request(`${root}/flush`, { id: retry, retryOf: interrupted })
  assert.equal(state.extraction, 3)
  await request(`${root}/flush`, { id: retry }, "POST", 409)
  checks.push("explicit-retry-recovers-exact-owned-lease-once-after-crash")
  assert.deepEqual(
    (await request(`${firstRoot}/notes`))
      .filter((item) => item.path.includes("/observations/_inbox/"))
      .map((item) => item.path),
    observations.map((item) => item.path),
  )
  assert.equal(state.main, 2)
  checks.push("earlier-published-note-preserved-with-no-main-session-replay")
  console.log(
    JSON.stringify(
      {
        result: "pass",
        runtime: kind,
        checks,
        mainCalls: state.main,
        extractionCalls: state.extraction,
        output: fixture.output,
      },
      null,
      2,
    ),
  )
} finally {
  held.resolve()
  await fixture.close()
  console.error(`Memory fixture output: ${fixture.output}`)
}
