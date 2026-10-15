// Real Apexo CLI/Desktop provider turns; all hook commands and model responses are local fixtures.
import assert from "node:assert/strict"
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const home = await mkdtemp(join(tmpdir(), "apexo-stop-hooks-"))
await mkdir(join(home, "hooks"))
const log = join(home, "events.jsonl")
await writeFile(
  join(home, "stop.py"),
  `import json,sys
value=json.load(sys.stdin)
with open(sys.argv[1], "a") as log: log.write(json.dumps(value)+"\\n")
if "STOP_LIMIT" in value.get("last_assistant_message", ""):
 print(json.dumps({"decision":"block","reason":"STOP_LIMIT_CONTEXT"}))
elif not value.get("stop_hook_active"):
 print(json.dumps({"decision":"block","reason":"STOP_TRUSTED_CONTEXT"}))
else:
 print(json.dumps({"continue":False,"stopReason":"verification finished"}))
`,
)
await writeFile(
  join(home, "hooks/stop.json"),
  JSON.stringify({
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `python3 '${join(home, "stop.py")}' '${log}'`,
            },
          ],
        },
      ],
    },
  }),
)
const native = process.argv.includes("--v2")
const requests = []
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  env: { GROK_HOME: home },
  next({ body, text, ancillary }) {
    if (!ancillary) requests.push(body)
    return { content: `${text.includes("STOP_LIMIT") ? "STOP_LIMIT_RESPONSE" : "STOP_RESPONSE"}_${requests.length}` }
  },
})
try {
  if (native) await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  const run = async (text, count) => {
    const session = native
      ? (
          await runtime.api("/api/session", {
            location: { directory: runtime.directory },
            model: { providerID: "xai", id: "grok-4.7" },
            agent: "build",
          })
        ).data
      : await runtime.api("/session", { title: text })
    if (native) await runtime.api(`/api/session/${session.id}/prompt`, { prompt: { text } })
    else
      await runtime.api(`/session/${session.id}/prompt_async`, {
        model: { providerID: "xai", modelID: "grok-4.7" },
        parts: [{ type: "text", text }],
      })
    const messages = await poll(
      async () => {
        const values = native
          ? (await runtime.api(`/api/session/${session.id}/message`)).data
          : await runtime.api(`/session/${session.id}/message`)
        const assistants = values.filter((message) =>
          native
            ? message.type === "assistant" && message.time.completed
            : message.info.role === "assistant" && message.info.time.completed,
        )
        const statuses = native ? (await runtime.api("/api/session/active")).data : await runtime.api("/session/status")
        return assistants.length >= count && !statuses[session.id] ? values : undefined
      },
      `${text} settled`,
      60_000,
    )
    assert.equal(
      messages.filter((message) => (native ? message.type === "assistant" : message.info.role === "assistant")).length,
      count,
    )
    assert.equal(
      messages.filter((message) => (native ? message.type === "user" : message.info.role === "user")).length,
      1,
      "hooks must not fabricate user input",
    )
    return session
  }
  const session = await run("STOP_CONTINUE", 2)
  const context = requests.find((body) => JSON.stringify(body).includes("STOP_TRUSTED_CONTEXT"))
  assert.ok(context, "continuation context reached actual provider")
  const users = (context.messages ?? context.input ?? []).filter((message) => message.role === "user")
  if (native) {
    const history = (await runtime.api(`/api/session/${session.id}/message`)).data
    assert.ok(history.some((message) => message.type === "system" && message.text.includes("STOP_TRUSTED_CONTEXT")), "native context remains a durable system message")
  } else assert.ok(!JSON.stringify(users).includes("STOP_TRUSTED_CONTEXT"), "trusted hook is not a user message")
  await run("STOP_LIMIT", 9)
  const events = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse)
  assert.deepEqual(
    events.filter((event) => event.session_id === session.id).map((event) => event.stop_hook_active),
    [false, true],
  )
  assert.equal(events.length, 10, "two normal gates and eight bounded continuation gates; no idle observer duplicates")
  console.log(
    JSON.stringify({
      result: "pass",
      runtime: process.argv[2] ?? "cli",
      engine: native ? "v2" : "v1",
      scenarios: [
        "durable Stop continuation reaches provider as trusted context",
        "no fabricated user messages",
        "continue:false stops repeated work",
        "eight-continuation bound",
        "no duplicate idle Stop observer",
      ],
    }),
  )
} catch (error) {
  console.error(
    JSON.stringify({
      providerRequests: requests.length,
      calls: runtime.calls,
      hooks: await readFile(log, "utf8").catch(() => ""),
    }),
  )
  throw error
} finally {
  await runtime.close()
  await rm(home, { recursive: true, force: true })
}
