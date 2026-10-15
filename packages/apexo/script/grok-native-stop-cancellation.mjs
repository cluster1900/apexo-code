// Native Session cancellation must join its normal-completion Hook command.
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

assert.ok(process.versions.bun, "Run with the repository-pinned Bun")
const kind = process.argv[2] ?? "cli"
const home = await mkdtemp(join(tmpdir(), "apexo-stop-cancellation-"))
const trace = join(home, "trace.jsonl")
const script = join(home, "held-hook.mjs")
await mkdir(join(home, "hooks"))
await writeFile(
  script,
  `import {appendFile} from "node:fs/promises"; const input=JSON.parse(await Bun.stdin.text()); process.on("SIGTERM",()=>{}); await appendFile(${JSON.stringify(trace)},JSON.stringify({sessionID:input.session_id,pid:process.pid})+"\\n"); setInterval(()=>{},1000);`,
)
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
await writeFile(
  join(home, "hooks/stop.json"),
  JSON.stringify({
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: `exec ${quote(process.execPath)} ${quote(script)}` }] }],
    },
  }),
)
const rows = async () => (await readFile(trace, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse)
const calls = []
const runtime = await startShellFixture(kind, {
  env: { GROK_HOME: home },
  config: { snapshot: false, compaction: { auto: false } },
  next({ body }) {
    calls.push(body)
    return { content: "The ordinary provider turn is complete." }
  },
})
const checks = []
try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  for (const action of ["interrupt", "delete"]) {
    const session = (
      await runtime.api("/api/session", {
        location: { directory: runtime.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    const route = `/api/session/${session.id}`
    const before = calls.length
    await runtime.api(`${route}/prompt`, { prompt: { text: `Finish before ${action}` } })
    const row = await poll(
      async () => (await rows()).find((item) => item.sessionID === session.id),
      "held normal Stop hook has published its PID",
      30000,
    )
    process.kill(row.pid, 0)
    await deadline(
      action === "interrupt"
        ? runtime.api(`${route}/interrupt`, undefined, "POST")
        : runtime.api(route, undefined, "DELETE"),
      10000,
      `${action} joins the owned hook`,
    )
    assert.throws(() => process.kill(row.pid, 0), `${action} returned before process cleanup`)
    assert.equal(calls.length - before, 1)
    assert.equal((await rows()).filter((item) => item.sessionID === session.id).length, 1)
    checks.push(`${action}-joins-term-ignoring-hook-with-one-provider-turn`)
    if (action === "interrupt") {
      await runtime.api(`${route}/wait`, undefined, "POST")
      await runtime.api(`${route}/interrupt`, undefined, "POST")
      assert.equal((await rows()).filter((item) => item.sessionID === session.id).length, 1)
      assert.equal(calls.length - before, 1)
      checks.push("idle-interrupt-does-not-replay-held-hook-or-provider")
    }
    if (action === "delete") {
      await runtime.api("/api/session", { id: session.id, location: { directory: runtime.directory } })
      assert.deepEqual((await runtime.api(`${route}/message`)).data, [])
      checks.push("deleted-session-id-reuse-has-no-late-history")
    }
  }
  console.log(JSON.stringify({ kind, passed: checks.length, checks, providerCalls: calls.length }, null, 2))
} finally {
  await runtime.close()
  for (const row of await rows()) {
    try {
      process.kill(row.pid, "SIGKILL")
    } catch {}
  }
}
