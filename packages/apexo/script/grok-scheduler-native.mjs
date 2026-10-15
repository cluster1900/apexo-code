// Native Scheduler acceptance through real Session/provider tools and passive HTTP controls.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const durable = !process.argv.includes("--default-durable")
const checks = [],
  calls = []
const held = Promise.withResolvers()
const recurring = Promise.withResolvers()
const stopChild = Promise.withResolvers()
const stopParent = Promise.withResolvers()
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: async ({ body, text, finished, ancillary }) => {
    if (ancillary) return { content: "Scheduler acceptance" }
    const parent = (body.tools ?? []).some((tool) => (tool.function?.name ?? tool.name) === "task")
    calls.push({ parent, text, finished, time: Date.now() })
    if (!parent && text.includes("SCHED_CHILD_STOP")) {
      await stopChild.promise
      return { content: "SCHEDULE_STOPPED_CHILD_LATE" }
    }
    if (parent && finished && text.includes("SCHED_CREATE_STOP")) {
      await stopParent.promise
      return { content: "SCHEDULE_STOPPED_PARENT_LATE" }
    }
    if (!parent && text.includes("SCHED_CHILD_RECURRENCE")) {
      if (calls.filter((call) => !call.parent && call.text.includes("SCHED_CHILD_RECURRENCE")).length === 1)
        await recurring.promise
      return { content: "SCHEDULE_RECURRENCE_COMPLETED" }
    }
    if (!parent && text.includes("SCHED_CHILD_HELD")) {
      await held.promise
      return { content: "SCHEDULE_OCCURRENCE_COMPLETED" }
    }
    if (parent && !finished && text.includes("SCHED_CREATE_"))
      return {
        tool: "scheduler_create",
        args: {
          interval: /IMMEDIATE|RECURRENCE|STOP/.test(text) ? "1s" : "1h",
          prompt: text.includes("RECURRENCE")
            ? "SCHED_CHILD_RECURRENCE"
            : text.includes("STOP")
              ? "SCHED_CHILD_STOP"
              : "SCHED_CHILD_HELD",
          ...(durable ? { durable: true } : {}),
          fire_immediately: /IMMEDIATE|RECURRENCE|STOP/.test(text),
        },
      }
    return { content: "SCHED_PARENT_DONE" }
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
const list = (id) => fixture.api(`/api/session/${id}/schedule`)
const detail = (id, schedule) => fixture.api(`/api/session/${id}/schedule/${schedule}`)
const action = (id, schedule, action) =>
  fixture.api(
    `/api/session/${id}/schedule/${schedule}${action === "delete" ? "" : `/${action}`}`,
    undefined,
    action === "delete" ? "DELETE" : "POST",
  )
try {
  const config = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT)
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
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
              name: "Scheduler fixture",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  const parent = await create()
  await prompt(parent.id, "SCHED_CREATE_FUTURE")
  await idle(parent.id)
  const first = (await list(parent.id))[0]
  assert.ok(first.id.startsWith("sched_"))
  assert.equal(first.status, "active")
  assert.equal(first.durable, durable)
  assert.equal(first.intervalSeconds, 3600)
  assert.ok(!("prompt" in first) && !("authority" in first) && !("owner" in first))
  const before = calls.length
  await fixture.api(`/api/session/${parent.id}/interrupt`, undefined, "POST")
  assert.equal((await detail(parent.id, first.id)).status, "active")
  assert.equal((await detail(parent.id, first.id)).prompt, "SCHED_CHILD_HELD")
  assert.equal((await action(parent.id, first.id, "pause")).status, "paused")
  const resumed = await action(parent.id, first.id, "resume")
  assert.equal(resumed.status, "active")
  assert.ok(resumed.nextFireAt >= Date.now() + 3_590_000)
  assert.equal(calls.length, before)
  checks.push("create-passive-summary-detail-pause-explicit-future-resume-no-model-work")

  const foreign = await create()
  const response = await fetch(
    `${fixture.url}/api/session/${foreign.id}/schedule/${first.id}?directory=${encodeURIComponent(fixture.directory)}`,
  )
  assert.equal(response.status, 404)
  await response.arrayBuffer()
  checks.push("foreign-session-cannot-read-intent")

  await fixture.crash()
  await fixture.reopen()
  const recovered = await detail(parent.id, first.id)
  assert.equal(recovered.status, "paused")
  assert.equal(recovered.durable, durable)
  assert.equal(recovered.blockedReason, "restart_required")
  assert.equal(calls.length, before)
  const recovery = await action(parent.id, first.id, "resume")
  assert.equal(recovery.status, "active")
  assert.ok(recovery.nextFireAt >= Date.now() + 3_590_000)
  assert.equal(calls.length, before)
  await action(parent.id, first.id, "delete")
  await action(parent.id, first.id, "delete")
  assert.deepEqual(await list(parent.id), [])
  checks.push("restart-passive-read-explicit-resume-no-replay-idempotent-delete")

  const running = await create()
  await prompt(running.id, "SCHED_CREATE_IMMEDIATE")
  await idle(running.id)
  await poll(
    () => calls.some((call) => !call.parent && call.text.includes("SCHED_CHILD_HELD")),
    "real scheduled child provider",
  )
  const immediate = (await list(running.id))[0]
  assert.equal(immediate.intervalSeconds, 60)
  assert.equal(immediate.occurrenceStatus, "running")
  assert.ok(immediate.latestTaskID.startsWith("ses_"))
  await action(running.id, immediate.id, "delete")
  assert.equal((await fixture.api(`/api/session/${running.id}/task/${immediate.latestTaskID}`)).status, "running")
  held.resolve()
  await poll(
    async () => (await detail(running.id, immediate.id)).occurrenceStatus === "completed",
    "joined native occurrence",
  )
  await idle(running.id)
  const task = await fixture.api(`/api/session/${running.id}/task/${immediate.latestTaskID}`)
  assert.equal(task.status, "completed")
  assert.equal(task.output, "SCHEDULE_OCCURRENCE_COMPLETED")
  assert.equal((await detail(running.id, immediate.id)).status, "deleted")
  checks.push("real-immediate-child-delete-preserves-admitted-task-terminal-output")
  const stopping = await create()
  await prompt(stopping.id, "SCHED_CREATE_STOP")
  await poll(
    () =>
      calls.some((call) => !call.parent && call.text.includes("SCHED_CHILD_STOP")) &&
      calls.some((call) => call.parent && call.finished && call.text.includes("SCHED_CREATE_STOP")),
    "held parent and scheduled child",
  )
  const stopped = (await list(stopping.id))[0]
  assert.equal(stopped.occurrenceStatus, "running")
  await fixture.api(`/api/session/${stopping.id}/interrupt`, undefined, "POST")
  const afterStop = await detail(stopping.id, stopped.id)
  assert.equal(afterStop.status, "paused")
  assert.equal(afterStop.blockedReason, "stopped")
  assert.equal(afterStop.occurrenceStatus, "cancelled")
  assert.equal((await fixture.api(`/api/session/${stopping.id}/task/${stopped.latestTaskID}`)).status, "cancelled")
  const callsAtStop = calls.length
  stopChild.resolve()
  stopParent.resolve()
  await idle(stopping.id)
  assert.equal(calls.length, callsAtStop)
  await action(stopping.id, stopped.id, "delete")
  checks.push("accepted-active-stop-pauses-intent-joins-child-suppresses-late-completion-idle-stop-is-noop")

  if (process.argv.includes("--recurrence")) {
    const repeat = await create()
    await prompt(repeat.id, "SCHED_CREATE_RECURRENCE")
    await idle(repeat.id)
    const childCalls = () => calls.filter((call) => !call.parent && call.text.includes("SCHED_CHILD_RECURRENCE"))
    await poll(() => childCalls().length === 1, "first real recurrence child")
    const initial = (await list(repeat.id))[0]
    assert.equal(initial.occurrenceStatus, "running")
    const childID = initial.latestTaskID
    assert.ok(childID)
    // Keep the first real provider turn alive across the minimum interval. Passive reads
    // observe the second due tick being skipped rather than launching an overlapping child.
    await poll(
      async () => (await detail(repeat.id, initial.id)).nextFireAt > initial.nextFireAt,
      "real due tick while child is active",
      70_000,
    )
    assert.equal(childCalls().length, 1)
    assert.equal((await detail(repeat.id, initial.id)).blockedReason, "busy")
    recurring.resolve()
    await poll(
      async () => (await detail(repeat.id, initial.id)).occurrenceStatus === "completed",
      "first recurrence settles",
    )
    await idle(repeat.id)
    await poll(() => childCalls().length === 2, "next future cadence after skipped tick", 70_000)
    await poll(
      async () => (await detail(repeat.id, initial.id)).occurrenceStatus === "completed",
      "second recurrence settles",
    )
    const second = await detail(repeat.id, initial.id)
    assert.equal(second.latestTaskID, childID)
    assert.ok(childCalls()[1].time - childCalls()[0].time >= 110_000)
    await action(repeat.id, initial.id, "delete")
    await idle(repeat.id)
    assert.equal(childCalls().length, 2)
    checks.push("real-60-second-cadence-no-overlap-skipped-tick-same-child-settled-followup")
  }
  console.log(JSON.stringify({ checks, durable, providerCalls: calls.length, output: fixture.output }, null, 2))
} finally {
  held.resolve()
  recurring.resolve()
  stopChild.resolve()
  stopParent.resolve()
  await fixture.close()
  await writeFile(join(fixture.output, "native-scheduler.json"), JSON.stringify({ checks, calls }, null, 2))
}
