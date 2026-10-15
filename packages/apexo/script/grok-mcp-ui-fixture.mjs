import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

// Real native server and stdio transports; only the explicit status-outage marker injects HTTP 503.
export async function startMcpUiFixture() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const runtime = await startShellFixture("cli", { next: () => ({ content: "UNEXPECTED_MCP_UI_MODEL_WORK" }) })
  await runtime.crash()
  const mode = join(runtime.output, "mcp-mode")
  const trace = join(runtime.output, "mcp-trace.jsonl")
  const outage = join(runtime.output, "mcp-status-outage")
  const requests = join(runtime.output, "mcp-http.jsonl")
  await writeFile(mode, "ready")
  const auth = createServer((_, response) => { response.writeHead(401); response.end("Authentication required") })
  await new Promise((resolve) => auth.listen(0, "127.0.0.1", resolve))
  const local = {
    type: "local", command: [process.execPath, join(repo, "packages/apexo/test/fixture/mcp-native-stdio.ts")],
    environment: { MCP_NATIVE_TRACE: trace, MCP_NATIVE_MODE_FILE: mode },
    timeout: { startup: 3000, request: 3000 },
  }
  const config = JSON.stringify({
    model: "xai/grok-4.7", snapshots: false,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    mcp: { servers: {
      "a-local": local,
      "b-disabled": { ...local, disabled: true },
      "z-auth": { type: "remote", oauth: false, url: `http://127.0.0.1:${auth.address().port}/mcp`, timeout: { startup: 3000, request: 3000 } },
    } },
    providers: { xai: { name: "Native MCP UI fixture", api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: runtime.env.XAI_BASE_URL, settings: { apiKey: "local-parity-key" } }, models: { "grok-4.7": { name: "Native MCP UI fixture", capabilities: { tools: true, input: ["text"], output: ["text"] }, limit: { context: 100000, output: 10000 } } } } },
  })
  await writeFile(join(runtime.directory, "apexo.json"), config)
  const file = join(runtime.output, "native-server.mjs")
  await writeFile(file, `import {webHandler} from ${JSON.stringify(join(repo,"packages/server/src/routes.ts"))};import {appendFileSync,existsSync} from "node:fs";const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async(req)=>{const path=new URL(req.url).pathname;const response=path==="/api/mcp"&&existsSync(${JSON.stringify(outage)})?new Response("Fixture status transport outage",{status:503,headers:{"Access-Control-Allow-Origin":"*"}}):await app.handler(req);appendFileSync(${JSON.stringify(requests)},JSON.stringify({method:req.method,path,status:response.status,contentLength:req.headers.get("content-length")})+"\\n");return response}});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`)
  const child = spawn(process.execPath, [file], { cwd: runtime.directory, env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" }, stdio: ["ignore", "pipe", "pipe"] })
  const exited = new Promise((resolve) => child.once("exit", resolve))
  const logs = []
  const old = runtime.url
  child.stdout.on("data", (chunk) => { logs.push(chunk); const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/); if (match) runtime.url = match[1] })
  child.stderr.on("data", (chunk) => logs.push(chunk))
  const close = async () => {
    child.kill("SIGTERM")
    await deadline(exited, 10000, "MCP native server cleanup").catch(async () => { child.kill("SIGKILL"); await exited })
    auth.closeAllConnections()
    await new Promise((resolve) => auth.close(resolve))
    await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
    await runtime.close()
  }
  try {
    await poll(() => runtime.url !== old, "native MCP server ready", 30000)
    runtime.api = async (path, body, method = body ? "POST" : "GET") => {
      const response = await fetch(`${runtime.url}${path}?location[directory]=${encodeURIComponent(runtime.directory)}`, { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) })
      const text = await response.text()
      assert.ok(response.ok, `${response.status}: ${text}`)
      return text ? JSON.parse(text) : undefined
    }
    assert.equal((await fetch(`${runtime.url}/global/health`)).status, 404)
    assert.deepEqual(await runtime.api("/api/health"), { healthy: true })
    const initial = await runtime.api("/api/mcp")
    assert.equal(initial["a-local"].status, "connected")
    assert.equal(initial["a-local"].tools, 1)
    assert.equal(initial["b-disabled"].status, "disabled")
    assert.equal(initial["z-auth"].status, "needs_auth")
    return { runtime, repo, mode, trace, outage, requests, config, close,
      records: async () => (await readFile(requests, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse),
      starts: async () => (await readFile(trace, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse).filter((item) => item.event === "start").length,
    }
  } catch (error) { await close(); throw error }
}
