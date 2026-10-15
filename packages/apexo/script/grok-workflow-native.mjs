// First-party Apexo Workflow acceptance against an isolated production backend.
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const state = { calls: [], hold: undefined, mode: "research" }
const fixture = await startShellFixture(kind, {
  config: { snapshot: false },
  next: async ({ body, text }) => {
    state.calls.push({ mode: state.mode, body })
    if (state.hold) await state.hold.promise
    const names = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
    if (state.mode !== "ownership") assert.ok(!names.includes("workflow"), "Workflow children cannot recurse")
    if (state.mode === "research") {
      assert.ok(!names.includes("write") && !names.includes("bash"), "Research capabilities remain read-only")
      if (text.includes("Plan research")) return { content: JSON.stringify({ questions: ["First source", "Second source"] }) }
      if (text.includes("Investigate the supplied")) return { content: JSON.stringify({ claims: [{ claim: "Native evidence", evidence: "Primary source inspected", url: "https://example.com/native" }], uncertainties: [] }) }
      if (text.includes("Independently verify")) return { content: JSON.stringify({ accepted: [{ claim: "Native evidence", evidence: "Independent verification", url: "https://example.com/native" }], rejected: [] }) }
      return { content: JSON.stringify({ report: "Native evidence [source](https://example.com/native)", sources: ["https://example.com/native"] }) }
    }
    return { content: "RHAI_NATIVE_CHILD" }
  },
})
const checks = []
const create = async () => (await fixture.api("/api/session", { location: { directory: fixture.directory }, model: { providerID: "xai", id: "grok-4.7" }, agent: "build" })).data
const start = async (session, input) => {
  const root = `/api/session/${session.id}/workflow`
  const info = await fixture.api(root, input)
  return { root, target: `${root}/${info.id}`, info }
}
const settled = (run) => poll(async () => { const info = await fixture.api(run.target); return ["pending", "running"].includes(info.status) ? undefined : info }, "native workflow settlement", 25_000)
const idle = () => poll(async () => Object.keys((await fixture.api("/api/session/active")).data).length === 0, "native workflow idle", 10_000)
const request = (target, body) => fetch(`${fixture.url}${target}?directory=${encodeURIComponent(fixture.directory)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
try {
  await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const session = await create()
  const research = await start(session, { source: { type: "builtin", name: "deep-research" }, args: { query: "Research native evidence" }, agentBudget: 6, concurrency: 2 })
  const result = await settled(research)
  assert.equal(result.status, "completed", result.message)
  assert.equal(result.agentsSpent, 6)
  assert.equal(new Set(result.children).size, 6)
  assert.equal(state.calls.length, 6)
  await idle()
  checks.push("native-research-planner-parallel-evidence-independent-verification-cited-report")

  state.mode = "script"
  await mkdir(join(fixture.directory, ".apexo", "workflows"), { recursive: true })
  const saved = join(fixture.directory, ".apexo", "workflows", "native-review.rhai")
  await writeFile(saved, 'let meta = #{name: "native-review", description: "native saved script"}; phase("Review"); let results = parallel([#{prompt:"Review A",capability_mode:"read-only"},#{prompt:"Review B",capability_mode:"read-only"}]); complete(results);')
  const budget = await start(session, { source: { type: "saved", name: "native-review" }, agentBudget: 1 })
  const limited = await settled(budget)
  assert.equal(limited.status, "budget_limited", limited.message)
  assert.equal(state.calls.length, 6)
  await idle()
  await writeFile(saved, 'throw "Source changed after durable admission";')
  await fixture.api(`${budget.target}/resume`, { agentBudget: 2 })
  const resumed = await settled(budget)
  assert.equal(resumed.status, "completed", resumed.message)
  assert.equal(resumed.agentsSpent, 2)
  assert.equal(resumed.result.length, 2)
  assert.equal(state.calls.length, 8)
  await idle()
  checks.push("saved-rhai-whole-panel-budget-and-immutable-source-resume")

  const scratch = await start(session, { source: { type: "script", name: "scratch", script: 'write_scratch_file("note.txt", "native scratch"); complete(read_scratch_file("note.txt"));' } })
  assert.equal((await settled(scratch)).result, "native scratch")
  await idle()
  assert.equal(state.calls.length, 8)
  checks.push("first-party-private-scratch-host-operations-without-provider-work")

  state.mode = "pause"
  state.hold = Promise.withResolvers()
  const paused = await start(session, { source: { type: "script", name: "pause", script: 'let answer = agent("Wait for native evidence"); complete(answer.output);' }, agentBudget: 1 })
  await poll(() => state.calls.some((call) => call.mode === "pause"), "held native workflow child", 15_000)
  const parentAndChild = Object.keys((await fixture.api("/api/session/active")).data)
  assert.equal(parentAndChild.length, 2)
  await fixture.api(`${paused.target}/pause`, undefined, "POST")
  await idle()
  assert.equal((await fixture.api(paused.target)).status, "paused")
  await fixture.api(`${paused.target}/stop`, undefined, "POST")
  assert.equal((await fixture.api(paused.target)).status, "cancelled")
  state.hold.resolve(); state.hold = undefined
  state.mode = "resume"
  await fixture.api(`${paused.target}/resume`, {})
  const afterPause = await settled(paused)
  assert.equal(afterPause.status, "completed", afterPause.message)
  assert.equal(afterPause.agentsSpent, 1)
  assert.equal(afterPause.children.length, 1)
  await idle()
  checks.push("pause-awaits-parent-and-child-teardown-explicit-resume-reuses-reservation")

  const stopBudget = await start(session, { source: { type: "script", name: "stop-budget", script: 'complete(parallel([#{prompt:"A"},#{prompt:"B"}]));' }, agentBudget: 1 })
  assert.equal((await settled(stopBudget)).status, "budget_limited")
  await fixture.api(`${stopBudget.target}/stop`, undefined, "POST")
  assert.equal((await fixture.api(stopBudget.target)).status, "cancelled")
  await idle()
  checks.push("stop-cancels-paused-and-budget-limited-runs")

  state.mode = "crash"
  state.hold = Promise.withResolvers()
  const crashed = await start(session, { source: { type: "script", name: "crash", script: 'complete(agent("Crash-held evidence").output);' }, agentBudget: 1 })
  await poll(() => state.calls.some((call) => call.mode === "crash"), "crash-held child", 15_000)
  await fixture.crash()
  state.hold.resolve(); state.hold = undefined
  const before = state.calls.length
  await fixture.reopen()
  assert.equal(state.calls.length, before)
  assert.equal((await fixture.api(crashed.target)).status, "running")
  const denied = await request(`${crashed.target}/resume`, {})
  assert.equal(denied.status, 409)
  await denied.json()
  assert.equal(state.calls.length, before)
  checks.push("process-death-keeps-records-without-automatic-child-retry")

  if (process.argv.includes("--ownership")) {
    state.mode = "ownership"
    state.hold = Promise.withResolvers()
    await fixture.api(`/api/session/${session.id}/prompt`, { prompt: { text: "ORDINARY_SESSION_OWNERSHIP" } })
    await poll(() => state.calls.some((call) => call.mode === "ownership"), "ordinary prompt after old workflow process death", 15_000)
    assert.ok((await fixture.api("/api/session/active")).data[session.id])
    await fixture.api(`${crashed.target}/stop`, undefined, "POST")
    assert.ok((await fixture.api("/api/session/active")).data[session.id], "Stopping an old workflow must not interrupt a new ordinary Session drain")
    state.hold.resolve(); state.hold = undefined
    await idle()
    checks.push("stopping-stale-workflow-does-not-interrupt-unrelated-session-drain")
  }

  console.log(JSON.stringify({ kind, checks, passed: checks.length, providerCalls: state.calls.length }, null, 2))
} finally {
  state.hold?.resolve()
  await writeFile(join(fixture.output, "native-workflow-results.json"), JSON.stringify({ kind, checks, calls: state.calls }, null, 2))
  await fixture.close()
}
