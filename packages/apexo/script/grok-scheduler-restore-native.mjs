// Explicit Session restoration: future-only Scheduler intent, no provider replay.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const checks = [],
  calls = []
const stopped = Promise.withResolvers()
const unfinished = Promise.withResolvers()
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: async ({ body, text, finished, ancillary }) => {
    if (ancillary) return { content: "Scheduler restoration acceptance" }
    const parent = (body.tools ?? []).some((tool) => (tool.function?.name ?? tool.name) === "task")
    calls.push({ parent, text, finished, time: Date.now() })
    if (!parent && text.includes("RESTORE_CHILD_UNFINISHED")) {
      await unfinished.promise
      return { content: "OLD_CHILD_MUST_NOT_REPLAY" }
    }
    if (!parent) return { content: "RESTORED_FUTURE_TICK_COMPLETE" }
    if (finished && text.includes("RESTORE_CREATE_STOPPED")) {
      await stopped.promise
      return { content: "OLD_STOPPED_PARENT_MUST_NOT_REPLAY" }
    }
    if (!finished && text.includes("RESTORE_CREATE_"))
      return {
        tool: "scheduler_create",
        args: {
          interval: text.includes("FUTURE") ? "1m" : "1h",
          prompt: text.includes("UNFINISHED") ? "RESTORE_CHILD_UNFINISHED" : "RESTORE_CHILD_FUTURE",
          fire_immediately: text.includes("UNFINISHED"),
        },
      }
    return { content: "RESTORE_PARENT_DONE" }
  },
})
const create = async (kind) => {
  const session = (
    await fixture.api("/api/session", {
      location: { directory: fixture.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  await fixture.api(`/api/session/${session.id}/prompt`, { prompt: { text: `RESTORE_CREATE_${kind}` } })
  if (kind !== "STOPPED") await fixture.api(`/api/session/${session.id}/wait`, undefined, "POST")
  const intent = await poll(async () => (await fixture.api(`/api/session/${session.id}/schedule`))[0], "created intent")
  return { session, intent }
}
const root = (item) => `/api/session/${item.session.id}`
const detail = (item) => fixture.api(`${root(item)}/schedule/${item.intent.id}`)
const restore = (item) => fixture.api(`${root(item)}/restore`, undefined, "POST")
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
              name: "Restore fixture",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  const future = await create("FUTURE")
  assert.equal(future.intent.durable, false)
  const manual = await create("MANUAL")
  await fixture.api(`${root(manual)}/schedule/${manual.intent.id}/pause`, undefined, "POST")
  const stop = await create("STOPPED")
  await poll(
    () => calls.some((call) => call.parent && call.finished && call.text.includes("RESTORE_CREATE_STOPPED")),
    "active parent before Stop",
  )
  await fixture.api(`${root(stop)}/interrupt`, undefined, "POST")
  assert.equal((await detail(stop)).blockedReason, "stopped")
  stopped.resolve()
  const held = await create("UNFINISHED")
  await poll(
    () => calls.some((call) => !call.parent && call.text.includes("RESTORE_CHILD_UNFINISHED")),
    "unfinished real child",
  )
  const heldBefore = await detail(held)
  assert.equal(heldBefore.occurrenceStatus, "running")
  const before = calls.length
  await fixture.crash()
  await fixture.reopen()
  unfinished.resolve()
  const passive = await detail(future)
  assert.equal(passive.status, "paused")
  assert.equal(passive.blockedReason, "restart_required")
  assert.equal((await detail(manual)).blockedReason, undefined)
  assert.equal((await detail(stop)).blockedReason, "stopped")
  assert.equal(calls.length, before)
  checks.push("restart-reads-remain-passive-and-preserve-manual-stop-reasons")
  assert.equal((await restore(manual)).schedules[0].reason, "paused")
  assert.equal((await restore(stop)).schedules[0].reason, "stopped")
  assert.equal((await restore(held)).schedules[0].reason, "unfinished_owner")
  assert.equal((await detail(held)).latestTaskID, heldBefore.latestTaskID)
  assert.equal(calls.length, before)
  checks.push("explicit-restore-does-not-replay-stop-or-unknown-unfinished-child")
  const result = await restore(future)
  assert.equal(result.schedules[0].reason, "restored")
  const activated = await detail(future)
  assert.equal(activated.status, "active")
  assert.ok(activated.nextFireAt > Date.now())
  assert.equal((activated.nextFireAt - future.intent.nextFireAt) % 60000, 0)
  assert.equal((await restore(future)).schedules[0].reason, "already_active")
  assert.equal((await detail(future)).nextFireAt, activated.nextFireAt)
  assert.equal(calls.length, before)
  checks.push("future-phase-retained-and-repeated-restore-does-not-slide-or-call-model")
  await poll(
    async () => (await detail(future)).occurrenceStatus === "completed",
    "actual future cadence after restoration",
    70000,
  )
  await fixture.api(`${root(future)}/wait`, undefined, "POST")
  const final = await detail(future)
  const child = await fixture.api(`${root(future)}/task/${final.latestTaskID}`)
  assert.equal(child.status, "completed")
  assert.equal(child.output, "RESTORED_FUTURE_TICK_COMPLETE")
  const futureCalls = calls.filter((call) => !call.parent && call.text.includes("RESTORE_CHILD_FUTURE"))
  assert.equal(futureCalls.length, 1)
  assert.ok(futureCalls[0].time >= activated.nextFireAt)
  await fixture.api(`${root(future)}/schedule/${future.intent.id}`, undefined, "DELETE")
  checks.push("real-future-tick-uses-native-task-and-settles-once")
  for (const item of [future, manual, stop, held]) await fixture.api(root(item), undefined, "DELETE")
  console.log(JSON.stringify({ checks, providerCalls: calls.length, output: fixture.output }, null, 2))
} finally {
  stopped.resolve()
  unfinished.resolve()
  await fixture.close()
  await writeFile(join(fixture.output, "native-scheduler-restore.json"), JSON.stringify({ checks, calls }, null, 2))
}
