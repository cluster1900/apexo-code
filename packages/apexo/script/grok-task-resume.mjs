// Real native CLI/rebuilt Desktop Task transcript continuation; no foreign runtime dependency.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"
const calls = [],
  checks = [],
  source = { id: "" }
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: async ({ body, input, text, finished, ancillary }) => {
    if (ancillary) return { content: "Task continuation" }
    calls.push({ body, text, finished })
    if (text.includes("RESUME_CHILD_NEXT")) {
      assert.equal(body.model, "grok-4.7")
      assert.ok(JSON.stringify(input).includes("RESUME_SOURCE_RESULT"))
      assert.ok(JSON.stringify(input).includes("RESUME_DURABLE_FACT"))
      return { content: "RESUME_NEW_RESULT", usage: 24 }
    }
    if (text.includes("RESUME_CHILD_SOURCE")) {
      if (!finished) return { tool: "read", args: { filePath: join(fixture.directory, "fact.txt") }, usage: 5 }
      return { content: "RESUME_SOURCE_RESULT", usage: 12 }
    }
    if (!finished)
      return {
        tool: "task",
        args: text.includes("PARENT_CONTINUE")
          ? {
              description: "Resumed Task",
              prompt: "RESUME_CHILD_NEXT",
              subagent_type: "override",
              resume_from: source.id,
            }
          : { description: "Source Task", prompt: "RESUME_CHILD_SOURCE", subagent_type: "helper" },
      }
    return { content: "PARENT_SETTLED" }
  },
})
const messages = async (id) => {
  const url = new URL(`/api/session/${id}/message`, fixture.url)
  url.searchParams.set("order", "asc")
  url.searchParams.set("directory", fixture.directory)
  const response = await fetch(url)
  assert.equal(response.status, 200)
  return response.json()
}
try {
  const config = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT)
  await writeFile(join(fixture.directory, "fact.txt"), "RESUME_DURABLE_FACT")
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      agents: {
        helper: { mode: "subagent", model: "xai/grok-4.7" },
        override: { mode: "subagent", model: "xai/override" },
      },
      providers: {
        xai: {
          api: {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: config.provider.xai.options.baseURL,
            settings: { apiKey: "fixture" },
          },
          models: Object.fromEntries(
            ["grok-4.7", "override"].map((id) => [
              id,
              {
                name: id,
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 100000, output: 4096 },
              },
            ]),
          ),
        },
      },
    }),
  )
  const parent = (
    await fixture.api("/api/session", {
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
  await fixture.api(`/api/session/${parent.id}/prompt`, { prompt: { text: "PARENT_SOURCE" } })
  await fixture.api(`/api/session/${parent.id}/wait`, undefined, "POST")
  const first = await fixture.api(`/api/session/${parent.id}/task`)
  assert.equal(first.length, 1)
  assert.equal(first[0].status, "completed")
  source.id = first[0].id
  const history = await messages(source.id)
  await fixture.crash()
  await fixture.reopen()
  await fixture.api(`/api/session/${parent.id}/prompt`, { prompt: { text: "PARENT_CONTINUE" } })
  await fixture.api(`/api/session/${parent.id}/wait`, undefined, "POST")
  const tasks = await fixture.api(`/api/session/${parent.id}/task`)
  assert.equal(tasks.length, 2)
  const resumed = tasks.find((task) => task.id !== source.id)
  assert.equal(resumed.status, "completed")
  assert.equal((await fixture.api(`/api/session/${parent.id}/task/${resumed.id}`)).output, "RESUME_NEW_RESULT")
  assert.deepEqual(await messages(source.id), history)
  const copied = (await messages(resumed.id)).data
  assert.deepEqual(
    copied.filter((message) => message.type === "user").map((message) => message.text),
    ["RESUME_CHILD_SOURCE", "RESUME_CHILD_NEXT"],
  )
  assert.ok(copied.every((message) => !history.data.some((old) => old.id === message.id)))
  assert.equal(calls.length, 7)
  checks.push(
    "restart-durable-transcript-and-tool-result",
    "fresh-child-source-owner-unchanged",
    "saved-model-over-requested-agent",
    "canonical-provider-turn-count",
  )
  console.log(
    JSON.stringify(
      { checks, providerCalls: calls.length, source: source.id, child: resumed.id, output: fixture.output },
      null,
      2,
    ),
  )
} finally {
  await fixture.close()
  await writeFile(join(fixture.output, "task-resume.json"), JSON.stringify({ checks, calls }, null, 2))
}
