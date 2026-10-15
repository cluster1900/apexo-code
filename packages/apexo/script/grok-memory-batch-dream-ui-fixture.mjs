import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Effect } from "effect"
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
      assert.match(system, /Maintain durable Markdown memory topics/)
      assert.deepEqual(body.tools ?? [], [])
      state.dream++
      const user = messages.findLast((message) => message.role === "user")
      const input = JSON.parse(
        typeof user.content === "string" ? user.content : user.content.map((part) => part.text ?? "").join(""),
      )
      return {
        content: JSON.stringify({
          actions: null,
          plan: {
            edits:
              options.deferred && state.dream > 1
                ? []
                : [
                    {
                      kind: "create",
                      id: "E1",
                      path: "topics/batch-ui.md",
                      content: "# Batch knowledge\nVerified knowledge.\n\n## Fact\nBATCH_DREAM_UI_RESULT",
                    },
                  ],
            outcomes: input.notes.map((note, index) =>
              options.deferred && (state.dream > 1 || index > 0)
                ? { outcome: "deferred", note: note.label, reason: "Needs more context" }
                : { outcome: "applied", note: note.label, edits: ["E1"] },
            ),
          },
        }),
      }
    },
  })
  const { runtime } = fixture
  try {
    const baseURL = JSON.parse(runtime.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
    await writeFile(
      join(runtime.directory, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        memory: { enabled: true, dream: { enabled: false } },
        memory_v2: { enabled: true, batch_dream_enabled: true, automatic_dream_enabled: false, capture_enabled: false },
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
    const scope = { directory: runtime.directory, home: runtime.env.APEXO_TEST_HOME }
    await Effect.runPromise(
      Effect.gen(function* () {
        const memory = yield* MemoryCapture.make(scope)
        yield* memory.remember("BATCH_DREAM_UI_SOURCE", () => true)
        if (options.deferred) yield* memory.remember("BATCH_DREAM_PENDING_SOURCE", () => true)
      }).pipe(Effect.scoped, Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
    )
    const note = { path: join(MemoryV2.directory(scope), "topics/batch-ui.md") }
    return {
      ...fixture,
      session,
      other,
      root,
      state,
      file: note.path,
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
