// Real native Memory routes and tool transcript through CLI or packaged Desktop; local provider only.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const calls = []
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next({ input, body, ancillary }) {
    if (ancillary) return { content: "Memory fixture" }
    calls.push(body.tools.map((item) => item.function?.name ?? item.name))
    const outputs = input.filter((item) => item.role === "tool" || item.type === "function_call_output")
    if (!outputs.length)
      return { tool: "memory", args: { operation: "remember", content: "NATIVE_MEMORY_ACCEPTANCE_FACT" } }
    if (outputs.length === 1)
      return { tool: "memory_search", args: { query: "NATIVE_MEMORY_ACCEPTANCE_FACT", min_score: 0 } }
    return { content: "NATIVE_MEMORY_COMPLETE" }
  },
})
const checks = []
try {
  const baseURL = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
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
    await fixture.api("/api/session", {
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  const route = `/api/session/${session.id}/memory`
  const request = async (suffix = "", body, method = body ? "PATCH" : "GET", expected = 200) => {
    const url = new URL(route + suffix, fixture.url)
    url.searchParams.set("directory", fixture.directory)
    const response = await fetch(url, {
      method,
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    })
    const text = await response.text()
    assert.equal(response.status, expected, text)
    return text ? JSON.parse(text) : undefined
  }
  assert.equal((await request()).enabled, false)
  await request("/notes", undefined, "GET", 403)
  assert.equal((await request("", { enabled: true })).enabled, true)
  assert.deepEqual(await request("/notes"), [])
  assert.equal(calls.length, 0)
  checks.push("default-off-and-passive-management")
  await fixture.api(`/api/session/${session.id}/prompt`, {
    prompt: { text: "Remember and retrieve the fixture fact." },
  })
  const messages = await poll(
    async () => {
      const url = new URL(`/api/session/${session.id}/message`, fixture.url)
      url.searchParams.set("order", "asc")
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
      assert.equal(response.status, 200)
      const data = (await response.json()).data
      return data.some(
        (item) =>
          item.type === "assistant" &&
          item.content.some((part) => part.type === "text" && part.text === "NATIVE_MEMORY_COMPLETE"),
      )
        ? data
        : undefined
    },
    "native Memory completed transcript",
    20000,
  )
  const tools = messages.flatMap((item) =>
    item.type === "assistant" ? item.content.filter((part) => part.type === "tool") : [],
  )
  assert.deepEqual(
    tools.map((item) => [item.name, item.state.status]),
    [
      ["memory", "completed"],
      ["memory_search", "completed"],
    ],
  )
  assert.equal(calls.length, 3)
  assert.ok(calls[0].includes("memory_get"))
  checks.push("three-owned-provider-turns-and-native-tool-parts")
  const notes = await request("/notes")
  assert.equal(notes.length, 1)
  const note = await request(`/note?path=${encodeURIComponent(notes[0].path)}`)
  assert.match(note.content, /NATIVE_MEMORY_ACCEPTANCE_FACT/)
  await request("/note", { path: note.path, hash: "0".repeat(64) }, "DELETE", 409)
  assert.equal(await request("/note", { path: note.path, hash: note.hash }, "DELETE"), true)
  assert.deepEqual(await request("/notes"), [])
  await request("", { enabled: false })
  checks.push("catalog-preview-hash-forget-disable-without-provider-work")
  await fixture.crash()
  await fixture.reopen()
  assert.equal((await request()).enabled, false)
  assert.equal(calls.length, 3)
  checks.push("durable-mode-on-restart-without-provider-wake")
  console.log(
    JSON.stringify(
      {
        result: "pass",
        runtime: process.argv[2] ?? "cli",
        checks,
        providerCalls: calls.length,
        output: fixture.output,
      },
      null,
      2,
    ),
  )
} finally {
  await fixture.close()
}
