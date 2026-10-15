import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"
import { oauthServer } from "../test/fixture/mcp-oauth-server.ts"

// Native-only source server, real loopback issuer and MCP transport. Consent is
// held at the local issuer so clients can exercise waiting/cancel/copy controls.
export async function startOAuthUiFixture() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const issuer = oauthServer({ challenge: true, manualConsent: true })
  const runtime = await startShellFixture("cli", { next: () => ({ content: "UNEXPECTED_OAUTH_UI_MODEL_WORK" }) })
  await runtime.crash()
  const requests = join(runtime.output, "oauth-http.jsonl")
  const serverDefinition = {
    type: "remote",
    url: `${issuer.server.url.origin}/mcp`,
    disabled: true,
    oauth: { client_id: "fixture-client" },
  }
  const config = JSON.stringify({
    model: "xai/grok-4.7",
    snapshots: false,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    mcp: {
      servers: {
        reference: serverDefinition,
        ...Object.fromEntries(
          Array.from({ length: 16 }, (_, i) => [
            `z-long-disabled-server-${String(i).padStart(2, "0")}`,
            serverDefinition,
          ]),
        ),
      },
    },
    providers: {
      xai: {
        name: "OAuth UI fixture",
        api: {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: runtime.env.XAI_BASE_URL,
          settings: { apiKey: "local-parity-key" },
        },
        models: {
          "grok-4.7": {
            name: "OAuth UI fixture",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 100000, output: 10000 },
          },
        },
      },
    },
  })
  await writeFile(join(runtime.directory, "apexo.json"), config)
  const file = join(runtime.output, "oauth-native-server.mjs")
  await writeFile(
    file,
    `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};import {appendFileSync} from "node:fs";const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async(req)=>{const response=await app.handler(req);appendFileSync(${JSON.stringify(requests)},JSON.stringify({method:req.method,path:new URL(req.url).pathname,status:response.status})+"\\n");return response}});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  const child = spawn(process.execPath, [file], {
    cwd: runtime.directory,
    env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const exited = new Promise((resolve) => child.once("exit", resolve)),
    logs = []
  const old = runtime.url
  child.stdout.on("data", (chunk) => {
    logs.push(chunk)
    const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
    if (match) runtime.url = match[1]
  })
  child.stderr.on("data", (chunk) => logs.push(chunk))
  const close = async () => {
    child.kill("SIGTERM")
    await deadline(exited, 10000, "OAuth fixture shutdown").catch(async () => {
      child.kill("SIGKILL")
      await exited
    })
    await issuer.server.stop(true)
    await runtime.close()
    await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
  }
  try {
    await poll(() => runtime.url !== old, "native OAuth server", 30000)
    runtime.api = async (path, body, method = body ? "POST" : "GET") => {
      const response = await fetch(
        `${runtime.url}${path}?location[directory]=${encodeURIComponent(runtime.directory)}`,
        { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) },
      )
      assert.ok(response.ok, `${method} ${path}: ${response.status}`)
      return response.json()
    }
    assert.equal((await fetch(`${runtime.url}/global/health`)).status, 404)
    assert.equal((await runtime.api("/api/mcp")).reference.status, "disabled")
    return {
      repo,
      runtime,
      issuer,
      config,
      close,
      records: async () => (await readFile(requests, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse),
      consent: async () => {
        const url = issuer.authorization()
        assert.ok(url, "explicit client opened authorization")
        assert.equal((await fetch(url, { method: "POST" })).status, 200)
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
