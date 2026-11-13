import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

export async function startMcpFormsFixture(options = {}) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const calls = []
  const tool = `mcp_forms_collect_${createHash("sha256")
    .update(JSON.stringify(["forms", "collect"]))
    .digest("hex")
    .slice(0, 10)}`
  const runtime = await startShellFixture("cli", {
    deferBackend: true,
    async next({ body, finished, ancillary }) {
      calls.push(body)
      if (ancillary || finished) return { content: "FORM_DONE" }
      return { tool, args: { mode: "form" } }
    },
  })
  const server = {
    type: "local",
    command: [process.execPath, join(repo, "packages/apexo/test/fixture/mcp-forms-stdio.ts")],
    defer_tools: false,
    timeout: 2000,
  }
  const config =
    options.desktop || options.mixed
      ? {
          model: "formfixture/model",
          snapshot: false,
          permission: { "*": "allow" },
          lsp: false,
          mcp: { forms: server },
          provider: {
            formfixture: {
              npm: "@ai-sdk/openai-compatible",
              options: { baseURL: runtime.env.XAI_BASE_URL, apiKey: "fixture" },
              models: {
                model: {
                  name: "Fixture",
                  tool_call: true,
                  limit: { context: 100000, output: 4096 },
                  provider: { npm: "@ai-sdk/openai-compatible", api: runtime.env.XAI_BASE_URL },
                },
              },
            },
          },
        }
      : {
          model: "formfixture/model",
          snapshots: false,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          compaction: { auto: false },
          mcp: { servers: { forms: { ...server, timeout: { request: 2000 } } } },
          providers: {
            formfixture: {
              api: {
                type: "aisdk",
                package: "@ai-sdk/openai-compatible",
                url: runtime.env.XAI_BASE_URL,
                settings: { apiKey: "fixture" },
              },
              models: {
                model: {
                  name: "Fixture",
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
              },
            },
          },
        }
  await writeFile(join(runtime.directory, "apexo.json"), JSON.stringify(config))
  runtime.env.APEXO_CONFIG_CONTENT = JSON.stringify(config)
  const serverFile = join(runtime.output, "native-server.mjs")
  await writeFile(
    serverFile,
    options.mixed
      ? `import {Server} from ${JSON.stringify(join(repo, "packages/apexo/src/server/server.ts"))};const server=await Server.listen({hostname:"127.0.0.1",port:0});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);process.exit(0)});`
      : `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,idleTimeout:0,fetch:app.handler});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  const logs = []
  const state = { child: undefined, exited: undefined }
  if (!options.desktop) {
    state.child = spawn(process.execPath, [serverFile], {
      cwd: runtime.directory,
      env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    state.exited = new Promise((resolve) => state.child.once("exit", resolve))
    const old = runtime.url
    state.child.stdout.on("data", (chunk) => {
      logs.push(chunk)
      const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
      if (match) runtime.url = match[1]
    })
    state.child.stderr.on("data", (chunk) => logs.push(chunk))
    await poll(() => runtime.url !== old, "native form backend", 30000)
  }
  runtime.api = async (path, body, method = body ? "POST" : "GET", expected = 200) => {
    const url = new URL(path, runtime.url)
    url.searchParams.set("location[directory]", runtime.directory)
    if (!path.startsWith("/api/")) url.searchParams.set("directory", runtime.directory)
    const response = await fetch(url, {
      method,
      signal: AbortSignal.timeout(15000),
      headers: { ...runtime.headers, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    assert.ok(expected === 200 ? response.ok : response.status === expected, `${path}: ${response.status}: ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  const create = async () =>
    (
      await runtime.api("/api/session", {
        location: { directory: runtime.directory },
        model: { providerID: "formfixture", id: "model" },
        agent: "build",
      })
    ).data
  const session = options.desktop ? undefined : await create()
  return {
    runtime,
    repo,
    session,
    calls,
    create,
    prompt: (sessionID, executionPolicy) =>
      runtime.api(`/api/session/${sessionID}/prompt`, {
        prompt: { text: "Collect deployment choices" },
        ...(executionPolicy ? { executionPolicy } : {}),
      }),
    pending: (sessionID) =>
      poll(async () => (await runtime.api(`/api/session/${sessionID}/mcp/elicitation`))[0], "live MCP form", 30000),
    async close() {
      state.child?.kill("SIGTERM")
      if (state.exited)
        await deadline(state.exited, 15000, "form backend cleanup").catch(() => state.child.kill("SIGKILL"))
      await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
      await runtime.close()
    },
  }
}
