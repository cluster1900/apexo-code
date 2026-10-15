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
      const text = [
        body.instructions,
        ...(body.messages ?? body.input ?? [])
          .filter((message) => message.role === "system" || message.role === "developer")
          .flatMap((message) =>
            typeof message.content === "string" ? message.content : message.content.map((part) => part.text ?? ""),
          ),
      ].join("\n")
      if (text.includes("Consolidate durable memory observations")) {
        state.dream++
        assert.deepEqual(body.tools ?? [], [])
        const last = (body.messages ?? body.input).findLast((message) => message.role === "user")
        const input = JSON.parse(
          typeof last.content === "string" ? last.content : last.content.map((part) => part.text ?? "").join(""),
        )
        return {
          content: JSON.stringify({
            operations: [
              {
                action: "create",
                path: `topics/ui-dream-${state.dream}.md`,
                content: "# Operation UI\nMEMORY_OPERATION_DREAM_FACT",
                evidence: input.observations.map((note) => note.path),
              },
            ],
          }),
        }
      }
      if (text.includes("You extract durable memory observations")) {
        state.capture++
        assert.deepEqual(body.tools ?? [], [])
        if (state.hold) await held.promise
        return {
          content: JSON.stringify({
            outcome: "observations",
            observations: [
              {
                type: "project",
                statement: `MEMORY_OPERATION_SOURCE_${state.capture}: original request identity is preserved.`,
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
      return { content: `MEMORY_OPERATION_MAIN_${state.main}` }
    },
  })
  const { runtime } = fixture
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
    const legacy = join(runtime.env.APEXO_TEST_HOME, ".grok", "memory", "MEMORY.md")
    await mkdir(join(runtime.env.APEXO_TEST_HOME, ".grok", "memory"), { recursive: true })
    await writeFile(
      legacy,
      "# Memory\n\n## Curated knowledge\nMEMORY_OPERATION_CARRYOVER: retain the original source.\n",
    )
    const seed = async (text) => {
      await runtime.api(`/api/session/${session.id}/prompt`, { prompt: { text } })
      await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST", 204)
    }
    await seed("Remember original request identity for later consolidation.")
    await poll(
      async () =>
        (await runtime.api(`${root}/operation`)).some(
          (row) => row.kind === "capture" && row.state === "finished" && row.result.status === "completed",
        ),
      "actual automatic capture",
      20000,
    )
    const note = (await runtime.api(`${root}/notes`)).find((note) => note.name !== "MEMORY.md")
    assert.ok(note)
    return {
      ...fixture,
      session,
      other,
      root,
      state,
      seed,
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
