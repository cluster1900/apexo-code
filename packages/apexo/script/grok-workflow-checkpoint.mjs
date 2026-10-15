// First-party Workflow checkpoint acceptance using a production backend and actual Rhai helper.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const kind = process.argv[2] ?? "cli"
const calls = []
const fixture = await startShellFixture(kind, { config: { snapshot: false }, next: async ({ body }) => { calls.push(body); return { content: "CHECKPOINT_CHILD" } } })
const checks = []
const settled = (target) => poll(async () => { const info = await fixture.api(target); return ["running", "pending"].includes(info.status) ? undefined : info }, "workflow checkpoint outcome", 20000)
const idle = () => poll(async () => Object.keys((await fixture.api("/api/session/active")).data).length === 0, "workflow checkpoint teardown", 10000)
try {
  await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const session = (await fixture.api("/api/session", { location: { directory: fixture.directory }, model: { providerID: "xai", id: "grok-4.7" }, agent: "build" })).data
  const root = `/api/session/${session.id}/workflow`
  const checkpoint = await fixture.api(root, { source: { type: "script", name: "checkpoint", script: 'await_user("blocked", "Review evidence"); let answer = agent("Return CHECKPOINT_CHILD", #{capability_mode:"read-only"}); complete(answer.output);' } })
  const target = `${root}/${checkpoint.id}`
  const paused = await settled(target)
  assert.equal(paused.status, "paused", paused.message)
  assert.equal(paused.pauseKind, "verification")
  assert.equal(calls.length, 0)
  await idle()
  await fixture.api(`${target}/resume`, {})
  const resumed = await settled(target)
  assert.equal(resumed.status, "completed", resumed.message)
  assert.equal(resumed.result, "CHECKPOINT_CHILD")
  assert.equal(resumed.agentsSpent, 1)
  assert.equal(calls.length, 1)
  await idle()
  checks.push("durable-await-user-pauses-before-child-and-resume-replays-once")
  const terminal = await fixture.api(root, { source: { type: "script", name: "pause", script: 'pause("backoff", "Wait"); complete();' } })
  const terminalTarget = `${root}/${terminal.id}`
  for (const again of [false, true]) {
    if (again) await fixture.api(`${terminalTarget}/resume`, {})
    const result = await settled(terminalTarget)
    assert.equal(result.status, "paused", result.message)
    assert.equal(result.pauseKind, "back_off")
    await idle()
  }
  await fixture.api(`${terminalTarget}/stop`, undefined, "POST")
  checks.push("terminal-pause-repeats-after-explicit-resume")
  const complete = await fixture.api(root, { source: { type: "script", name: "empty", script: 'try { complete(); } catch(e) { complete("bypassed"); }' } })
  const empty = await settled(`${root}/${complete.id}`)
  assert.equal(empty.status, "completed", empty.message)
  assert.equal(empty.result, null)
  await idle()
  checks.push("complete-without-value-is-terminal-null")
  const invalid = await fixture.api(root, { source: { type: "script", name: "invalid", script: 'await_user("unknown", "Review"); complete();' } })
  assert.equal((await settled(`${root}/${invalid.id}`)).status, "failed")
  assert.equal(calls.length, 1)
  await idle()
  checks.push("invalid-pause-kind-fails-without-provider-call")
  console.log(JSON.stringify({ kind, checks, passed: checks.length, providerCalls: calls.length }, null, 2))
} finally { await fixture.close() }
