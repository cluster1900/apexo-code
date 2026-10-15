// Actual native background Task lifecycle and completion delivery; isolated CLI or packaged Desktop backend.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const calls = [],
  checks = [],
  scenarios = new Map()
const state = (mode) => {
  if (!scenarios.has(mode))
    scenarios.set(mode, {
      child: Promise.withResolvers(),
      started: Promise.withResolvers(),
      parent: Promise.withResolvers(),
      parentCalls: 0,
      notices: 0,
    })
  return scenarios.get(mode)
}
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: async ({ body, input, text, finished }) => {
    const mode = (text.match(/BACKGROUND_(idle|active|wait|cancel|stop|delete|failure|restart|refuse|fresh)/) ??
      JSON.stringify(input).match(
        /PARENT_BACKGROUND_(idle|active|wait|cancel|stop|delete|failure|restart|refuse|fresh)/,
      ))?.[1]
    assert.ok(mode, "Expected exact isolated Task mode")
    const current = state(mode)
    const child = !(body.tools ?? []).some((tool) => (tool.function?.name ?? tool.name) === "task")
    calls.push({ mode, child, finished })
    if (child) {
      current.started.resolve()
      if (mode === "failure") return { error: { status: 400, message: "Deliberate child provider failure" } }
      await current.child.promise
      return { content: `CHILD_RESULT_${mode}` }
    }
    current.parentCalls++
    if (mode === "fresh") return { content: "FRESH_PARENT_DONE" }
    if (JSON.stringify(input).includes("Background Task completion data follows")) {
      current.notices++
      assert.match(JSON.stringify(input), mode === "failure" ? /failed/ : new RegExp(`CHILD_RESULT_${mode}`))
      return { content: `NOTICE_DONE_${mode}` }
    }
    if (!finished)
      return {
        tool: "task",
        args: {
          description: `Background ${mode}`,
          prompt: `CHILD_BACKGROUND_${mode}`,
          subagent_type: "helper",
          background: true,
          ...(mode === "refuse" ? { task_id: state("restart").childID } : {}),
        },
      }
    if (current.parentCalls === 2 && ["wait", "cancel"].includes(mode)) {
      await current.started.promise
      const childID = JSON.stringify(input).match(/ses_[a-f0-9]{64}/)?.[0]
      assert.ok(childID)
      return { tool: mode === "wait" ? "task_wait" : "task_cancel", args: { task_id: childID, timeout_ms: 15000 } }
    }
    if (mode === "active" || mode === "stop") await current.parent.promise
    if (mode === "refuse") assert.match(JSON.stringify(input), /unfinished|interrupted/)
    return { content: `PARENT_DONE_${mode}` }
  },
})
const create = async (id) =>
  (
    await fixture.api("/api/session", {
      ...(id ? { id } : {}),
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
const prompt = (id, mode) => fixture.api(`/api/session/${id}/prompt`, { prompt: { text: `PARENT_BACKGROUND_${mode}` } })
const idle = (id) => fixture.api(`/api/session/${id}/wait`, undefined, "POST")
const list = (id) => fixture.api(`/api/session/${id}/task`)
const detail = (parent, child) => fixture.api(`/api/session/${parent}/task/${child}`)
const messages = async (id) => {
  const response = await fetch(
    `${fixture.url}/api/session/${id}/message?order=asc&directory=${encodeURIComponent(fixture.directory)}`,
  )
  assert.equal(response.status, 200)
  return (await response.json()).data
}
const done = async (id, marker) =>
  poll(
    async () =>
      (await messages(id)).some(
        (m) =>
          m.type === "assistant" && m.time.completed && m.content.some((p) => p.type === "text" && p.text === marker),
      ),
    marker,
  )
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

  for (const mode of ["idle", "active", "wait", "cancel", "stop", "delete", "failure"]) {
    const parent = await create(),
      current = state(mode),
      before = calls.length
    await prompt(parent.id, mode)
    await poll(() => current.parentCalls >= 2, `${mode} parent continuation`)
    await poll(() => calls.some((call) => call.mode === mode && call.child), `${mode} child provider started`)
    const task = (await list(parent.id))[0]
    assert.ok(task?.background)
    if (!["failure", "cancel"].includes(mode)) assert.equal(task.status, "running")
    if (mode === "delete") {
      await done(parent.id, `PARENT_DONE_${mode}`)
      await fixture.api(`/api/session/${parent.id}`, undefined, "DELETE")
      assert.equal((await fetch(`${fixture.url}/api/session/${task.id}`)).status, 404)
      await create(parent.id)
      await create(task.id)
      current.child.resolve()
      await prompt(parent.id, "fresh")
      await done(parent.id, "FRESH_PARENT_DONE")
      assert.deepEqual(await list(parent.id), [])
      assert.deepEqual(await messages(task.id), [])
      assert.equal(current.notices, 0)
      checks.push("parent-deletion-joins-background-child-and-fences-id-reuse")
      continue
    }
    if (mode === "stop") await fixture.api(`/api/session/${parent.id}/interrupt`, undefined, "POST")
    if (mode === "idle") await done(parent.id, "PARENT_DONE_idle")
    current.child.resolve()
    if (mode === "active") {
      await poll(async () => (await detail(parent.id, task.id)).status === "completed", "active child settlement")
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(current.parentCalls, 2)
    }
    current.parent.resolve()
    if (["idle", "active", "failure"].includes(mode)) await done(parent.id, `NOTICE_DONE_${mode}`)
    if (["wait", "cancel"].includes(mode)) await done(parent.id, `PARENT_DONE_${mode}`)
    if (mode === "stop") {
      await poll(async () => (await detail(parent.id, task.id)).status === "completed", "late stopped-parent child")
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await idle(parent.id)
    const output = await detail(parent.id, task.id)
    assert.equal(output.status, mode === "cancel" ? "cancelled" : mode === "failure" ? "failed" : "completed")
    assert.equal(current.notices, ["idle", "active", "failure"].includes(mode) ? 1 : 0)
    assert.equal((await messages(parent.id)).filter((m) => m.type === "user").length, 1)
    assert.equal(calls.length - before, mode === "stop" ? 3 : 4)
    checks.push(`${mode}-owned-background-lifecycle-and-exact-completion-count`)
  }
  const parent = await create(),
    current = state("restart")
  await prompt(parent.id, "restart")
  await done(parent.id, "PARENT_DONE_restart")
  current.childID = (await list(parent.id))[0].id
  const before = calls.length
  await fixture.crash()
  current.child.resolve()
  await fixture.reopen()
  const output = await detail(parent.id, current.childID)
  assert.equal(output.status, "interrupted")
  assert.equal(output.blockedReason, "process_restart")
  assert.equal(output.background, true)
  await idle(parent.id)
  assert.equal(calls.length, before)
  await prompt(parent.id, "refuse")
  await done(parent.id, "PARENT_DONE_refuse")
  await idle(parent.id)
  assert.equal(calls.length, before + 2)
  assert.equal((await detail(parent.id, current.childID)).status, "interrupted")
  checks.push("restart-has-no-child-or-completion-replay-and-refuses-unfinished-followup")
  console.log(JSON.stringify({ checks, providerCalls: calls.length, output: fixture.output }, null, 2))
} finally {
  for (const current of scenarios.values()) {
    current.child.resolve()
    current.parent.resolve()
  }
  await fixture.close()
  await writeFile(join(fixture.output, "native-task-background.json"), JSON.stringify({ checks, calls }, null, 2))
}
