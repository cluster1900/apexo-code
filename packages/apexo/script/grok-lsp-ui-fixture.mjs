import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

export async function startLspUiFixture({ recovery = false } = {}) {
  const repo = resolve(import.meta.dir, "../../..")
  const runtime = await startShellFixture("cli", { next: () => ({ content: "UNEXPECTED_LSP_MODEL_WORK" }) })
  await runtime.crash()
  const trace = join(runtime.output, "lsp-trace.jsonl")
  const requests = join(runtime.output, "lsp-http.jsonl")
  const config = JSON.stringify({
    snapshots: false,
    model: "xai/grok-4.7",
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    lsp: {
      "a-live": {
        command: [process.execPath, join(repo, "packages/apexo/test/fixture/lsp-native-stdio.ts")],
        extensions: [".fixture"],
        env: { LSP_NATIVE_TRACE: trace },
        ...(recovery ? { restartOnCrash: true, maxRestarts: 1 } : {}),
      },
      "b-disabled": { disabled: true },
      "c-failed": { command: [join(runtime.output, "missing-server")], extensions: [".bad"] },
    },
    providers: {
      xai: {
        name: "LSP fixture",
        api: {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: runtime.env.XAI_BASE_URL,
          settings: { apiKey: "local-parity-key" },
        },
        models: {
          "grok-4.7": {
            name: "LSP fixture",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 100000, output: 10000 },
          },
        },
      },
    },
  })
  await writeFile(join(runtime.directory, "apexo.json"), config)
  const file = join(runtime.output, "native-server.mjs")
  await writeFile(
    file,
    `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};import {appendFileSync} from "node:fs";const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async(req)=>{const response=await app.handler(req);appendFileSync(${JSON.stringify(requests)},JSON.stringify({method:req.method,path:new URL(req.url).pathname,status:response.status})+"\\n");return response}});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  const child = spawn(process.execPath, [file], {
    cwd: runtime.directory,
    env: { ...runtime.env, APEXO_CONFIG_CONTENT: config, APEXO_SERVER_PASSWORD: "" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const exited = new Promise((resolve) => child.once("exit", resolve))
  const logs = []
  const old = runtime.url
  child.stdout.on("data", (chunk) => {
    logs.push(chunk)
    const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
    if (match) runtime.url = match[1]
  })
  child.stderr.on("data", (chunk) => logs.push(chunk))
  const close = async () => {
    child.kill("SIGTERM")
    await deadline(exited, 10000, "LSP server cleanup").catch(async () => {
      child.kill("SIGKILL")
      await exited
    })
    await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
    await runtime.close()
  }
  try {
    await poll(() => runtime.url !== old, "native LSP server ready", 30000)
    runtime.api = async (path, body, method = body ? "POST" : "GET") => {
      const response = await fetch(
        `${runtime.url}${path}?location[directory]=${encodeURIComponent(runtime.directory)}`,
        { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) },
      )
      const text = await response.text()
      assert.ok(response.ok, `${response.status}: ${text}`)
      return text ? JSON.parse(text) : undefined
    }
    assert.equal((await fetch(`${runtime.url}/global/health`)).status, 404)
    assert.deepEqual(
      (await runtime.api("/api/lsp")).map((x) => x.status),
      ["connected", "disabled", "failed"],
    )
    return {
      runtime,
      repo,
      trace,
      requests,
      config,
      close,
      records: async () => (await readFile(requests, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse),
      starts: async () =>
        (await readFile(trace, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(JSON.parse)
          .filter((x) => x.event === "start").length,
    }
  } catch (error) {
    await close()
    throw error
  }
}
