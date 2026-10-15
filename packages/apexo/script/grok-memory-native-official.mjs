// Comparison only: installed Grok owns its own isolated ACP Sessions. No Apexo acceptance claim.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline } from "./grok-shell-fixture.mjs"

const output = await realpath(await mkdtemp(join(tmpdir(), "apexo-memory-native-reference-")))
// Installed Memory excludes temporary workspaces; this disposable Git root contains no user data.
const workspace = await mkdtemp(
  join(
    process.env.APEXO_MEMORY_REFERENCE_PARENT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
    ".memory-native-reference-",
  ),
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
  calls.push({ names: (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name), model: body.model })
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(
    [
      {
        id: "reference",
        object: "chat.completion.chunk",
        model: body.model,
        choices: [{ index: 0, delta: { role: "assistant", content: "REFERENCE_MEMORY_DONE" }, finish_reason: null }],
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
  for (const enabled of [false, true]) {
    const home = join(output, enabled ? "v2" : "legacy")
    await mkdir(home)
    await writeFile(
      join(home, "config.toml"),
      `[models]\ndefault = "memory-fixture"\n[model.memory-fixture]\nmodel = "fixture"\nname = "Memory reference"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "local-fixture"\napi_backend = "chat_completions"\ncontext_window = 100000\n[memory]\nenabled = true\n[memory_v2]\nenabled = ${enabled}\n`,
    )
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^(GROK_|XAI_|OPENAI_|ANTHROPIC_)/.test(key)),
    )
    const child = spawn(process.env.APEXO_GROK_BUILD_BIN ?? "grok", ["agent", "stdio"], {
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
      const before = calls.length
      const listing = await deadline(
        connection.extMethod("_x.ai/memory/list", { sessionId: session.sessionId }),
        15000,
        "official passive Memory list",
      )
      assert.equal(calls.length, before)
      const result = await deadline(
        connection.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "Reply briefly; inspect no files and call no tools." }],
        }),
        30000,
        "official advertised Memory tools",
      )
      assert.equal(result.stopReason, "end_turn")
      const names = [...new Set(calls.slice(before).flatMap((item) => item.names))]
      assert.ok(names.length > 0)
      checks.push({
        requestedBackend: enabled ? "v2" : "legacy",
        passiveListNoProvider: true,
        enabled: (listing.result ?? listing).enabled,
        disabledReason: (listing.result ?? listing).disabled_reason,
        memoryTools: names.filter((name) => name.includes("memory")),
        filesystemTools: names.filter((name) => ["grep", "read_file"].includes(name)),
        listingKeys: Object.keys(listing.result ?? listing),
      })
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
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await rm(workspace, { recursive: true, force: true })
}
