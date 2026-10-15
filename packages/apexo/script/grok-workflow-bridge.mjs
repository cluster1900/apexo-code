// Compatibility-parent acceptance uses Apexo's native workflow host, never the legacy prompt loop.
import assert from "node:assert/strict"
import { mkdir, writeFile, access } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const state = { calls: [], hold: Promise.withResolvers() }
const fixture = await startShellFixture(kind, { config: { snapshot: false }, next: async ({ body }) => {
  state.calls.push(body)
  if (state.hold) await state.hold.promise
  return state.calls.length === 1
    ? { tool: "write", args: { file_path: join(fixture.directory, "forbidden.txt"), content: "must not exist" } }
    : { content: "BRIDGE_DONE" }
} })
const checks = []
try {
  await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const parent = await fixture.api("/session", { title: "Legacy workflow parent", permission: [
    { permission: "*", pattern: "*", action: "allow" }, { permission: "write", pattern: "*", action: "deny" },
  ] })
  await fixture.api(`/session/${parent.id}/message`, { noReply: true, model: { providerID: "xai", modelID: "grok-4.7" }, agent: "build", parts: [{ type: "text", text: "IMMUTABLE_PARENT_REFERENCE" }] })
  const root = `/api/session/${parent.id}/workflow`
  const project = join(fixture.directory, ".apexo", "workflows")
  const user = join(fixture.env.XDG_CONFIG_HOME, "apexo", "workflows")
  await mkdir(project, { recursive: true }); await mkdir(user, { recursive: true })
  await writeFile(join(project, "bridge-review.rhai"), 'complete(agent("Review the parent reference").output);')
  await writeFile(join(user, "bridge-review.rhai"), "invalid user script ! !")
  await writeFile(join(user, "user-only.rhai"), 'complete("user");')
  const sources = await fixture.api(`${root}/sources`)
  assert.equal(sources.filter((source) => source.name === "bridge-review").length, 1)
  assert.equal(sources.find((source) => source.name === "bridge-review").scope, "project")
  assert.equal(sources.find((source) => source.name === "user-only").scope, "user")
  assert.equal(sources.find((source) => source.name === "deep-research").scope, "builtin")
  assert.equal((await fixture.api(`${root}/validate`, { source: { type: "saved", name: "bridge-review" } })).valid, true)
  const invalid = await fixture.api(`${root}/validate`, { source: { type: "script", name: "invalid", script: "let broken = ;" } })
  assert.equal(invalid.valid, false)
  assert.ok(invalid.diagnostics.length)
  assert.equal(state.calls.length, 0)
  assert.deepEqual(await fixture.api(`${root}/related`), [])
  checks.push("project-precedence-user-discovery-and-real-rhai-validation-without-admission")

  const run = await fixture.api(`${root}/launch`, { source: { type: "saved", name: "bridge-review" }, agentBudget: 1, agent: "build", model: { providerID: "xai", id: "grok-4.7" } })
  assert.notEqual(run.sessionID, parent.id)
  await poll(() => state.calls.length === 1, "native bridge child", 15_000)
  const active = (await fixture.api("/api/session/active")).data
  assert.ok(active[run.sessionID])
  assert.ok(!active[parent.id], "Legacy parent must never enter the native coordinator")
  assert.ok(JSON.stringify(state.calls[0]).includes("IMMUTABLE_PARENT_REFERENCE"))
  await fixture.api(`/session/${parent.id}/message`, { noReply: true, model: { providerID: "xai", modelID: "grok-4.7" }, agent: "build", parts: [{ type: "text", text: "LATE_PARENT_UPDATE" }] })
  state.hold.resolve(); state.hold = undefined
  const target = `/api/session/${run.sessionID}/workflow/${run.id}`
  const completed = await poll(async () => { const info = await fixture.api(target); return ["pending", "running"].includes(info.status) ? undefined : info }, "independent workflow bridge completion", 20_000)
  assert.equal(completed.status, "completed", completed.message)
  assert.equal(completed.result, "BRIDGE_DONE")
  assert.equal(state.calls.length, 2)
  assert.ok(state.calls.every((call) => !JSON.stringify(call).includes("LATE_PARENT_UPDATE")))
  await assert.rejects(access(join(fixture.directory, "forbidden.txt")))
  const related = await fixture.api(`${root}/related`)
  assert.equal(related.length, 1)
  assert.equal(related[0].sessionID, run.sessionID)
  assert.equal(related[0].id, run.id)
  const host = (await fixture.api(`/api/session/${run.sessionID}`)).data
  assert.equal(host.parentID, parent.id)
  checks.push("legacy-parent-native-host-independent-ownership-and-immutable-context")
  checks.push("copied-parent-deny-prevents-child-file-mutation")
  for (const sessionID of [run.sessionID, completed.children[0]]) {
    assert.equal((await fixture.api(`/session/${sessionID}`)).id, sessionID)
    const blocked = await fetch(`${fixture.url}/session/${sessionID}/message?directory=${encodeURIComponent(fixture.directory)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ noReply: true, parts: [{ type: "text", text: "LEGACY_MUST_NOT_ADMIT" }] }),
    })
    assert.equal(blocked.status, 400)
    await blocked.text()
  }
  const foreignControl = await fetch(`${fixture.url}${root}/${run.id}/stop?directory=${encodeURIComponent(fixture.directory)}`, { method: "POST" })
  assert.equal(foreignControl.status, 404)
  await foreignControl.text()
  assert.equal(state.calls.length, 2)
  checks.push("legacy-host-child-admission-blocked-and-control-owner-is-scoped")
  await fixture.crash(); await fixture.reopen()
  assert.equal((await fixture.api(`${root}/related`))[0].id, run.id)
  assert.equal(state.calls.length, 2)
  checks.push("durable-host-association-survives-process-reopen")
  console.log(JSON.stringify({ kind, checks, passed: checks.length, providerCalls: state.calls.length }, null, 2))
} finally {
  state.hold?.resolve()
  await writeFile(join(fixture.output, "workflow-bridge-results.json"), JSON.stringify({ kind, checks, calls: state.calls }, null, 2))
  await fixture.close()
}
