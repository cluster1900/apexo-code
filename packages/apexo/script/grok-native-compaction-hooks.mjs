// Native CLI/Desktop compaction observers, using only Apexo's own Session API.
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const home = await mkdtemp(join(tmpdir(), "apexo-compaction-hooks-"))
const trace = join(home, "trace.jsonl")
const mode = join(home, "mode")
await mkdir(join(home, "hooks"))
await writeFile(mode, "deny")
await writeFile(
  join(home, "observer.py"),
  `import json,os,sys,time
value=json.load(sys.stdin)
with open(sys.argv[1], 'a') as out: out.write(json.dumps({'event':value['hook_event_name'],'source':value['source'],'session':value['session_id'],'pid':os.getpid(),'label':sys.argv[3]})+'\\n')
mode=open(sys.argv[2]).read()
if mode=='hold' and value['hook_event_name']=='PreCompact':
 while open(sys.argv[2]).read()==mode: time.sleep(.01)
if mode=='deny':
 print(json.dumps({'decision':'block','continue':False,'reason':'observer cannot veto'}))
 sys.exit(2)
`,
)
const configure = (label) =>
  writeFile(
    join(home, "hooks/compact.json"),
    JSON.stringify({
      hooks: Object.fromEntries(
        ["PreCompact", "PostCompact"].map((event) => [
          event,
          [
            {
              matcher: "manual",
              hooks: [
                {
                  type: "command",
                  command: `python3 '${join(home, "observer.py")}' '${trace}' '${mode}' '${label}'`,
                  timeout: 5,
                },
              ],
            },
          ],
        ]),
      ),
    }),
  )
await configure("captured")
const rows = async () => (await readFile(trace, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse)
const calls = []
const runtime = await startShellFixture(kind, {
  env: { GROK_HOME: home },
  config: { snapshot: false, compaction: { auto: false } },
  async next({ body }) {
    const seen = await rows()
    calls.push({ body, seen })
    if (calls.length === 1) return { content: "Remember the apricot decision" }
    if (calls.length === 2) return { content: "## Objective\nPreserve apricot" }
    return { error: { status: 400, message: "Summary unavailable" } }
  },
})
const checks = []
try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  const session = (
    await runtime.api("/api/session", {
      location: { directory: runtime.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
  const route = `/api/session/${session.id}`
  const raw = (path) =>
    fetch(`${runtime.url}${path}?directory=${encodeURIComponent(runtime.directory)}`, { method: "POST" })
  await runtime.api(`${route}/compact`, undefined, "POST")
  assert.deepEqual(await rows(), [])
  assert.equal(calls.length, 0)
  checks.push("empty-compaction-has-no-observers-or-provider-work")
  await runtime.api(`${route}/prompt`, { prompt: { text: "Remember apricot" } })
  await runtime.api(`${route}/wait`, undefined, "POST")
  await configure("changed-after-capture")
  await runtime.api(`${route}/compact`, undefined, "POST")
  assert.deepEqual(
    (await rows()).map((row) => [row.event, row.source, row.label]),
    [
      ["PreCompact", "manual", "captured"],
      ["PostCompact", "manual", "captured"],
    ],
  )
  assert.ok((await rows()).every((row) => row.session === session.id))
  assert.deepEqual(
    calls[1].seen.map((row) => row.event),
    ["PreCompact"],
  )
  assert.equal(calls.length, 2)
  checks.push("captured-observers-bracket-one-provider-turn-and-denial-does-not-veto")
  const history = (await runtime.api(`${route}/message`)).data
  assert.ok(history.some((message) => message.type === "compaction"))
  const failed = await raw(`${route}/compact`)
  assert.equal(failed.status, 503)
  await failed.text()
  assert.deepEqual(
    (await rows()).map((row) => row.event),
    ["PreCompact", "PostCompact", "PreCompact"],
  )
  assert.deepEqual((await runtime.api(`${route}/message`)).data, history)
  assert.equal(calls.length, 3)
  checks.push("failed-summary-has-no-post-observer-and-preserves-history")
  await writeFile(mode, "hold")
  const pending = raw(`${route}/compact`)
  await poll(async () => (await rows()).length === 4, "held PreCompact observer")
  const pid = (await rows())[3].pid
  await deadline(runtime.api(route, undefined, "DELETE"), 10000, "deletion joins observer")
  await (await pending).text()
  assert.throws(() => process.kill(pid, 0))
  assert.equal(calls.length, 3)
  assert.equal((await rows()).length, 4)
  checks.push("deletion-cancels-and-joins-pre-observer-without-provider-work")
  await runtime.api("/api/session", { id: session.id, location: { directory: runtime.directory } })
  assert.deepEqual((await runtime.api(`${route}/message`)).data, [])
  checks.push("reused-session-has-no-late-compaction-or-observer")
  console.log(
    JSON.stringify({ kind, checks, passed: checks.length, providerCalls: calls.length, trace: await rows() }, null, 2),
  )
} finally {
  await writeFile(mode, "released")
  await runtime.close()
}
