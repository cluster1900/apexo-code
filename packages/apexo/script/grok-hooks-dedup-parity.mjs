import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const home = await mkdtemp(join(tmpdir(), "apexo-hooks-dedup-"))
const log = join(home, "trace.jsonl")
await mkdir(join(home, "hooks"))
await writeFile(
  join(home, "trace.py"),
  `import json,os,sys
value=json.load(sys.stdin)
with open(sys.argv[1], "a") as out: out.write(json.dumps({"session":value["session_id"],"value":os.environ["HOOK_VALUE"],"name":os.environ["GROK_HOOK_NAME"]})+"\\n")
`,
)
const command = `python3 '${join(home, "trace.py")}' '${log}'`
await writeFile(
  join(home, "config.toml"),
  `[[hooks.UserPromptSubmit]]\n[[hooks.UserPromptSubmit.hooks]]\ntype="command"\ncommand=${JSON.stringify(command)}\ntimeout=2\n[hooks.UserPromptSubmit.hooks.env]\nHOOK_VALUE="config"\n`,
)
await writeFile(
  join(home, "hooks/duplicates.json"),
  JSON.stringify({
    hooks: {
      user_prompt_submit: [
        {
          hooks: [
            { type: "command", command, timeout: 10, env: { HOOK_VALUE: "duplicate-file" } },
            { type: "command", command: `${command}; true`, env: { HOOK_VALUE: "distinct" } },
          ],
        },
      ],
    },
  }),
)
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  env: { GROK_HOME: home },
  next() {
    return { content: "HOOK_DEDUP_DONE" }
  },
})
try {
  const inspection = await runtime.api("/hooks")
  const expected = [
    `${join(home, "config.toml")}:UserPromptSubmit:0:0`,
    `${join(home, "hooks/duplicates.json")}:UserPromptSubmit:0:1`,
  ]
  assert.deepEqual(
    inspection.hooks.map((hook) => hook.name),
    expected,
  )
  assert.ok(!JSON.stringify(inspection).includes("HOOK_VALUE"))
  const session = await runtime.api("/session", { title: "Host hook deduplication" })
  await runtime.api(`/session/${session.id}/prompt_async`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Verify duplicate hook configuration" }],
  })
  await poll(
    async () =>
      (await runtime.api(`/session/${session.id}/message`)).some(
        (message) => message.info.role === "assistant" && message.info.time.completed,
      ),
    "dedup turn complete",
  )
  const entries = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse)
  assert.deepEqual(
    entries.map((entry) => entry.value),
    ["config", "distinct"],
  )
  assert.deepEqual(
    entries.map((entry) => entry.name),
    expected,
  )
  assert.ok(entries.every((entry) => entry.session === session.id))
  console.log(
    JSON.stringify({
      result: "pass",
      runtime: process.argv[2] ?? "cli",
      scenarios: [
        "duplicate executes once",
        "config environment wins",
        "distinct raw command retained",
        "inspection and runtime preserve source identity",
      ],
    }),
  )
} finally {
  await runtime.close()
  await rm(home, { recursive: true, force: true })
}
