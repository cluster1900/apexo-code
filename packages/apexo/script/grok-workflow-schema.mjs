// Actual native child Sessions, schema correction, cancellation, and durable usage.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const state = { mode: "correct", hold: undefined, calls: [] },
  checks = []
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  config: { snapshot: false, compaction: { auto: false } },
  next: async ({ body, text }) => {
    const correction = text.includes("Your final message did not satisfy the Workflow output contract")
    state.calls.push({ mode: state.mode, correction, body })
    const tools = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
    assert.ok(!tools.includes("write") && !tools.includes("workflow"))
    if (state.mode === "provider-error") return { error: { status: 400, message: "SCHEMA_PROVIDER_ERROR" } }
    if (correction && state.hold) await state.hold.promise
    return { content: correction && state.mode !== "invalid" ? '{"ok":true}' : '{"wrong":true}' }
  },
})
const idle = () =>
  poll(async () => Object.keys((await fixture.api("/api/session/active")).data).length === 0, "Workflow idle")
const settled = (target) =>
  poll(
    async () => {
      const info = await fixture.api(target)
      return ["running", "pending"].includes(info.status) ? undefined : info
    },
    "Schema Workflow settlement",
    25_000,
  )
try {
  await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const parent = (
    await fixture.api("/api/session", {
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
  const root = `/api/session/${parent.id}/workflow`
  const start = async () => {
    const info = await fixture.api(root, {
      source: {
        type: "script",
        name: "schema",
        script:
          'let r = agent("SCHEMA_CHILD", #{capability_mode:"read-only",output_schema:#{type:"object",required:["ok"],properties:#{ok:#{type:"boolean"}},additionalProperties:false}}); complete(r.output);',
      },
      agentBudget: 1,
    })
    return `${root}/${info.id}`
  }
  const good = await start(),
    completed = await settled(good)
  assert.equal(completed.status, "completed", completed.message)
  assert.deepEqual(completed.result, { ok: true })
  assert.equal(completed.agentsSpent, 1)
  assert.equal(completed.tokens, 240)
  assert.equal(completed.usageIncomplete, false)
  assert.equal(completed.children.length, 1)
  assert.equal(state.calls.length, 2)
  await idle()
  const messages = (await fixture.api(`/api/session/${completed.children[0]}/message`)).data
  assert.equal(messages.filter((item) => item.type === "user").length, 2)
  checks.push("one-logical-agent-two-owned-drains-same-child-exact-usage")
  state.mode = "invalid"
  const bad = await start(),
    failed = await settled(bad)
  assert.equal(failed.status, "failed")
  assert.match(failed.message, /after one correction/)
  assert.equal(failed.tokens, 240)
  assert.equal(failed.usageIncomplete, false)
  assert.equal(failed.children.length, 1)
  assert.equal(state.calls.length, 4)
  await idle()
  checks.push("second-invalid-output-stops-with-both-attempts-accounted")
  state.mode = "provider-error"
  const error = await settled(await start())
  assert.equal(error.status, "failed")
  assert.equal(error.usageIncomplete, true)
  assert.equal(state.calls.length, 5)
  await idle()
  checks.push("provider-error-does-not-trigger-schema-correction")
  state.mode = "cancel"
  state.hold = Promise.withResolvers()
  const paused = await start()
  await poll(() => state.calls.filter((call) => call.mode === "cancel").length === 2, "held correction")
  const pauseReply = await fixture.api(`${paused}/pause`, undefined, "POST")
  assert.equal(pauseReply.resumeBlockedReason, "schema_attempt_claimed")
  await idle()
  state.hold.resolve()
  state.hold = undefined
  const stopped = await fixture.api(paused)
  assert.equal(stopped.status, "paused")
  assert.equal(stopped.tokens, 120)
  assert.equal(stopped.usageIncomplete, true)
  assert.equal(stopped.resumeBlockedReason, "schema_attempt_claimed")
  assert.equal(
    (await fixture.api(root)).find((run) => run.id === stopped.id).resumeBlockedReason,
    "schema_attempt_claimed",
  )
  assert.equal(
    (await fixture.api(`${root}/related`)).find((run) => run.id === stopped.id).resumeBlockedReason,
    "schema_attempt_claimed",
  )
  await assert.rejects(fixture.api(`${paused}/resume`, {}), /start a new Workflow run/)
  assert.deepEqual(await fixture.api(paused), stopped)
  assert.equal(state.calls.length, 7)
  await idle()
  checks.push("cancelled-claimed-correction-cannot-retry-on-explicit-resume")
  state.mode = "restart"
  state.hold = Promise.withResolvers()
  const crashed = await start()
  await poll(() => state.calls.filter((call) => call.mode === "restart").length === 2, "held correction before restart")
  await fixture.crash()
  state.hold.resolve()
  state.hold = undefined
  await fixture.reopen()
  const retained = await fixture.api(crashed)
  assert.equal(retained.tokens, 120)
  assert.equal(retained.usageIncomplete, true)
  assert.equal(retained.resumeBlockedReason, "process_restart")
  const response = await fetch(`${fixture.url}${crashed}/resume?directory=${encodeURIComponent(fixture.directory)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })
  assert.equal(response.ok, false)
  assert.match(await response.text(), /new run|restart/i)
  assert.equal(state.calls.length, 9)
  checks.push("crashed-correction-keeps-lower-bound-and-never-auto-retries")
  console.log(JSON.stringify({ checks, providerCalls: state.calls.length, output: fixture.output }, null, 2))
} finally {
  state.hold?.resolve()
  await fixture.close()
  await writeFile(join(fixture.output, "workflow-schema.json"), JSON.stringify({ checks, calls: state.calls }, null, 2))
}
