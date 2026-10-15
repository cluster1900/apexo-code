// Real native CLI/rebuilt Desktop Task transcript continuation; no foreign runtime dependency.
import assert from "node:assert/strict"
import { writeFile, mkdir, readFile, rm } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"
const placement = process.argv[3] ?? "worktree"
assert.ok(["cwd", "worktree"].includes(placement))
const calls = [],
  checks = [],
  source = { id: "" }
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  deferBackend: true,
  next: async ({ body, input, text, finished, ancillary }) => {
    if (ancillary) return { content: "Task continuation" }
    calls.push({ body, text, finished })
    if (text.includes("RESUME_CHILD_NEXT")) {
      assert.equal(body.model, "grok-4.7")
      assert.ok(JSON.stringify(input).includes("RESUME_SOURCE_RESULT"))
      if (!finished)
        return { tool: "bash", args: { command: "pwd; cat child.txt", description: "Read retained child edit" } }
      assert.ok(JSON.stringify(input).includes("CHILD_EDIT"))
      return { content: "RESUME_NEW_RESULT", usage: 24 }
    }
    if (text.includes("RESUME_CHILD_SOURCE")) {
      if (!finished)
        return {
          tool: "bash",
          args: {
            command: "pwd; cat tracked.txt untracked.txt; printf CHILD_EDIT > child.txt",
            description: "Inspect owned placement",
          },
          usage: 5,
        }
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
              cwd: "/missing-ignored-resume-placement",
            }
          : {
              description: "Source Task",
              prompt: "RESUME_CHILD_SOURCE",
              subagent_type: "helper",
              ...(placement === "worktree" ? { isolation: "worktree" } : { cwd: "alternate" }),
            },
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
  await fixture.reopen()
  const parent = (
    await fixture.api("/api/session", {
      commandSandbox: "workspace",
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
  const original = (await fixture.api(`/api/session/${source.id}`)).data
  source.directory = original.location.directory
  assert.notEqual(source.directory, fixture.directory)
  assert.equal(await readFile(join(source.directory, "child.txt"), "utf8"), "CHILD_EDIT")
  assert.equal(await readFile(join(fixture.directory, "tracked.txt"), "utf8"), "DIRTY_PARENT")
  assert.equal(await Bun.file(join(fixture.directory, "child.txt")).exists(), false)
  assert.ok(JSON.stringify(history).includes(placement === "worktree" ? "DIRTY_PARENT" : "EXPLICIT_CWD"))
  if (placement === "worktree")
    assert.equal((await fixture.api(`/api/session/${parent.id}/task/${source.id}`)).worktreePath, source.directory)
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
  assert.equal((await fixture.api(`/api/session/${resumed.id}`)).data.location.directory, source.directory)
  assert.equal(calls.length, 8)
  checks.push(
    "owned-effective-placement-and-isolated-write",
    "dirty-tracked-and-untracked-copy-or-explicit-cwd",
    "confined-sandbox-retained",
    "restart-durable-transcript-and-tool-result",
    "fresh-child-source-owner-unchanged",
    "saved-model-over-requested-agent",
    "canonical-provider-turn-count",
    "resume-retains-placement-over-new-cwd",
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
  if (placement === "worktree" && source.directory) await rm(source.directory, { recursive: true, force: true })
  await writeFile(join(fixture.output, "child-placement.json"), JSON.stringify({ checks, calls }, null, 2))
}
