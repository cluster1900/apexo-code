import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { writeFile } from "node:fs/promises"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const results = []
for (const stage of ["planned", "completed"]) {
  const state = { main: 0, capture: 0, dream: 0 }
  const runtime = await startShellFixture("cli", {
    env: { MEMORY_DREAM_CRASH_STAGE: stage },
    bunArgs: ["--preload", fileURLToPath(new URL("./grok-memory-dream-crash-preload.mjs", import.meta.url))],
    next({ body }) {
      const text = JSON.stringify(body)
      if (text.includes("You extract durable memory observations")) {
        state.capture++
        return {
          content: JSON.stringify({
            outcome: "observations",
            observations: [{ type: "project", statement: "Exact durable Dream proof" }],
          }),
        }
      }
      if (text.includes("Consolidate durable memory observations")) {
        state.dream++
        const last = (body.messages ?? body.input).findLast((message) => message.role === "user")
        const input = JSON.parse(
          typeof last.content === "string" ? last.content : last.content.map((part) => part.text ?? "").join(""),
        )
        return {
          content: JSON.stringify({
            operations: [
              {
                action: "create",
                path: "topics/crash.md",
                content: "Exact durable Dream proof",
                evidence: input.observations.map((note) => note.path),
              },
            ],
          }),
        }
      }
      state.main++
      return { content: "DREAM_CRASH_SOURCE" }
    },
  })
  try {
    const baseURL = JSON.parse(runtime.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
    await writeFile(
      join(runtime.directory, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        memory_v2: { enabled: true, automatic_dream_enabled: false },
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
    const request = async (route, body, method = body === undefined ? "GET" : "POST") => {
      const response = await fetch(new URL(route, runtime.url), {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      })
      const text = await response.text()
      assert.equal(response.status, method === "POST" && route.endsWith("/wait") ? 204 : 200, `${route}: ${text}`)
      return text ? JSON.parse(text) : undefined
    }
    const session = (
      await request("/api/session", {
        location: { directory: runtime.directory },
        model: { providerID: "xai", id: "grok-4.7" },
      })
    ).data
    const root = `/api/session/${session.id}`
    await request(`${root}/prompt`, { prompt: { text: "Remember an actual terminal source" } })
    await request(`${root}/wait`, undefined, "POST")
    await poll(
      async () =>
        (await request(`${root}/memory/operation`)).some(
          (row) => row.kind === "capture" && row.result?.status === "completed",
        ),
      "capture before Dream crash",
      20000,
    )
    const original = `mop_${randomUUID()}`
    await request(`${root}/memory/dream`, { id: original })
    await poll(
      () => Bun.file(join(runtime.env.XDG_STATE_HOME, "dream-crash-checkpoint")).exists(),
      `durable ${stage} checkpoint`,
      20000,
    )
    assert.deepEqual(state, { main: 1, capture: 1, dream: 1 })
    await runtime.crash()
    await runtime.reopen()
    const receipt = await request(`${root}/memory/operation/${original}`)
    assert.equal(receipt.ownership, "unverified")
    await request(`${root}/memory/dream`, { id: original })
    await request(`${root}/memory/operation`)
    assert.deepEqual(state, { main: 1, capture: 1, dream: 1 })
    const retry = `mop_${randomUUID()}`
    await request(`${root}/memory/dream`, { id: retry, retryOf: original })
    const settled = await poll(
      async () => {
        const value = await request(`${root}/memory/operation/${retry}`)
        return value.state === "finished" ? value : undefined
      },
      "exact Dream recovery",
      20000,
    )
    assert.equal(settled.result.status, "completed")
    assert.deepEqual(state, { main: 1, capture: 1, dream: 1 }, "recovery must not repeat inference")
    const note = (await request(`${root}/memory/notes`)).find((note) => note.name === "topics/crash.md")
    assert.ok(note)
    assert.match(
      (await request(`${root}/memory/note?path=${encodeURIComponent(note.path)}`)).content,
      /Exact durable Dream proof/,
    )
    results.push({ stage, checks: 5, ...state, output: runtime.output })
  } finally {
    await runtime.close()
    console.error("Dream crash fixture output:", runtime.output)
  }
}
console.log(JSON.stringify({ result: "pass", results }, null, 2))
