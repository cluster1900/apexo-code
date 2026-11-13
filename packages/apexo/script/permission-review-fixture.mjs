import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { deadline, poll, startShellFixture } from "./grok-shell-fixture.mjs"

export async function startPermissionReviewFixture(options = {}) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const state = { hold: false, child: undefined, exited: undefined, calls: [] }
  const runtime = await startShellFixture("cli", {
    deferBackend: true,
    async next({ body, input, ancillary, finished, text }) {
      if (ancillary && JSON.stringify(input).includes("verifiedUserInstructions")) {
        const evidence = JSON.parse(input.findLast((message) => message.role === "user").content)
        state.calls.push(evidence)
        while (state.hold) await Bun.sleep(10)
        return {
          content: JSON.stringify({
            decision: "ask",
            reason: "Fixture requires a human decision",
            messageIDs: evidence.verifiedUserInstructions.map((item) => item.messageID),
          }),
        }
      }
      if (ancillary || finished) return { content: "PERMISSION_DONE" }
      return { tool: "bash", args: { command: "bun --version" } }
    },
  })
  const config =
    options.desktop || options.mixed
      ? {
          model: "reviewfixture/model",
          snapshot: false,
          compaction: { auto: false },
          permission: { "*": "allow", bash: "ask" },
          lsp: false,
          provider: {
            reviewfixture: {
              npm: "@ai-sdk/openai-compatible",
              options: { baseURL: runtime.env.XAI_BASE_URL, apiKey: "fixture" },
              models: {
                model: {
                  name: "Review fixture",
                  tool_call: true,
                  limit: { context: 100000, output: 4096 },
                  provider: { npm: "@ai-sdk/openai-compatible", api: runtime.env.XAI_BASE_URL },
                },
              },
            },
          },
        }
      : {
          model: "reviewfixture/model",
          snapshots: false,
          compaction: { auto: false },
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "bash", resource: "*", effect: "ask" },
          ],
          providers: {
            reviewfixture: {
              api: {
                type: "aisdk",
                package: "@ai-sdk/openai-compatible",
                url: runtime.env.XAI_BASE_URL,
                settings: { apiKey: "fixture" },
              },
              models: {
                model: {
                  name: "Review fixture",
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
              },
            },
          },
        }
  await writeFile(join(runtime.directory, "apexo.json"), JSON.stringify(config))
  runtime.env.APEXO_CONFIG_CONTENT = JSON.stringify(config)
  const logs = []
  if (!options.desktop) {
    const file = join(runtime.output, "permission-server.mjs")
    await writeFile(
      file,
      options.mixed
        ? `import {Server} from ${JSON.stringify(join(repo, "packages/apexo/src/server/server.ts"))};const server=await Server.listen({hostname:"127.0.0.1",port:Number(process.env.REVIEW_FIXTURE_PORT)});console.log("REVIEW_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);process.exit(0)});`
        : `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:Number(process.env.REVIEW_FIXTURE_PORT),idleTimeout:0,fetch:app.handler});console.log("REVIEW_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
    )
    const ready = Promise.withResolvers()
    state.child = spawn(process.execPath, [file], {
      cwd: runtime.directory,
      env: {
        ...runtime.env,
        SHELL: "/bin/sh",
        APEXO_SERVER_PASSWORD: "",
        REVIEW_FIXTURE_PORT: new URL(runtime.url).port,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    state.exited = new Promise((resolve) => state.child.once("exit", resolve))
    state.child.stdout.on("data", (chunk) => {
      logs.push(chunk)
      const found = chunk.toString().match(/REVIEW_URL=(http:\/\/[^\s]+)/)
      if (found) {
        runtime.url = found[1]
        ready.resolve()
      }
    })
    state.child.stderr.on("data", (chunk) => logs.push(chunk))
    await deadline(ready.promise, 30000, "permission backend")
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
    assert.equal(response.status, expected, `${path}: ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  const create = async () => {
    const session = (
      await runtime.api("/api/session", {
        location: { directory: runtime.directory },
        agent: "build",
        model: { providerID: "reviewfixture", id: "model" },
      })
    ).data
    // Shared blank Sessions have no engine marker. Establish native admission without model execution.
    if (options.mixed || options.desktop)
      await runtime.api(`/api/session/${session.id}/prompt`, {
        prompt: { text: "Native fixture session" },
        resume: false,
      })
    return session
  }
  return {
    runtime,
    repo,
    state,
    create,
    session: options.desktop ? undefined : await create(),
    mode: (id, mode) =>
      runtime.api(`/api/session/${id}/permission-review`, mode ? { mode } : undefined, mode ? "PUT" : "GET"),
    prompt: (id) => runtime.api(`/api/session/${id}/prompt`, { prompt: { text: "Run bun --version" } }),
    pending: (id, status) =>
      poll(
        async () =>
          (await runtime.api(`/api/session/${id}/permission`)).data.find(
            (item) => !status || item.review?.status === status,
          ),
        "permission state",
        30000,
      ),
    async close() {
      state.hold = false
      state.child?.kill("SIGTERM")
      if (state.exited)
        await deadline(state.exited, 15000, "permission backend cleanup").catch(() => state.child.kill("SIGKILL"))
      await writeFile(join(runtime.output, "permission-server.log"), Buffer.concat(logs))
      await runtime.close()
    },
  }
}
