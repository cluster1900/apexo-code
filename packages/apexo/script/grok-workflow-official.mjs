// Isolated installed-runtime comparison only; Apexo product code never invokes Grok.
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const checkpoint = process.argv.includes("--checkpoint")
const host = process.argv.includes("--host")
const output = await mkdtemp(join(tmpdir(), "apexo-workflow-official-"))
const home = join(output, "home"),
  cwd = join(output, "workspace")
await mkdir(join(home, "workflows"), { recursive: true })
await mkdir(cwd)
await writeFile(
  join(home, "workflows", "native-reference.rhai"),
  'let meta = #{name: "native-reference", description: "Isolated saved workflow comparison"}; ' +
    (checkpoint ? 'await_user("blocked", "Review evidence"); ' : "") +
    'let r = agent("Return OFFICIAL_WORKFLOW_CHILD", #{capability_mode: "read-only"}); complete(r.output);',
)
if (host) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
  git("init", "--initial-branch=fixture")
  await writeFile(join(cwd, "public.txt"), "before\n")
  git("add", "public.txt")
  git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture baseline",
  )
  const baseline = git("rev-parse", "HEAD")
  await writeFile(join(cwd, "public.txt"), "OFFICIAL_HOST_DIFF\n")
  await writeFile(
    join(home, "workflows", "native-reference.rhai"),
    `let meta = #{name:"native-reference",description:"Host operation comparison"}; let missing = false; try { render_template("missing-fixture-template", #{}); } catch (error) { missing = true; } let rejected = false; try { git_diff_since("--output=unwanted"); } catch (error) { rejected = true; } complete(#{diff:git_diff_since("${baseline}"),template_missing:missing,invalid_revision:rejected});`,
  )
}
const calls = [],
  events = [],
  logs = []
const provider = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (request.method !== "POST") return response.end(JSON.stringify({ data: [{ id: "fixture" }] }))
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push(body)
  const chunk = (delta, finish_reason = null) => ({
    id: "official-workflow",
    object: "chat.completion.chunk",
    created: 1,
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason }],
  })
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.write(`data: ${JSON.stringify(chunk({ role: "assistant", content: "OFFICIAL_WORKFLOW_CHILD" }))}\n\n`)
  response.write(
    `data: ${JSON.stringify({ ...chunk({}, "stop"), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\n`,
  )
  response.end("data: [DONE]\n\n")
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
await writeFile(
  join(home, "config.toml"),
  `[models]\ndefault = "fixture"\n[model.fixture]\nmodel = "fixture"\nname = "Workflow comparison"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[workflows]\nenabled = true\n[memory]\nenabled = false\n[cli]\nuse_leader = false\n`,
)
const child = spawn("grok", ["agent", "stdio", "--leader-socket", join(output, "leader.sock")], {
  cwd,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    HOME: home,
    GROK_HOME: home,
    GROK_CONFIG: "",
    GROK_CONFIG_PATH: "",
    GROK_WORKFLOWS: "1",
    GROK_MEMORY: "0",
    GROK_MANAGED_MCPS_ENABLED: "0",
    XAI_API_KEY: "fixture",
    ...Object.fromEntries(
      ["CURSOR", "CLAUDE", "CODEX"].flatMap((vendor) =>
        ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"].map((surface) => [`GROK_${vendor}_${surface}_ENABLED`, "0"]),
      ),
    ),
  },
})
const exited = new Promise((resolve) => child.once("exit", resolve))
child.stderr.on("data", (chunk) => logs.push(chunk))
const connection = new ClientSideConnection(
  () => ({
    async requestPermission() {
      return { outcome: { outcome: "cancelled" } }
    },
    async sessionUpdate(params) {
      events.push(params)
    },
    async extNotification(method, params) {
      events.push({ method, params })
    },
  }),
  ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
)
try {
  await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30000,
    "official initialize",
  )
  const session = await connection.newSession({ cwd, mcpServers: [] })
  await deadline(
    connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "/workflow native-reference --agent-budget 1" }],
    }),
    20000,
    "official saved workflow launch",
  )
  if (checkpoint) {
    await poll(
      () =>
        events.some(
          (event) =>
            event.params?.update?.sessionUpdate === "workflow_updated" && event.params.update.status === "blocked",
        ),
      "official user checkpoint",
      20000,
    )
    assert.equal(
      calls.filter((call) =>
        call.messages?.some(
          (message) => message.role === "user" && message.content === "Return OFFICIAL_WORKFLOW_CHILD",
        ),
      ).length,
      0,
    )
    await deadline(
      connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "/workflow resume native-reference" }],
      }),
      20000,
      "official checkpoint resume",
    )
  }
  if (host) {
    const update = await poll(
      () =>
        events.findLast(
          (event) =>
            event.params?.update?.sessionUpdate === "workflow_updated" && event.params.update.status === "complete",
        )?.params.update,
      "official host outcome",
      20000,
    )
    const result = JSON.parse(update.result_summary)
    assert.ok(result.diff.includes("OFFICIAL_HOST_DIFF"))
    assert.equal(result.template_missing, true)
    assert.equal(result.invalid_revision, true)
    console.log(
      JSON.stringify(
        {
          checks: ["installed-git-diff-host-operation", "unknown-template-rejected", "invalid-git-option-rejected"],
          providerCalls: calls.length,
          result,
          output,
        },
        null,
        2,
      ),
    )
  } else {
    await poll(
      () => calls.some((call) => JSON.stringify(call).includes("Return OFFICIAL_WORKFLOW_CHILD")),
      "official independent child",
      20000,
    )
    await poll(
      () =>
        events.some(
          (event) =>
            event.params?.update?.sessionUpdate === "workflow_updated" &&
            event.params.update.status === "complete" &&
            event.params.update.result_summary === "OFFICIAL_WORKFLOW_CHILD",
        ),
      "official workflow outcome",
      20000,
    )
    const children = calls.filter((call) =>
      call.messages?.some((message) => message.role === "user" && message.content === "Return OFFICIAL_WORKFLOW_CHILD"),
    )
    assert.equal(children.length, 1)
    assert.ok(children.every((call) => !(call.tools ?? []).some((tool) => tool.function?.name === "workflow")))
    console.log(
      JSON.stringify(
        {
          checks: [
            ...(checkpoint ? ["await-user-pauses-before-child-and-resumes-once"] : []),
            "installed-saved-rhai-runs-one-independent-child",
            "workflow-child-cannot-launch-nested-workflow",
          ],
          providerCalls: calls.length,
          workflowChildCalls: children.length,
        },
        null,
        2,
      ),
    )
  }
} finally {
  child.kill("SIGTERM")
  await deadline(exited, 10000, "official shutdown").catch(() => child.kill("SIGKILL"))
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(join(output, "comparison.json"), JSON.stringify({ calls, events }, null, 2))
  await writeFile(join(output, "stderr.log"), Buffer.concat(logs))
}
