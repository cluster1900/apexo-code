import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const home = await mkdtemp(join(tmpdir(), "apexo-hooks-snapshot-"))
const log = join(home, "trace.jsonl")
await mkdir(join(home, "hooks"))
const config = join(home, "hooks/snapshot.json")
const configure = (value) =>
  writeFile(
    config,
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: `printf start >> '${join(home, "starts.txt")}'` }] }],
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: `python3 '${join(home, "trace.py")}' '${log}' '${value}'` }] },
        ],
      },
    }),
  )
await writeFile(
  join(home, "trace.py"),
  `import json,sys
value=json.load(sys.stdin)
with open(sys.argv[1], "a") as out: out.write(json.dumps({"session":value["session_id"],"value":sys.argv[2]})+"\\n")
`,
)
await configure("initial")
const hold = { ready: false, gate: undefined }
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  env: { GROK_HOME: home },
  async next({ ancillary }) {
    if (hold.gate && !ancillary) {
      hold.ready = true
      await hold.gate.promise
    }
    return { content: "SNAPSHOT_DONE" }
  },
})
try {
  const submit = async (session, count) => {
    await runtime.api(`/session/${session.id}/prompt_async`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      parts: [{ type: "text", text: `Snapshot turn ${count}` }],
    })
    await poll(
      async () =>
        (await runtime.api(`/session/${session.id}/message`)).filter(
          (item) => item.info.role === "assistant" && item.info.time.completed,
        ).length >= count,
      "snapshot turn complete",
    )
  }
  const first = await runtime.api("/session", { title: "Captured hook Session" })
  assert.deepEqual(await runtime.api(`/session/${first.id}/hooks`), {
    captured: false,
    generation: 0,
    inspection: null,
  })
  await runtime.api(`/session/${first.id}/message`, {
    noReply: true,
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Admission does not capture hooks" }],
  })
  assert.deepEqual(await runtime.api(`/session/${first.id}/hooks`), {
    captured: false,
    generation: 0,
    inspection: null,
  })
  await submit(first, 1)
  await configure("edited")
  await submit(first, 2)
  const second = await runtime.api("/session", { title: "Fresh hook Session" })
  await submit(second, 1)
  const before = runtime.calls.length
  const reloaded = await runtime.api(`/session/${first.id}/hooks/reload`, undefined, "POST")
  assert.equal(reloaded.generation, 2)
  assert.equal(runtime.calls.length, before)
  assert.equal(reloaded.inspection.hooks.length, 2)
  assert.ok(!JSON.stringify(reloaded).includes("trace.py"))
  await submit(first, 3)
  await configure("boundary")
  hold.gate = Promise.withResolvers()
  const active = submit(first, 4)
  await poll(() => hold.ready, "provider request held")
  const reload = runtime.api(`/session/${first.id}/hooks/reload`, undefined, "POST")
  assert.equal((await runtime.api(`/session/${first.id}/hooks`)).generation, 2)
  hold.gate.resolve()
  await active
  assert.equal((await reload).generation, 3)
  hold.gate = undefined
  await submit(first, 5)
  assert.equal(await readFile(join(home, "starts.txt"), "utf8"), "startstart")
  const entries = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse)
  assert.deepEqual(
    entries.map((entry) => entry.value),
    ["initial", "initial", "edited", "edited", "edited", "boundary"],
  )
  assert.deepEqual(
    entries.map((entry) => entry.session),
    [first.id, first.id, second.id, first.id, first.id, first.id],
  )
  console.log(
    JSON.stringify({
      result: "pass",
      runtime: process.argv[2] ?? "cli",
      scenarios: [
        "capture on first execution",
        "inspection and admission do not capture",
        "explicit reload discovers edits without provider work",
        "inspection excludes command bodies",
        "active reload waits for provider boundary",
        "reload does not restart SessionStart hooks",
        "existing Session retains immutable configuration",
        "new Session discovers edits",
        "one prompt hook per durable user turn",
      ],
    }),
  )
} finally {
  hold.gate?.resolve()
  await runtime.close()
  await rm(home, { recursive: true, force: true })
}
