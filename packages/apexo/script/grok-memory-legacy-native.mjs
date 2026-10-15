// Native legacy Memory acceptance through isolated CLI or rebuilt Desktop backend.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const calls = []
const fixture = await startShellFixture(kind, {
  async next({ body, input }) {
    const system = input
      .filter((item) => item.role === "system")
      .map((item) => (typeof item.content === "string" ? item.content : JSON.stringify(item.content)))
      .join("\n")
    const flush = system.includes("You are a memory assistant extracting durable knowledge")
    calls.push({ kind: flush ? "flush" : "main", system, body })
    if (flush) {
      assert.deepEqual(body.tools ?? [], [])
      return { content: "## Project deployment\nLEGACY_NATIVE_DURABLE_FACT otter deployment uses port 4173." }
    }
    return { content: "The otter deployment uses port 4173." }
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
    "legacy Memory settlement",
    20000,
  )
try {
  const baseURL = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      memory: { enabled: true },
      memory_v2: { enabled: false },
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
  const root = `/api/session/${first.id}/memory`
  const empty = id()
  assert.equal((await request(`${root}/flush`, { id: empty })).backend, "legacy")
  assert.equal((await settled(root, empty)).result.status, "no_work")
  assert.equal(calls.length, 0)
  checks.push("effective-legacy-empty-flush-passive-zero-provider")
  await request(`/api/session/${first.id}/prompt`, {
    prompt: { text: "Remember project otter deployment uses port 4173." },
  })
  await request(`/api/session/${first.id}/wait`, undefined, "POST", 204)
  assert.equal(calls.length, 1)
  const flush = id()
  await request(`${root}/flush`, { id: flush })
  assert.equal((await settled(root, flush)).result.status, "completed")
  assert.equal(calls.filter((item) => item.kind === "flush").length, 1)
  await request(`${root}/operation`)
  await request(`${root}/flush`, { id: flush })
  const retry = id()
  await request(`${root}/flush`, { id: retry, retryOf: flush })
  assert.equal((await settled(root, retry)).result.processed, 0)
  assert.equal(calls.length, 2)
  checks.push("explicit-flush-persists-once-exact-and-explicit-retry-zero-provider")
  const second = await create()
  await request(`/api/session/${second.id}/prompt`, {
    prompt: { text: "Recall project otter deployment port conventions." },
  })
  await request(`/api/session/${second.id}/wait`, undefined, "POST", 204)
  assert.match(calls.at(-1).system, /LEGACY_NATIVE_DURABLE_FACT/)
  assert.equal(calls.length, 3)
  checks.push("initial-recall-in-authoritative-provider-system")
  for (const topic of [
    "Second metadata topic preserves immutable deployment identifiers.",
    "Third metadata topic keeps chronological project checkpoints.",
  ]) {
    await request(`/api/session/${first.id}/prompt`, { prompt: { text: topic } })
    await request(`/api/session/${first.id}/wait`, undefined, "POST", 204)
  }
  const notes = await request(`${root}/notes`)
  const checkpoint = notes.find((note) => note.path.endsWith(`-${first.id}.md`))
  assert.ok(checkpoint, "Actual activity checkpoint is exposed through the native Memory catalog")
  const detail = await request(`${root}/note?path=${encodeURIComponent(checkpoint.path)}`)
  assert.match(detail.content, /3 user, 3 assistant, 0 tool results/)
  assert.match(detail.content, /1\. Remember project otter deployment/)
  assert.match(detail.content, /3\. Third metadata topic/)
  assert.equal(calls.length, 5)
  assert.equal(calls.filter((item) => item.kind === "flush").length, 1)
  checks.push("activity-checkpoint-real-native-note-zero-auxiliary-provider")
  await request(root, { enabled: false }, "PATCH")
  await request(`${root}/flush`, { id: id() }, "POST", 409)
  assert.equal(calls.length, 5)
  checks.push("disabled-flush-zero-provider")
  console.log(
    JSON.stringify(
      {
        result: "pass",
        runtime: kind,
        checks,
        mainCalls: calls.filter((item) => item.kind === "main").length,
        flushCalls: calls.filter((item) => item.kind === "flush").length,
        output: fixture.output,
      },
      null,
      2,
    ),
  )
} finally {
  await writeFile(join(fixture.output, "legacy-provider-calls.json"), JSON.stringify(calls, null, 2))
  await fixture.close()
}
