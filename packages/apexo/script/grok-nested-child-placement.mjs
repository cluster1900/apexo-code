import assert from "node:assert/strict"
import { writeFile, mkdir, readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"
const calls = []
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  deferBackend: true,
  next: ({ body, text, input, finished, ancillary }) => {
    if (ancillary) return { content: "Nested placement" }
    calls.push(body)
    if (text.includes("GRANDCHILD")) {
      if (!finished)
        return {
          tool: "bash",
          args: { command: "pwd; printf NESTED_EDIT > nested.txt", description: "Nested placement" },
        }
      assert.match(JSON.stringify(input), /alternate\/nested/)
      return { content: "GRANDCHILD_DONE" }
    }
    if (text.includes("CHILD_OWNER")) {
      if (!finished)
        return {
          tool: "task",
          args: { description: "Nested child", prompt: "GRANDCHILD", subagent_type: "helper", cwd: "nested" },
        }
      return { content: "CHILD_DONE" }
    }
    if (!finished)
      return {
        tool: "task",
        args: { description: "Child owner", prompt: "CHILD_OWNER", subagent_type: "helper", cwd: "alternate" },
      }
    return { content: "PARENT_DONE" }
  },
})
try {
  const config = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT)
  await writeFile(join(fixture.directory, "tracked.txt"), "COMMITTED")
  for (const args of [
    ["init"],
    ["add", "tracked.txt"],
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "base"],
  ]) {
    const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: fixture.directory })
    assert.equal(result.status, 0, result.stderr.toString())
  }
  await writeFile(join(fixture.directory, "tracked.txt"), "DIRTY_PARENT")
  await writeFile(join(fixture.directory, "untracked.txt"), "UNTRACKED_PARENT")
  await mkdir(join(fixture.directory, "alternate"))
  await writeFile(join(fixture.directory, "alternate", "tracked.txt"), "EXPLICIT_CWD")
  await writeFile(join(fixture.directory, "alternate", "untracked.txt"), "EXPLICIT_UNTRACKED")
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      task: { maxDepth: 2 },
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
  await mkdir(join(fixture.directory, "alternate", "nested"))
  await fixture.reopen()
  const parent = (
    await fixture.api("/api/session", {
      commandSandbox: "workspace",
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
  await fixture.api(`/api/session/${parent.id}/prompt`, { prompt: { text: "NESTED_PARENT" } })
  await fixture.api(`/api/session/${parent.id}/wait`, undefined, "POST")
  const children = await fixture.api(`/api/session/${parent.id}/task`)
  assert.equal(children.length, 1)
  assert.equal(children[0].status, "completed")
  const grandchildren = await fixture.api(`/api/session/${children[0].id}/task`)
  assert.equal(grandchildren.length, 1)
  assert.equal(grandchildren[0].status, "completed")
  const child = (await fixture.api(`/api/session/${grandchildren[0].id}`)).data
  assert.equal(child.parentID, children[0].id)
  assert.equal(child.location.directory, join(fixture.directory, "alternate", "nested"))
  assert.equal(await readFile(join(child.location.directory, "nested.txt"), "utf8"), "NESTED_EDIT")
  assert.equal(calls.length, 6)
  console.log(
    JSON.stringify({
      checks: ["nested-current-parent-capability", "nested-owned-location", "nested-real-provider-write"],
      providerCalls: calls.length,
      output: fixture.output,
    }),
  )
} finally {
  await fixture.close()
  await writeFile(join(fixture.output, "nested-placement.json"), JSON.stringify({ calls }, null, 2))
}
