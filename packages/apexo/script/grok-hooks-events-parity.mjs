// Real local CLI/Desktop permission and cancellation boundaries in both Apexo engines.
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const native = process.argv.includes("--v2")
const home = await mkdtemp(join(tmpdir(), "apexo-hook-events-"))
await mkdir(join(home, "hooks"))
const log = join(home, "events.jsonl")
const command = `python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)))' >> '${log}'`
await writeFile(
  join(home, "hooks/events.json"),
  JSON.stringify({
    hooks: Object.fromEntries([
      ["beforeReadFile", [{ hooks: [{ type: "command", command }] }]],
      ["permission_denied", [{ matcher: "Read", hooks: [{ type: "command", command }] }]],
      ["notification", [{ matcher: "permission_prompt", hooks: [{ type: "command", command }] }]],
      ["PostToolUseFailure", [{ hooks: [{ type: "command", command }] }]],
      ["stopCancelled", [{ matcher: "user_interrupt", hooks: [{ type: "command", command }] }]],
    ]),
  }),
)
const state = { held: [], requests: 0 }
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  env: { GROK_HOME: home },
  config: { permission: { "*": "allow", read: { "*": "ask", "*blocked.txt": "deny" } } },
  async next({ body, text, finished, ancillary }) {
    if (ancillary) return { content: "HOOK_EVENT_ACK" }
    state.requests++
    if (text.includes("HOOK_CANCEL")) {
      await new Promise((resolve) => state.held.push(resolve))
      return { content: "CANCELLED_FIXTURE" }
    }
    if (finished) return { content: "HOOK_EVENT_DONE" }
    const names = body.tools.map((item) => item.function?.name ?? item.name)
    const tool = native ? "read" : "read_file"
    assert.ok(names.includes(tool), `${tool} advertised`)
    const file = text.includes("HOOK_POLICY") ? "blocked.txt" : "review.txt"
    return { tool, args: native ? { path: file, offset: 1, limit: 10 } : { target_file: file, offset: 0, limit: 10 } }
  },
})
const events = async () =>
  (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(JSON.parse)
try {
  if (native) await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  await writeFile(join(runtime.directory, "review.txt"), "MUST_NOT_BE_READ")
  await writeFile(join(runtime.directory, "blocked.txt"), "MUST_NOT_BE_READ")
  const create = async (text) => {
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
    return session
  }
  const rejected = await create("HOOK_REJECT")
  const request = await poll(async () => {
    const value = await runtime.api(native ? `/api/session/${rejected.id}/permission` : "/permission")
    return (native ? value.data : value).find((item) => item.sessionID === rejected.id)
  }, "real pending permission")
  await poll(
    async () =>
      (await events()).some((event) => event.hook_event_name === "Notification" && event.session_id === rejected.id),
    "permission notification",
  )
  await runtime.api(
    native ? `/api/session/${rejected.id}/permission/${request.id}/reply` : `/permission/${request.id}/reply`,
    { reply: "reject" },
  )
  const denied = await poll(
    async () =>
      (await events()).find(
        (event) => event.hook_event_name === "PermissionDenied" && event.session_id === rejected.id,
      ),
    "rejected permission hook",
  )
  assert.equal(denied.toolName, native ? "read" : "read_file")
  assert.equal(denied.toolInput[native ? "path" : "target_file"], "review.txt")
  assert.ok(denied.toolUseId)
  const policy = await create("HOOK_POLICY")
  await poll(
    async () =>
      (await events()).some((event) => event.hook_event_name === "PermissionDenied" && event.session_id === policy.id),
    "policy denial hook",
  )
  assert.ok(
    !(await events()).some((event) => event.hook_event_name === "Notification" && event.session_id === policy.id),
  )
  const cancelling = await create("HOOK_CANCEL")
  await poll(async () => state.held.length > 0, "provider in flight")
  const interrupt = () =>
    runtime.api(
      native ? `/api/session/${cancelling.id}/interrupt` : `/session/${cancelling.id}/abort`,
      undefined,
      "POST",
    )
  await interrupt()
  await poll(
    async () =>
      (await events()).some((event) => event.hook_event_name === "StopCancelled" && event.session_id === cancelling.id),
    "actual cancellation hook",
  )
  await interrupt()
  const final = await events()
  assert.equal(
    final.filter((event) => event.hook_event_name === "StopCancelled" && event.session_id === cancelling.id).length,
    1,
  )
  assert.ok(
    !final.some(
      (event) => event.hook_event_name === "PostToolUseFailure" && [rejected.id, policy.id].includes(event.session_id),
    ),
    "permission denial is not tool execution failure",
  )
  assert.ok(
    final.some((event) => event.hook_event_name === "Notification" && event.notificationType === "permission_prompt"),
  )
  if (!native)
    assert.ok(
      final.some((event) => event.hook_event_name === "PreToolUse"),
      "external event alias dispatched",
    )
  console.log(
    JSON.stringify({
      result: "pass",
      runtime: process.argv[2] ?? "cli",
      engine: native ? "v2" : "v1",
      scenarios: [
        "event aliases",
        "real permission notification",
        "user rejection preserves tool input",
        "policy denial without prompt",
        "explicit active cancellation",
        "idle interruption emits nothing",
      ],
    }),
  )
} catch (error) {
  console.error(JSON.stringify({ events: await events(), requests: state.requests, output: runtime.output }))
  throw error
} finally {
  state.held.forEach((resolve) => resolve())
  await runtime.close()
  await rm(home, { recursive: true, force: true })
}
