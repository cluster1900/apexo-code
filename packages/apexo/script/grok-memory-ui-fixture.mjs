// Real native Sessions and Memory tools; local provider only. No fabricated API responses.
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startPlanUiFixture } from "./grok-plan-ui-fixture.mjs"

export async function startMemoryUiFixture(options = {}) {
  const fixture = await startPlanUiFixture({
    mixed: options.mixed,
    runtime: options.runtime,
    next({ text, finished, ancillary }) {
      if (ancillary) return { content: "Memory management fixture" }
      if (text.includes("MEMORY_MANAGED_CHILD")) return { content: "MANAGED_CHILD_DONE" }
      if (!finished && text.includes("MEMORY_TASK_PARENT"))
        return {
          tool: "task",
          args: { description: "Memory authority fixture", prompt: "MEMORY_MANAGED_CHILD", subagent_type: "helper" },
        }
      if (!finished && text.includes("MEMORY_SEED"))
        return { tool: "memory", args: { operation: "remember", content: "# Memory UI\nMEMORY_UI_ORIGINAL_中文\n" } }
      return { content: "MEMORY_UI_DONE" }
    },
  })
  const { runtime, repo, close } = fixture
  const legacy = JSON.parse(runtime.env.APEXO_CONFIG_CONTENT)
  await writeFile(
    join(runtime.directory, "apexo.json"),
    JSON.stringify({
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      agents: { helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
      providers: {
        xai: {
          api: {
            type: "aisdk",
            package: "@ai-sdk/xai",
            url: legacy.provider.xai.options.baseURL,
            settings: { apiKey: "fixture" },
          },
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
  try {
    runtime.api = async (path, body, method = body ? "POST" : "GET", expected = 200) => {
      const url = new URL(path, runtime.url)
      url.searchParams.set("location[directory]", runtime.directory)
      const response = await fetch(url, {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
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
    const mode = (enabled) => runtime.api(`/api/session/${session.id}/memory`, { enabled }, "PATCH")
    await mode(true)
    await runtime.api(`/api/session/${session.id}/prompt`, { prompt: { text: "MEMORY_SEED" } })
    await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST", 204)
    const notes = await runtime.api(`/api/session/${session.id}/memory/notes`)
    assert.equal(notes.length, 1)
    const file = notes[0].path
    assert.match(await readFile(file, "utf8"), /MEMORY_UI_ORIGINAL/)
    await mode(false)
    const parent = await create()
    await runtime.api(`/api/session/${parent.id}/prompt`, { prompt: { text: "MEMORY_TASK_PARENT" } })
    await runtime.api(`/api/session/${parent.id}/wait`, undefined, "POST", 204)
    const tasks = await runtime.api(`/api/session/${parent.id}/task`)
    assert.equal(tasks.length, 1)
    const managed = { id: tasks[0].id }
    await runtime.api(`/api/session/${managed.id}/memory`, undefined, "GET", 409)
    return {
      runtime,
      repo,
      session,
      parent,
      managed,
      file,
      mode,
      close,
      records: async () =>
        (await readFile(fixture.records, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
    }
  } catch (error) {
    await close()
    throw error
  }
}
