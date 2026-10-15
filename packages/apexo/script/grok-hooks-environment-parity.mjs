import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const home = await mkdtemp(join(tmpdir(), "apexo-hooks-environment-"))
await mkdir(join(home, "hooks"))
await writeFile(
  join(home, "environment.py"),
  `import os,json,sys
value=json.load(sys.stdin)
with open(sys.argv[1], "a") as out: out.write(json.dumps({"input":value,"session":os.environ["GROK_SESSION_ID"],"cwd":os.environ["GROK_WORKSPACE_ROOT"],"project":os.environ["CLAUDE_PROJECT_DIR"],"event":os.environ["GROK_HOOK_EVENT"],"name":os.environ["GROK_HOOK_NAME"],"default":sys.argv[2]})+"\\n")
`,
)
const log = join(home, "environment.jsonl")
await writeFile(
  join(home, "hooks/environment.json"),
  JSON.stringify({
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `python3 '\${HOOK_SCRIPT}' '\${HOOK_LOG}' "\${HOOK_EMPTY:-fallback}"`,
              env: {
                HOOK_SCRIPT: join(home, "environment.py"),
                HOOK_LOG: log,
                HOOK_EMPTY: "",
                GROK_SESSION_ID: "forged",
                GROK_WORKSPACE_ROOT: "forged",
                CLAUDE_PROJECT_DIR: "forged",
                GROK_HOOK_EVENT: "forged",
                GROK_HOOK_NAME: "forged",
              },
            },
            { type: "command", command: `touch '${join(home, "unset-spawned")}'; echo $APEXO_HOOK_UNSET_105` },
          ],
        },
      ],
    },
  }),
)
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  env: { GROK_HOME: home },
  next() {
    return { content: "HOOK_ENVIRONMENT_DONE" }
  },
})
try {
  const session = await runtime.api("/session", { title: "Host hook environment" })
  await runtime.api(`/session/${session.id}/prompt_async`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Verify hook environment" }],
  })
  const entry = await poll(
    async () =>
      readFile(log, "utf8")
        .then((text) => JSON.parse(text.trim().split("\n")[0]))
        .catch(() => undefined),
    "environment hook",
  )
  assert.equal(entry.session, session.id)
  assert.equal(entry.cwd, runtime.directory)
  assert.equal(entry.project, await realpath(runtime.directory))
  assert.equal(entry.event, "user_prompt_submit")
  assert.match(entry.name, /environment.json:UserPromptSubmit:0:0$/)
  assert.equal(entry.default, "fallback")
  await poll(
    async () =>
      (await runtime.api(`/session/${session.id}/message`)).some(
        (message) => message.info.role === "assistant" && message.info.time.completed,
      ),
    "completed environment turn",
  )
  assert.equal(await readFile(join(home, "unset-spawned")).catch(() => undefined), undefined)
  console.log(
    JSON.stringify({
      result: "pass",
      runtime: runtime.mode,
      scenarios: [
        "configured command expansion",
        "authentic runner identity",
        "shell modifier default",
        "unset reference prevents command spawn",
      ],
    }),
  )
} finally {
  await runtime.close()
  await rm(home, { recursive: true, force: true })
}
