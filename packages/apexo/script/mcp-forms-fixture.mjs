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
    git: options.git,
    async next({ body, text, finished, ancillary }) {
      calls.push(body)
      if (ancillary || finished) return { content: "FORM_DONE" }
      if (text.includes("F04_NESTED") || text.includes("F04_CHILD"))
        return {
          tool: "task",
          args: {
            description: "Form child",
            prompt: text.includes("F04_CHILD") ? "F04_LEAF" : "F04_CHILD",
            subagent_type: "worker",
          },
        }
      if (text.includes("F04_WORKTREE"))
        return {
          tool: "task",
          args: { description: "Isolated form", prompt: "F04_LEAF", subagent_type: "worker", isolation: "worktree" },
        }
      if (text.includes("F04_DIRECT"))
        return { tool: "task", args: { description: "Form child", prompt: "F04_LEAF", subagent_type: "worker" } }
      return { tool, args: { mode: text.includes("F04_SPECIAL") ? "special" : "form" } }
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
          task: { maxDepth: 2 },
          agent: { worker: { mode: "subagent", permission: { "*": "allow" } } },
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
          task: { maxDepth: 2 },
          agents: { worker: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
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
      ? `import {Server} from ${JSON.stringify(join(repo, "packages/apexo/src/server/server.ts"))};const server=await Server.listen({hostname:"127.0.0.1",port:Number(process.env.APEXO_TEST_FORM_PORT??0)});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);process.exit(0)});`
      : `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:Number(process.env.APEXO_TEST_FORM_PORT??0),idleTimeout:0,fetch:app.handler});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  const logs = []
  const state = { child: undefined, exited: undefined }
  const launch = async () => {
    const ready = Promise.withResolvers()
    state.child = spawn(process.execPath, [serverFile], {
      cwd: runtime.directory,
      env: {
        ...runtime.env,
        APEXO_SERVER_PASSWORD: "",
        APEXO_TEST_FORM_PORT: runtime.url ? new URL(runtime.url).port : "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    state.exited = new Promise((resolve) => state.child.once("exit", resolve))
    state.child.stdout.on("data", (chunk) => {
      logs.push(chunk)
      const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
      if (match) {
        runtime.url = match[1]
        ready.resolve()
      }
    })
    state.child.stderr.on("data", (chunk) => logs.push(chunk))
    await deadline(ready.promise, 30000, "native form backend")
  }
  // The deferred base fixture has reserved its port; keep it stable for client restart checks.
  if (!options.desktop) await launch()
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
    prompt: (sessionID, executionPolicy, text = "Collect deployment choices") =>
      runtime.api(`/api/session/${sessionID}/prompt`, {
        prompt: { text },
        ...(executionPolicy ? { executionPolicy } : {}),
      }),
    pending: (sessionID) =>
      poll(
        async () => (await runtime.api(`/api/session/${sessionID}/mcp/elicitation?includeDescendants=true`))[0],
        "live MCP form",
        30000,
      ),
    async restartBackend() {
      assert.ok(!options.desktop, "Only the isolated fixture backend can restart here")
      state.child.kill("SIGTERM")
      await deadline(state.exited, 15000, "fixture backend shutdown")
      await launch()
    },
    async close() {
      state.child?.kill("SIGTERM")
      if (state.exited)
        await deadline(state.exited, 15000, "form backend cleanup").catch(() => state.child.kill("SIGKILL"))
      await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
      await runtime.close()
    },
  }
}
