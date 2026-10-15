// Actual CLI/Electron backend with host-owned hooks and deterministic local provider.
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const home = await mkdtemp(join(tmpdir(), "apexo-hooks-host-"))
await mkdir(join(home, "hooks"))
const log = join(home, "events.jsonl")
const command = `cat >> '${log}'; printf '\\n' >> '${log}'`
await writeFile(
  join(home, "config.toml"),
  `[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype="command"\ncommand=${JSON.stringify(command)}\n`,
)
await writeFile(
  join(home, "policy.py"),
  `import json,sys
value=json.load(sys.stdin)
with open(sys.argv[1], "a") as log: log.write(json.dumps(value)+"\\n")
if value["tool_input"].get("target_file") == "rewrite-original.txt":
 print(json.dumps({"hookSpecificOutput":{"permissionDecision":"ask","permissionDecisionReason":"review rewritten path","updatedInput":{"target_file":"rewritten.txt"}}}))
elif value["tool_input"].get("target_file") == "hook-missing.txt":
 pass
else:
 print("blocked by host hook", file=sys.stderr)
 sys.exit(2)
`,
)
await writeFile(
  join(home, "hooks/policy.json"),
  JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "^Read$",
          hooks: [{ type: "command", command: `python3 '${join(home, "policy.py")}' '${log}'` }],
        },
      ],
      UserPromptSubmit: [{ hooks: [{ type: "command", command }] }],
      PreCompact: [{ hooks: [{ type: "command", command }] }],
      PostCompact: [{ hooks: [{ type: "command", command }] }],
      PostToolUseFailure: [{ hooks: [{ type: "command", command }] }],
    },
  }),
)
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  env: { GROK_HOME: home },
  next({ text, finished, ancillary }) {
    if (finished || ancillary) return { content: "HOOK_DONE" }
    return {
      tool: "read_file",
      args: {
        target_file: text.includes("HOOK_REWRITE")
          ? "rewrite-original.txt"
          : text.includes("HOOK_FAILURE")
            ? "hook-missing.txt"
            : "hook-target.txt",
        offset: 0,
        limit: 50,
      },
    }
  },
})
try {
  await writeFile(join(runtime.directory, "hook-target.txt"), "THIS MUST NOT REACH THE MODEL")
  const inspection = await runtime.api("/hooks")
  assert.ok(inspection.hooks.some((hook) => hook.event === "PreToolUse" && hook.supported))
  assert.ok(!JSON.stringify(inspection).includes("printf"))
  assert.ok(!JSON.stringify(inspection).includes("blocked by host hook"))
  const session = await runtime.api("/session", { title: "Host hook denial" })
  await runtime.api(`/session/${session.id}/prompt_async`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Read the hook target" }],
  })
  const tool = await poll(
    async () =>
      (await runtime.api(`/session/${session.id}/message`))
        .flatMap((message) => message.parts)
        .find((part) => part.type === "tool" && part.tool === "read_file" && part.state.status === "error"),
    "host hook denied read",
  )
  assert.match(tool.state.error, /blocked by host hook/)
  await writeFile(join(runtime.directory, "rewritten.txt"), "REWRITTEN_SAFE_CONTENT")
  const rewritten = await runtime.api("/session", { title: "Host hook rewrite and ask" })
  await runtime.api(`/session/${rewritten.id}/prompt_async`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "HOOK_REWRITE" }],
  })
  const permission = await poll(
    async () => (await runtime.api("/permission")).find((item) => item.sessionID === rewritten.id),
    "rewritten read permission",
  )
  assert.ok(
    permission.patterns.some((pattern) => pattern.endsWith("rewritten.txt")),
    JSON.stringify(permission),
  )
  assert.equal(permission.metadata.hookReason, "review rewritten path")
  await runtime.api(`/permission/${permission.id}/reply`, { reply: "once" })
  const completed = await poll(
    async () =>
      (await runtime.api(`/session/${rewritten.id}/message`))
        .flatMap((message) => message.parts)
        .find((part) => part.type === "tool" && part.state.status === "completed"),
    "rewritten read completed",
  )
  assert.match(completed.state.output, /REWRITTEN_SAFE_CONTENT/)
  await runtime.api(`/session/${rewritten.id}/summarize`, { providerID: "xai", modelID: "grok-4.7", auto: false })
  await poll(
    async () => (await readFile(log, "utf8")).includes('"hook_event_name":"PostCompact"'),
    "post-compaction hook",
  )
  const failed = await runtime.api("/session", { title: "Actual tool failure" })
  await runtime.api(`/session/${failed.id}/prompt_async`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "HOOK_FAILURE" }],
  })
  await poll(
    async () => (await readFile(log, "utf8")).includes('"hook_event_name":"PostToolUseFailure"'),
    "actual failure hook",
  )
  const events = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse)
  for (const name of [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUseFailure",
    "PreCompact",
    "PostCompact",
  ])
    assert.ok(
      events.some((event) => event.hook_event_name === name),
      name,
    )
  assert.equal(events.filter((event) => event.hook_event_name === "SessionStart").length, 3)
  assert.ok(
    !events.some((event) => event.hook_event_name === "PostToolUseFailure" && event.session_id === session.id),
    "pre-dispatch denial is not a tool failure",
  )
  console.log(
    JSON.stringify({
      result: "pass",
      runtime: process.argv[2] ?? "cli",
      scenarios: [
        "global TOML SessionStart",
        "JSON prompt hook",
        "PreToolUse exit-two denial",
        "once-per-session start",
        "rewritten arguments rechecked by permissions",
        "ask overrides automatic allow",
        "tool failure observer",
        "pre/post compaction observers",
      ],
    }),
  )
} finally {
  await runtime.close()
  await rm(home, { recursive: true, force: true })
}
