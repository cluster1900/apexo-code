// First-party CLI/Desktop Hook preference acceptance; Grok is reference-only.
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const home = await mkdtemp(join(tmpdir(), "apexo-hook-preferences-"))
await mkdir(join(home, "hooks"))
const trace = join(home, "trace.jsonl")
const mode = join(home, "mode")
await writeFile(mode, "run")
await writeFile(
  join(home, "observe.py"),
  `import json,os,sys,time
value=json.load(sys.stdin)
with open(sys.argv[1], 'a') as out: out.write(json.dumps({'event':value['hook_event_name'],'session':value['session_id'],'pid':os.getpid(),'label':sys.argv[3]})+'\\n')
if value['hook_event_name']=='PreCompact':
 while open(sys.argv[2]).read()=='hold': time.sleep(.01)
`,
)
const configure = (label) =>
  writeFile(
    join(home, "hooks/preferences.json"),
    JSON.stringify({
      hooks: {
        PreCompact: [
          {
            hooks: [
              {
                type: "command",
                command: `python3 '${join(home, "observe.py")}' '${trace}' '${mode}' '${label}'`,
                timeout: 10,
              },
            ],
          },
        ],
        PostCompact: [
          {
            hooks: [
              { type: "command", command: `python3 '${join(home, "observe.py")}' '${trace}' '${mode}' '${label}'` },
            ],
          },
        ],
        Notification: [
          { hooks: [{ type: "command", command: "echo CONFIGURED_DISABLED_MUST_NOT_RUN", enabled: false }] },
        ],
      },
    }),
  )
await configure("captured")
const rows = async () => (await readFile(trace, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse)
const runtime = await startShellFixture(kind, {
  env: { GROK_HOME: home },
  config: { snapshot: false, compaction: { auto: false } },
  next: () => ({ content: "Preserve the apricot decision." }),
})
const checks = []
const route = (id) => `/api/session/${id}`
const hooks = (id) => runtime.api(`${route(id)}/hooks`)
const select = (id, hookID, enabled) => runtime.api(`${route(id)}/hooks/preference`, { hookID, enabled })
const compact = (id) => runtime.api(`${route(id)}/compact`, undefined, "POST")
const raw = async (id, body) => {
  const response = await fetch(
    `${runtime.url}${route(id)}/hooks/preference?directory=${encodeURIComponent(runtime.directory)}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  )
  const text = await response.text()
  return { status: response.status, text }
}
const create = async () => {
  const session = (
    await runtime.api("/api/session", {
      location: { directory: runtime.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
  await runtime.api(`${route(session.id)}/prompt`, { prompt: { text: "Remember the apricot decision." } })
  await runtime.api(`${route(session.id)}/wait`, undefined, "POST")
  return session.id
}
try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  const a = await create(),
    b = await create()
  const first = await hooks(a)
  const pre = first.inspection.hooks.find((hook) => hook.event === "PreCompact")
  const configured = first.inspection.hooks.find((hook) => hook.event === "Notification")
  assert.ok(pre.configurable)
  assert.equal(configured.configuredEnabled, false)
  assert.equal(configured.effectiveDisabled, true)
  assert.equal(configured.savedDisabled, false)
  assert.equal(configured.pendingChange, false)
  assert.ok(!JSON.stringify(first).includes("observe.py"))
  assert.ok(!JSON.stringify(first).includes("CONFIGURED_DISABLED_MUST_NOT_RUN"))
  const before = runtime.calls.length
  const disabled = await select(a, pre.id, false)
  assert.equal(disabled.generation, first.generation)
  assert.equal(disabled.inspection.hooks.find((hook) => hook.id === pre.id).effectiveDisabled, true)
  const other = (await hooks(b)).inspection.hooks.find((hook) => hook.id === pre.id)
  assert.equal(other.savedDisabled, true)
  assert.equal(other.effectiveDisabled, false)
  assert.equal(other.pendingChange, true)
  assert.equal(runtime.calls.length, before)
  checks.push("safe-inspection-global-saved-and-target-effective-choice-without-provider-work-or-registry-reload")
  await configure("edited")
  await compact(a)
  await compact(b)
  assert.deepEqual(
    (await rows()).map((row) => [row.event, row.session, row.label]),
    [
      ["PostCompact", a, "captured"],
      ["PreCompact", b, "captured"],
      ["PostCompact", b, "captured"],
    ],
  )
  const c = await create()
  await compact(c)
  assert.deepEqual(
    (await rows()).slice(-1).map((row) => [row.event, row.session, row.label]),
    [["PostCompact", c, "edited"]],
  )
  checks.push("captured-sessions-retain-effective-choices-and-definitions-while-new-session-adopts-saved-choice")
  await select(a, pre.id, true)
  await writeFile(mode, "hold")
  const count = (await rows()).length
  const held = compact(a)
  await poll(async () => (await rows()).length === count + 1, "captured PreCompact is held")
  const providerCount = runtime.calls.length
  await deadline(select(a, pre.id, false), 5000, "toggle while handler runs")
  assert.equal(runtime.calls.length, providerCount)
  process.kill((await rows()).at(-1).pid, 0)
  await writeFile(mode, "run")
  await held
  assert.deepEqual(
    (await rows()).slice(count).map((row) => row.event),
    ["PreCompact", "PostCompact"],
  )
  await compact(a)
  assert.equal((await rows()).at(-1).event, "PostCompact")
  assert.equal((await hooks(a)).generation, first.generation)
  checks.push("toggle-does-not-cancel-started-handler-and-applies-to-next-dispatch")
  await runtime.crash()
  await runtime.reopen()
  const d = await create()
  await compact(d)
  assert.deepEqual(
    (await rows()).slice(-1).map((row) => [row.event, row.session]),
    [["PostCompact", d]],
  )
  assert.equal((await hooks(d)).inspection.hooks.find((hook) => hook.id === pre.id).effectiveDisabled, true)
  checks.push("saved-choice-survives-process-restart")
  const preferences = join(runtime.env.XDG_DATA_HOME, "apexo", "hooks", "preferences.json")
  const saved = await readFile(preferences, "utf8")
  await writeFile(preferences, "corrupt")
  const corrupt = await hooks(d)
  assert.equal(corrupt.preferenceFailure, "invalid")
  assert.equal(corrupt.inspection.hooks.find((hook) => hook.id === pre.id).effectiveDisabled, true)
  const calls = runtime.calls.length
  assert.equal((await raw(d, { hookID: pre.id, enabled: true })).status, 503)
  assert.equal(await readFile(preferences, "utf8"), "corrupt")
  assert.equal(runtime.calls.length, calls)
  await writeFile(preferences, saved)
  assert.equal((await hooks(d)).preferenceFailure, undefined)
  checks.push("corrupt-store-is-visible-and-rejected-without-overwriting-or-forgetting-effective-state")
  const uncaptured = (await runtime.api("/api/session", { location: { directory: runtime.directory } })).data.id
  assert.equal((await raw(uncaptured, { hookID: pre.id, enabled: true })).status, 409)
  assert.equal((await raw(d, { hookID: `hook_${"f".repeat(64)}`, enabled: true })).status, 400)
  await runtime.api(route(d), undefined, "DELETE")
  assert.equal((await raw(d, { hookID: pre.id, enabled: true })).status, 404)
  assert.equal(runtime.calls.length, calls)
  checks.push("uncaptured-unknown-and-deleted-targets-cannot-activate-hooks")
  console.log(
    JSON.stringify(
      { kind, passed: checks.length, checks, providerCalls: runtime.calls.length, trace: await rows() },
      null,
      2,
    ),
  )
} finally {
  await writeFile(mode, "run")
  await runtime.close()
}
