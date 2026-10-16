// Native Workflow resume through real CLI or rebuilt Desktop backend.
import assert from "node:assert/strict"
import { writeFile, readFile, rm } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const retained = { directory: undefined }
const calls = [],
  checks = []
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  deferBackend: true,
  env: process.env.APEXO_WORKFLOW_SCRIPT ? { APEXO_WORKFLOW_SCRIPT: process.env.APEXO_WORKFLOW_SCRIPT } : {},
  next: ({ body, input, text, finished }) => {
    calls.push(body)
    if (!finished)
      return {
        tool: "bash",
        args: {
          command: text.includes("RESUME_NEXT")
            ? "pwd; cat child.txt"
            : "pwd; cat fact.txt untracked.txt; printf CHILD_EDIT > child.txt",
          description: "Inspect Workflow placement",
        },
      }
    assert.match(JSON.stringify(input), text.includes("RESUME_NEXT") ? /CHILD_EDIT/ : /DIRTY_TOOL_FACT/)
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
  await writeFile(join(fixture.directory, "fact.txt"), "COMMITTED")
  for (const args of [
    ["init"],
    ["add", "fact.txt"],
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "base"],
  ]) {
    const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: fixture.directory })
    assert.equal(result.status, 0, result.stderr.toString())
  }
  await writeFile(join(fixture.directory, "fact.txt"), "DIRTY_TOOL_FACT")
  await writeFile(join(fixture.directory, "untracked.txt"), "UNTRACKED_FACT")
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
  await fixture.reopen()
  const parent = (
    await fixture.api("/api/session", {
      location: { directory: fixture.directory },
      commandSandbox: "workspace",
      agent: "parent",
      model: { providerID: "resume", id: "parent" },
    })
  ).data
  const root = `/api/session/${parent.id}/workflow`
  const first = await fixture.api(root, {
    source: {
      type: "script",
      name: "resume-source",
      script: 'complete(agent("RESUME_SOURCE",#{agent_type:"helper",isolation_worktree:true}));',
    },
  })
  const source = await settled(`${root}/${first.id}`)
  assert.equal(source.status, "completed", source.message)
  assert.equal(source.children.length, 1)
  await idle()
  const history = await messages(source.children[0])
  assert.match(JSON.stringify(history), /DIRTY_TOOL_FACT/)
  retained.directory = (await fixture.api(`/api/session/${source.children[0]}`)).data.location.directory
  assert.notEqual(retained.directory, fixture.directory)
  assert.equal(await readFile(join(retained.directory, "child.txt"), "utf8"), "CHILD_EDIT")
  assert.equal(await Bun.file(join(fixture.directory, "child.txt")).exists(), false)
  assert.match(JSON.stringify(history), /UNTRACKED_FACT/)
  await rm(retained.directory, { recursive: true, force: true })
  assert.equal(await Bun.file(join(retained.directory, "child.txt")).exists(), false)
  await writeFile(join(fixture.directory, "fact.txt"), "MUTATED_PARENT_FACT")
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
  assert.equal(calls.length, 4)
  assert.deepEqual(
    calls.map((call) => call.model),
    ["selected", "selected", "selected", "selected"],
  )
  const request = calls[2]
  assert.match(JSON.stringify(request.messages), /RESUME_SOURCE/)
  assert.match(JSON.stringify(request.messages), /SOURCE_RESULT/)
  assert.match(JSON.stringify(request.messages), /DIRTY_TOOL_FACT/)
  assert.match(JSON.stringify(request.messages), /RESUME_NEXT/)
  assert.match(JSON.stringify(request.messages.filter((message) => message.role === "system")), /CURRENT_HELPER/)
  assert.ok(request.tools.some((tool) => (tool.function ?? tool).name === "bash"))
  assert.deepEqual(await messages(source.children[0]), history)
  const child = (await fixture.api(`/api/session/${resumed.children[0]}`)).data
  assert.equal(child.location.directory, retained.directory)
  assert.equal(await readFile(join(retained.directory, "child.txt"), "utf8"), "CHILD_EDIT")
  assert.equal(await readFile(join(retained.directory, "fact.txt"), "utf8"), "DIRTY_TOOL_FACT")
  assert.equal(child.agent, "helper")
  assert.equal(child.parentID, parent.id)
  const latest = (await messages(resumed.children[0])).filter((message) => message.type === "assistant").at(-1)
  assert.equal(latest.tokens.input + latest.tokens.output, 120)
  assert.equal(resumed.tokens, 240)
  checks.push(
    "durable-restart-source-agent-model-and-tool-history",
    "fresh-owned-child-source-immutable",
    "confined-worktree-placement-retained",
    "deleted-worktree-reconstructed-from-snapshot",
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
  assert.equal(calls.length, 4)
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
  if (retained.directory) await rm(retained.directory, { recursive: true, force: true })
  await writeFile(join(fixture.output, "workflow-placement.json"), JSON.stringify({ checks, calls }, null, 2))
}
