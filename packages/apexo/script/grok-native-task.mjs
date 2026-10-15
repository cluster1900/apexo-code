// Real native Task CLI/Desktop backend acceptance; no fabricated historical state.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const calls = [],
  checks = [],
  children = {}
const hold = Promise.withResolvers(),
  restart = Promise.withResolvers()
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: async ({ body, input, text, finished }) => {
    calls.push({ text, finished })
    if (text.includes("CHILD_HOLD")) {
      await hold.promise
      return { content: "LATE_CANCELLED" }
    }
    if (text.includes("CHILD_RESTART")) {
      await restart.promise
      return { content: "LATE_INTERRUPTED" }
    }
    if (text.includes("CHILD_FIRST") || text.includes("CHILD_FOLLOWUP")) {
      assert.ok(!(body.tools ?? []).some((tool) => ["task", "workflow"].includes(tool.function?.name ?? tool.name)))
      return { content: text.includes("CHILD_FOLLOWUP") ? "FOLLOWUP_RESULT" : "FIRST_RESULT" }
    }
    if (!finished) {
      const args = text.includes("TASK_FOLLOWUP")
        ? { description: "follow-up", prompt: "CHILD_FOLLOWUP", subagent_type: "helper", task_id: children.first }
        : text.includes("TASK_HOLD")
          ? { description: "held", prompt: "CHILD_HOLD", subagent_type: "helper" }
          : text.includes("TASK_RESTART")
            ? { description: "interrupted", prompt: "CHILD_RESTART", subagent_type: "helper" }
            : text.includes("TASK_REFUSE")
              ? {
                  description: "refused",
                  prompt: "MUST_NOT_RUN",
                  subagent_type: "helper",
                  task_id: children.interrupted,
                }
              : text.includes("TASK_BAD_MODEL")
                ? { description: "invalid", prompt: "MUST_NOT_RUN", subagent_type: "broken" }
                : { description: "first", prompt: "CHILD_FIRST", subagent_type: "helper" }
      return { tool: "task", args }
    }
    if (text.includes("TASK_HOLD")) assert.ok(JSON.stringify(input).includes("cancelled"))
    if (text.includes("TASK_REFUSE")) assert.match(JSON.stringify(input), /unfinished|interrupted/)
    return { content: text.includes("TASK_HOLD") ? "PARENT_CANCELLED" : "PARENT_DONE" }
  },
})
const create = async () =>
  (
    await fixture.api("/api/session", {
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
const prompt = (id, text) => fixture.api(`/api/session/${id}/prompt`, { prompt: { text } })
const idle = (id) => fixture.api(`/api/session/${id}/wait`, undefined, "POST")
const list = (id) => fixture.api(`/api/session/${id}/task`)
const output = (id, child) => fixture.api(`/api/session/${id}/task/${child}`)
try {
  const config = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT)
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      agents: {
        helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] },
        broken: { mode: "subagent", model: "xai/nonexistent" },
      },
      providers: {
        xai: {
          api: {
            type: "aisdk",
            package: "@ai-sdk/xai",
            url: config.provider.xai.options.baseURL,
            settings: { apiKey: "fixture" },
          },
          models: {
            "grok-4.7": {
              name: "fixture",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  const parent = await create()
  await prompt(parent.id, "TASK_INITIAL")
  await idle(parent.id)
  const first = await list(parent.id)
  assert.equal(first.length, 1)
  assert.equal(first[0].status, "completed")
  assert.ok(!("output" in first[0]) && !("authority" in first[0]))
  children.first = first[0].id
  assert.equal((await output(parent.id, children.first)).output, "FIRST_RESULT")
  await prompt(parent.id, "TASK_FOLLOWUP")
  await idle(parent.id)
  assert.equal((await list(parent.id)).length, 1)
  assert.equal((await output(parent.id, children.first)).output, "FOLLOWUP_RESULT")
  assert.equal(calls.length, 6)
  checks.push("foreground-same-child-follow-up-and-private-summary-detail")

  const before = await fixture.api(`/api/session/${children.first}/message`)
  const rejected = await fetch(`${fixture.url}/api/session/${children.first}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: { text: "DIRECT_FORBIDDEN" } }),
  })
  assert.equal(rejected.status, 409)
  assert.deepEqual(await fixture.api(`/api/session/${children.first}/message`), before)
  const foreign = await create()
  assert.equal((await fetch(`${fixture.url}/api/session/${foreign.id}/task/${children.first}`)).status, 404)
  assert.equal(calls.length, 6)
  checks.push("direct-admission-and-foreign-output-rejected-without-provider")

  const held = await create()
  await prompt(held.id, "TASK_HOLD")
  await poll(() => calls.some((call) => call.text.includes("CHILD_HOLD")), "held child")
  const child = (await list(held.id))[0].id,
    root = `/api/session/${held.id}/task/${child}`
  assert.equal((await fixture.api(`${root}/wait`, { timeoutMs: 0 })).timedOut, true)
  const cancelled = await Promise.all([
    fixture.api(`${root}/cancel`, undefined, "POST"),
    fixture.api(`${root}/cancel`, undefined, "POST"),
    fixture.api(`${root}/wait`, { timeoutMs: 15000 }),
  ])
  assert.equal(cancelled[2].task.status, "cancelled")
  assert.equal(cancelled[2].timedOut, false)
  hold.resolve()
  await idle(held.id)
  assert.equal((await output(held.id, child)).status, "cancelled")
  assert.ok(JSON.stringify(await fixture.api(`/api/session/${held.id}/message`)).includes("PARENT_CANCELLED"))
  assert.equal(calls.length, 9)
  checks.push("bounded-wait-concurrent-joined-cancel-one-parent-continuation")

  const invalid = await create()
  await prompt(invalid.id, "TASK_BAD_MODEL")
  await idle(invalid.id)
  assert.deepEqual(await list(invalid.id), [])
  assert.equal(calls.length, 11)
  checks.push("unavailable-model-zero-child-or-child-provider")

  const interrupted = await create()
  await prompt(interrupted.id, "TASK_RESTART")
  await poll(() => calls.some((call) => call.text.includes("CHILD_RESTART")), "restart child")
  children.interrupted = (await list(interrupted.id))[0].id
  await fixture.crash()
  restart.resolve()
  await fixture.reopen()
  const recovered = await output(interrupted.id, children.interrupted)
  assert.equal(recovered.status, "interrupted")
  assert.equal(recovered.blockedReason, "process_restart")
  assert.equal(calls.length, 13)
  assert.equal((await output(parent.id, children.first)).output, "FOLLOWUP_RESULT")
  await prompt(interrupted.id, "TASK_REFUSE")
  await idle(interrupted.id)
  assert.equal(calls.length, 15)
  assert.equal((await output(interrupted.id, children.interrupted)).status, "interrupted")
  checks.push("restart-preserves-completed-output-and-refuses-unfinished-replay")
  console.log(JSON.stringify({ checks, providerCalls: calls.length, output: fixture.output }, null, 2))
} finally {
  hold.resolve()
  restart.resolve()
  await fixture.close()
  await writeFile(join(fixture.output, "native-task.json"), JSON.stringify({ checks, calls }, null, 2))
}
