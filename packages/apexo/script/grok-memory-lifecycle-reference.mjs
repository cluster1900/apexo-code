// Comparison only: installed Grok owns its own isolated ACP Sessions. No Apexo acceptance claim.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline } from "./grok-shell-fixture.mjs"

const output = await realpath(await mkdtemp(join(tmpdir(), "apexo-memory-native-reference-")))
// Installed Memory excludes temporary workspaces; this disposable Git root contains no user data.
const workspace = await mkdtemp(
  join(process.env.APEXO_MEMORY_REFERENCE_PARENT ?? homedir(), ".memory-native-reference-"),
)
const checks = []
const calls = []
const provider = createServer(async (request, response) => {
  if (request.method !== "POST") {
    response.end(JSON.stringify({ data: [{ id: "fixture" }] }))
    return
  }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  const text = JSON.stringify(body.messages ?? body.input)
  const kind = text.includes("Extract durable, reusable observations")
    ? "capture"
    : text.includes("Consolidate only the supplied claimed observations")
      ? "dream"
      : "main"
  const input = kind === "dream" ? JSON.parse(body.messages.at(-1).content) : undefined
  const content =
    kind === "capture"
      ? JSON.stringify({
          outcome: "observations",
          observations: [
            {
              type: "project",
              statement: "REFERENCE_MEMORY_FACT request identifiers are immutable.",
              topic_hint: "requests",
              keywords: [],
              aliases: [],
              body: null,
            },
          ],
        })
      : kind === "dream"
        ? JSON.stringify({
            operations: [
              {
                op: "create",
                path: "topics/requests.md",
                content:
                  "# Request identifiers\nRequest identity invariants.\n\n## Identity\nRequest identifiers are immutable.",
                evidence: input.claimed_observations.map((item) => item[0]),
              },
            ],
          })
        : "REFERENCE_MEMORY_DONE"
  calls.push({
    kind,
    names: (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name),
    model: body.model,
    input,
  })
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(
    [
      {
        id: "reference",
        object: "chat.completion.chunk",
        model: body.model,
        choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
      },
      {
        id: "reference",
        object: "chat.completion.chunk",
        model: body.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ]
      .map((item) => `data: ${JSON.stringify({ created: 1, ...item })}\n\n`)
      .join("") + "data: [DONE]\n\n",
  )
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
const runChild = async (command, args, options) => {
  const child = spawn(command, args, options)
  await deadline(
    new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))))
    }),
    10000,
    "reference setup",
  )
}
try {
  await runChild("git", ["init", "--quiet"], { cwd: workspace, stdio: "ignore" })
  for (const enabled of [true]) {
    const home = join(output, enabled ? "v2" : "legacy")
    await mkdir(home)
    await writeFile(
      join(home, "config.toml"),
      `[models]\ndefault = "memory-fixture"\n[model.memory-fixture]\nmodel = "fixture"\nname = "Memory reference"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = true\n[memory_v2]\nenabled = ${enabled}\nautomatic_dream_enabled = false\n`,
    )
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^(GROK_|XAI_|OPENAI_|ANTHROPIC_)/.test(key)),
    )
    const child = spawn(process.env.GROK_BIN ?? "grok", ["agent", "stdio"], {
      cwd: workspace,
      env: {
        ...env,
        HOME: home,
        GROK_HOME: home,
        GROK_CONFIG: "",
        GROK_CONFIG_PATH: "",
        GROK_MEMORY: "1",
        GROK_MANAGED_MCPS_ENABLED: "0",
        XAI_API_KEY: "local-fixture",
        ...Object.fromEntries(
          ["CONFIG", "DATA", "STATE", "CACHE", "RUNTIME"]
            .map((kind) => [`XDG_${kind}_HOME`, join(home, `xdg-${kind.toLowerCase()}`)])
            .filter(([key]) => key !== "XDG_RUNTIME_HOME"),
        ),
        XDG_RUNTIME_DIR: join(home, "xdg-runtime"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    })
    const exited = new Promise((resolve) => child.once("exit", resolve))
    child.stderr.resume()
    const connection = new ClientSideConnection(
      () => ({
        async sessionUpdate() {},
        async extNotification() {},
        async requestPermission(params) {
          const option = params.options.find((item) => item.kind === "allow_once")
          assert.ok(option)
          return { outcome: { outcome: "selected", optionId: option.optionId } }
        },
      }),
      ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
    )
    try {
      await deadline(
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "apexo-memory-comparison", version: "1" },
        }),
        15000,
        "official initialization",
      )
      const session = await deadline(
        connection.newSession({ cwd: workspace, mcpServers: [] }),
        15000,
        "official Session",
      )
      const method = (name, args) =>
        deadline(connection.extMethod(`_x.ai/memory/${name}`, args), 30000, `official ${name}`)
      const listing = await method("list", { sessionId: session.sessionId })
      assert.equal(calls.length, 0)
      checks.push({ name: "passive-list", result: listing, providerCalls: calls.length })
      const emptyFlush = await method("flush", { session_id: session.sessionId })
      const emptyDream = await method("dream", { session_id: session.sessionId })
      assert.equal(calls.length, 0)
      checks.push({ name: "empty-flush-dream", flush: emptyFlush, dream: emptyDream, providerCalls: calls.length })
      const result = await deadline(
        connection.prompt({
          sessionId: session.sessionId,
          prompt: [
            {
              type: "text",
              text: "REFERENCE_MEMORY_FACT request identifiers are immutable. Reply briefly without tools.",
            },
          ],
        }),
        30000,
        "official main turn",
      )
      assert.equal(result.stopReason, "end_turn")
      const flush = await method("flush", { session_id: session.sessionId })
      checks.push({ name: "completed-turn-flush", result: flush, calls: calls.map((x) => x.kind) })
      assert.equal(flush.disposition, "flushed")
      assert.equal(calls.filter((x) => x.kind === "capture").length, 1)
      assert.equal(calls.find((x) => x.kind === "capture").names.length, 0)
      const beforeRepeat = calls.length
      const repeat = await method("flush", { session_id: session.sessionId })
      assert.equal(calls.length, beforeRepeat)
      checks.push({ name: "repeat-flush-no-extraction", result: repeat })
      const dream = await method("dream", { session_id: session.sessionId })
      checks.push({ name: "manual-dream", result: dream, calls: calls.map((x) => x.kind) })
      assert.equal(dream.disposition, "completed")
      assert.equal(calls.filter((x) => x.kind === "dream").length, 1)
      assert.equal(calls.find((x) => x.kind === "dream").names.length, 0)
      const beforeEmpty = calls.length
      const emptyAfter = await method("dream", { session_id: session.sessionId })
      assert.equal(calls.length, beforeEmpty)
      assert.equal(emptyAfter.disposition, "no_work")
      checks.push({ name: "repeat-dream-no-provider", result: emptyAfter })
      await method("toggle", { sessionId: session.sessionId, enabled: false })
      const disabledFlush = await method("flush", { session_id: session.sessionId })
      const disabledDream = await method("dream", { session_id: session.sessionId })
      assert.equal(calls.length, beforeEmpty)
      assert.equal(disabledFlush.disposition, "disabled")
      assert.equal(disabledDream.disposition, "disabled")
      checks.push({ name: "disabled-no-provider", flush: disabledFlush, dream: disabledDream })
    } finally {
      child.kill("SIGTERM")
      await deadline(exited, 10000, "official joined shutdown").catch(async () => {
        child.kill("SIGKILL")
        await exited
      })
    }
  }
  await writeFile(join(output, "evidence.json"), JSON.stringify({ checks, calls }, null, 2))
  console.log(
    JSON.stringify({ result: "pass", comparisonOnly: true, checks, providerCalls: calls.length, output }, null, 2),
  )
} finally {
  await writeFile(join(output, "observed.json"), JSON.stringify({ checks, calls }, null, 2))
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await rm(workspace, { recursive: true, force: true })
}
