import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

export async function startMcpAttachmentFixture() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const delivered = []
  const runtime = await startShellFixture("cli", {
    next: ({ input, ancillary }) => {
      delivered.push({ input, ancillary })
      return { content: "MCP_ATTACHMENT_ACCEPTED" }
    },
  })
  await runtime.crash()
  const trace = join(runtime.output, "mcp-trace.jsonl")
  const requests = join(runtime.output, "mcp-http.jsonl")
  const config = JSON.stringify({
    model: "xai/grok-4.7",
    snapshots: false,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    mcp: {
      servers: {
        local: {
          type: "local",
          command: [process.execPath, join(repo, "packages/apexo/test/fixture/mcp-attachment-stdio.ts")],
          environment: { MCP_RESOURCE_TRACE: trace, MCP_RESOURCE_MODE: "picker" },
        },
      },
    },
    providers: {
      xai: {
        name: "MCP picker fixture",
        api: {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: runtime.env.XAI_BASE_URL,
          settings: { apiKey: "local-parity-key" },
        },
        models: {
          "grok-4.7": {
            name: "MCP picker fixture",
            capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
            limit: { context: 100000, output: 10000 },
          },
        },
      },
    },
  })
  runtime.env.APEXO_CONFIG_CONTENT = config
  await writeFile(join(runtime.directory, "apexo.json"), config)
  const file = join(runtime.output, "native-server.mjs")
  await writeFile(
    file,
    `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};import {appendFileSync} from "node:fs";const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,idleTimeout:0,fetch:async(req)=>{const path=new URL(req.url).pathname;const response=await app.handler(req);appendFileSync(${JSON.stringify(requests)},JSON.stringify({method:req.method,path,status:response.status})+"\\n");return response}});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  const child = spawn(process.execPath, [file], {
    cwd: runtime.directory,
    env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" },
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
    await deadline(exited, 10000, "attachment server cleanup").catch(async () => {
      child.kill("SIGKILL")
      await exited
    })
    await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
    await runtime.close()
  }
  try {
    await poll(() => runtime.url !== old, "attachment server ready", 30000)
    runtime.api = async (path, body, method = body === undefined ? "GET" : "POST") => {
      const response = await fetch(
        `${runtime.url}${path}?location[directory]=${encodeURIComponent(runtime.directory)}`,
        {
          method,
          ...(body === undefined
            ? {}
            : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        },
      )
      const text = await response.text()
      assert.ok(response.ok, `${response.status}: ${text}`)
      return text ? JSON.parse(text) : undefined
    }
    assert.equal((await runtime.api("/api/mcp")).local?.status, "connected")
    return {
      runtime,
      repo,
      trace,
      requests,
      config,
      delivered,
      close,
      records: async () =>
        (await readFile(requests, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse),
      events: async () => (await readFile(trace, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse),
    }
  } catch (error) {
    await close()
    throw error
  }
}
