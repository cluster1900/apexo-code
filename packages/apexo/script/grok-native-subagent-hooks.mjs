// Native owned Task Hook acceptance. Installed reference runs are separate evidence.
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const home = await mkdtemp(join(tmpdir(), "apexo-subagent-hooks-"))
const log = join(home, "hooks.jsonl")
const modefile = join(home, "mode")
const release = join(home, "release")
await mkdir(join(home, "hooks"))
await writeFile(
  join(home, "hook.py"),
  `import json,os,sys,time,signal
value=json.load(sys.stdin)
value['pid']=os.getpid()
with open(sys.argv[1],'a') as out: out.write(json.dumps(value)+'\\n')
mode=open(sys.argv[2]).read()
if value['hook_event_name']=='SubagentStop':
 if mode=='continue':
  print(json.dumps({'continue':False} if value['stop_hook_active'] else {'decision':'block','reason':'HOOK_VERIFY'}))
 else:
  signal.signal(signal.SIGTERM, lambda *_: None)
  while not os.path.exists(sys.argv[3]): time.sleep(.01)
  print(json.dumps({'continue':False}))
`,
)
const group = {
  matcher: "helper",
  hooks: [
    { type: "command", command: `python3 '${join(home, "hook.py")}' '${log}' '${modefile}' '${release}'`, timeout: 30 },
  ],
}
await writeFile(
  join(home, "hooks/config.json"),
  JSON.stringify({
    hooks: {
      SubagentStart: [group],
      SubagentStop: [group],
      SubagentEnd: [group],
      subagent_end: [group],
      subagentEnd: [group],
    },
  }),
)
const rows = async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse)
const runs = []
let current
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  env: { GROK_HOME: home },
  next: async ({ body, input, ancillary }) => {
    const tools = (body.tools ?? []).map((tool) => tool.function ?? tool)
    const text = (value) =>
      typeof value === "string" ? value : (value ?? []).map((part) => part.text ?? "").join("\n")
    if (
      ancillary ||
      tools.some((tool) => tool.name === "session_title") ||
      input.some((item) => item.role === "system" && text(item.content).includes("ultra-short dashboard line"))
    )
      return { content: "Hook fixture" }
    const users = input
      .filter((item) => item.role === "user")
      .map((item) => text(item.content))
      .filter((value) => !value.startsWith("<system-update>"))
    if (users[0] === "HOOK_CHILD") {
      current.childCalls++
      if (current.childCalls > 1) {
        if (current.mode === "continue") assert.ok(input.some((item) => text(item.content).includes("HOOK_VERIFY")))
        if (current.mode === "queue") assert.equal(users.at(-1), "HOOK_CORRECTION")
      }
      return { content: `CHILD_${current.childCalls}` }
    }
    assert.equal(users[0], "HOOK_ROOT")
    if (!current.spawned) {
      current.spawned = true
      return { tool: "task", args: { description: "Hook child", prompt: "HOOK_CHILD", subagent_type: "helper" } }
    }
    return { content: "ROOT_DONE" }
  },
})
try {
  const config = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT)
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      task: { activeMessages: true },
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      agents: { helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
      providers: {
        xai: {
          api: {
            type: "aisdk",
            package: "@ai-sdk/xai",
            url: config.provider.xai.options.baseURL,
            settings: { apiKey: "fixture" },
          },
          models: {
            "grok-4.7": {
              name: "fixture",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  for (const mode of ["continue", "cancel", "queue"]) {
    current = { mode, childCalls: 0 }
    await writeFile(modefile, mode)
    const parent = (
      await fixture.api("/api/session", {
        location: { directory: fixture.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    await fixture.api(`/api/session/${parent.id}/prompt`, { prompt: { text: "HOOK_ROOT" } })
    await poll(async () => (await fixture.api(`/api/session/${parent.id}/task`)).length === 1, "Task launch")
    const child = (await fixture.api(`/api/session/${parent.id}/task`))[0].id
    if (mode !== "continue") {
      await poll(
        async () => (await rows()).some((row) => row.subagent_id === child && row.hook_event_name === "SubagentStop"),
        "owned held gate",
      )
      if (mode === "cancel") await fixture.api(`/api/session/${parent.id}/task/${child}/cancel`, undefined, "POST")
      if (mode === "queue") {
        const input = { inputID: "msg_hookqueuedcorrection", text: "HOOK_CORRECTION", delivery: "queue" }
        assert.equal((await fixture.api(`/api/session/${parent.id}/task/${child}/message`, input)).status, "admitted")
        await writeFile(release, "release")
      }
    }
    await poll(
      async () => (await fixture.api(`/api/session/${parent.id}/task/${child}`)).status !== "running",
      "Task settled",
      20000,
    )
    await fixture.api(`/api/session/${parent.id}/wait`, undefined, "POST")
    const result = await fixture.api(`/api/session/${parent.id}/task/${child}`)
    assert.equal(result.status, mode === "cancel" ? "cancelled" : "completed")
    if (mode !== "cancel") assert.equal(result.output, "CHILD_2")
    const seen = (await rows()).filter((row) => row.subagent_id === child)
    assert.equal(seen.filter((row) => row.hook_event_name === "SubagentStart").length, 1)
    assert.equal(seen.filter((row) => row.hook_event_name === "SubagentStop").length, mode === "cancel" ? 1 : 2)
    assert.equal(seen[0].session_id, parent.id)
    assert.ok(seen.every((row) => row.subagent_type === "helper"))
    for (const row of seen) assert.throws(() => process.kill(row.pid, 0))
    assert.equal(current.childCalls, mode === "cancel" ? 1 : 2)
    runs.push({ mode, childCalls: current.childCalls, hooks: seen.length, status: result.status })
  }
  await writeFile(join(fixture.output, "subagent-hooks.json"), JSON.stringify({ runs, rows: await rows() }, null, 2))
  console.log(JSON.stringify({ kind: process.argv[2] ?? "cli", checks: runs.length, runs, output: fixture.output }))
} finally {
  await writeFile(release, "cleanup")
  await fixture.close()
}
