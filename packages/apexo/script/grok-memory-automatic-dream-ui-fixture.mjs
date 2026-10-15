import { MemoryDream } from "@apexo/core/memory-dream"
import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startPlanUiFixture } from "./grok-plan-ui-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"

export async function startMemoryOperationUiFixture(options = {}) {
  const held = Promise.withResolvers()
  const state = { main: 0, capture: 0, dream: 0, hold: false }
  const fixture = await startPlanUiFixture({
    runtime: options.runtime,
    mixed: options.mixed,
    async next({ body }) {
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
      if (!system.includes("You are a memory assistant consolidating session logs")) {
        state.main++
        return { content: "AUTOMATIC_DREAM_LIVE_TASK_COMPLETE" }
      }
      assert.deepEqual(body.tools ?? [], [])
      state.dream++
      return { content: "## Legacy knowledge\nLEGACY_DREAM_UI_RESULT" }
    },
  })
  const { runtime } = fixture
  try {
    const baseURL = JSON.parse(runtime.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
    await writeFile(
      join(runtime.directory, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        memory: { enabled: true, dream: { enabled: true, min_hours: 0, min_sessions: 1, check_interval_secs: 1 } },
        compaction: { memory_flush: { enabled: false } },
        memory_v2: { enabled: false },
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
    runtime.api = async (path, body, method = body === undefined ? "GET" : "POST", expected = 200) => {
      const url = new URL(path, runtime.url)
      url.searchParams.set("location[directory]", runtime.directory)
      const response = await fetch(url, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      })
      const text = await response.text()
      assert.equal(response.status, expected, text)
      return text ? JSON.parse(text) : undefined
    }
    const create = async () =>
      (
        await runtime.api("/api/session", {
          location: { directory: runtime.directory },
          agent: "build",
          model: { providerID: "xai", id: "grok-4.7" },
        })
      ).data
    const session = await create()
    const other = await create()
    const root = `/api/session/${session.id}/memory`
    const files = MemoryDream.paths({ directory: runtime.directory, home: runtime.env.APEXO_TEST_HOME })
    await mkdir(files.sessions, { recursive: true })
    await writeFile(files.file, "## Prior\nLEGACY_DREAM_PRIOR")
    await writeFile(join(files.sessions, "other.md"), "## Source\nLEGACY_DREAM_SOURCE")
    const note = { path: files.file }
    return {
      ...fixture,
      session,
      other,
      root,
      state,
      file: note.path,
      addSource: () => writeFile(join(files.sessions, "later.md"), "## Later\nLEGACY_DREAM_SOURCE_LATER"),
      release: () => held.resolve(),
      records: async () =>
        (await readFile(fixture.records, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      close: async () => {
        held.resolve()
        await fixture.close()
      },
    }
  } catch (error) {
    held.resolve()
    await fixture.close()
    throw error
  }
}
