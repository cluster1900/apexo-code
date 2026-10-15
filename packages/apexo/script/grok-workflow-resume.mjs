// Native Workflow resume through real CLI or rebuilt Desktop backend.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const calls = [],
  checks = []
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: ({ body, input, text, finished }) => {
    calls.push(body)
    if (text.includes("RESUME_SOURCE") && !finished)
      return { tool: "read", args: { filePath: join(fixture.directory, "fact.txt") } }
    return { content: text.includes("RESUME_NEXT") ? "RESUMED_RESULT" : "SOURCE_RESULT" }
  },
})
const idle = () => poll(async () => Object.keys((await fixture.api("/api/session/active")).data).length === 0, "idle")
const settled = (url) =>
  poll(
    async () => {
      const run = await fixture.api(url)
      return ["pending", "running"].includes(run.status) ? undefined : run
    },
    "Workflow resume",
    25000,
  )
const messages = async (id) => {
  const url = new URL(`/api/session/${id}/message`, fixture.url)
  url.searchParams.set("directory", fixture.directory)
  url.searchParams.set("order", "asc")
  const response = await fetch(url)
  assert.equal(response.status, 200)
  return (await response.json()).data
}
try {
  await writeFile(join(fixture.directory, "fact.txt"), "DURABLE_TOOL_FACT")
  const base = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      agents: {
        parent: { system: "CURRENT_PARENT" },
        helper: { mode: "subagent", model: "resume/selected", system: "CURRENT_HELPER" },
      },
      providers: {
        resume: {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: base, settings: { apiKey: "fixture" } },
          models: Object.fromEntries(
            ["parent", "selected", "override"].map((id) => [
              id,
              {
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 100000, output: 10000 },
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
      agent: "parent",
      model: { providerID: "resume", id: "parent" },
    })
  ).data
  const root = `/api/session/${parent.id}/workflow`
  const first = await fixture.api(root, {
    source: {
      type: "script",
      name: "resume-source",
      script: 'complete(agent("RESUME_SOURCE",#{agent_type:"helper",capability_mode:"read-only"}));',
    },
  })
  const source = await settled(`${root}/${first.id}`)
  assert.equal(source.status, "completed", source.message)
  assert.equal(source.children.length, 1)
  await idle()
  const history = await messages(source.children[0])
  assert.match(JSON.stringify(history), /DURABLE_TOOL_FACT/)
  await fixture.crash()
  await fixture.reopen()
  const second = await fixture.api(root, {
    source: {
      type: "script",
      name: "resume-next",
      script: `complete(agent("RESUME_NEXT",#{resume_from:"${source.children[0]}",agent_type:"ignored-unavailable",model:"resume/override"}));`,
    },
  })
  const resumed = await settled(`${root}/${second.id}`)
  assert.equal(resumed.status, "completed", resumed.message)
  assert.equal(resumed.children.length, 1)
  assert.notEqual(resumed.children[0], source.children[0])
  await idle()
  assert.equal(calls.length, 3)
  assert.deepEqual(
    calls.map((call) => call.model),
    ["selected", "selected", "selected"],
  )
  const request = calls[2]
  assert.match(JSON.stringify(request.messages), /RESUME_SOURCE/)
  assert.match(JSON.stringify(request.messages), /SOURCE_RESULT/)
  assert.match(JSON.stringify(request.messages), /DURABLE_TOOL_FACT/)
  assert.match(JSON.stringify(request.messages), /RESUME_NEXT/)
  assert.match(JSON.stringify(request.messages.filter((message) => message.role === "system")), /CURRENT_HELPER/)
  assert.ok(!request.tools.some((tool) => (tool.function ?? tool).name === "bash"))
  assert.deepEqual(await messages(source.children[0]), history)
  const child = (await fixture.api(`/api/session/${resumed.children[0]}`)).data
  assert.equal(child.agent, "helper")
  assert.equal(child.parentID, parent.id)
  const latest = (await messages(resumed.children[0])).filter((message) => message.type === "assistant").at(-1)
  assert.equal(latest.tokens.input + latest.tokens.output, 120)
  assert.equal(resumed.tokens, 120)
  checks.push(
    "durable-restart-source-agent-model-and-tool-history",
    "fresh-owned-child-source-immutable",
    "read-only-ceiling-preserved",
    "historical-usage-not-rebilled",
  )
  const denied = await fixture.api(root, {
    source: {
      type: "script",
      name: "invalid-resume",
      script: `complete(agent("NEVER",#{resume_from:"${parent.id}"}));`,
    },
  })
  const rejected = await settled(`${root}/${denied.id}`)
  assert.equal(rejected.status, "failed")
  assert.deepEqual(rejected.children, [])
  assert.equal(calls.length, 3)
  checks.push("non-child-source-rejected-before-provider")
  console.log(
    JSON.stringify(
      {
        checks,
        providerCalls: calls.length,
        source: source.children[0],
        resumed: resumed.children[0],
        output: fixture.output,
      },
      null,
      2,
    ),
  )
} finally {
  await fixture.close()
  await writeFile(join(fixture.output, "workflow-resume.json"), JSON.stringify({ checks, calls }, null, 2))
}
