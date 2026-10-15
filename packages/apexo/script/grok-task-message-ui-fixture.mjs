import { spawn } from "node:child_process"
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

export async function startTaskMessageUiFixture(options = {}) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const calls = []
  let current
  const runtime = await startShellFixture("cli", {
    deferBackend: true,
    next: async ({ body, input, ancillary }) => {
      const tools = (body.tools ?? []).map((tool) => tool.function ?? tool)
      const content = (value) =>
        typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => part.text ?? "").join("\n") : ""
      if (
        ancillary ||
        tools.some((tool) => tool.name === "session_title") ||
        input.some((item) => item.role === "system" && content(item.content).includes("ultra-short dashboard line"))
      )
        return { content: "Task message UI" }
      const users = input
        .filter((item) => item.role === "user")
        .map((item) => content(item.content))
        .filter((text) => !text.startsWith("<system-update>") && !text.startsWith("<active-task-reminder>"))
      const child = users[0] === "MESSAGE_UI_CHILD"
      calls.push({ child, users, time: Date.now() })
      if (child) {
        current.childCalls++
        if (current.childCalls === 1) {
          current.arrived.resolve()
          await current.release.promise
          return { content: "INITIAL_UI_RESULT" }
        }
        assert.equal(users.at(-1), "CORRECTION_UI_中文")
        assert.equal(users.filter((text) => text === "CORRECTION_UI_中文").length, 1)
        return { content: "CORRECTED_UI_RESULT" }
      }
      assert.equal(users[0], "MESSAGE_UI_ROOT")
      if (!current.spawned) {
        current.spawned = true
        return {
          tool: "task",
          args: {
            description: `Message UI ${current.delivery}`,
            prompt: "MESSAGE_UI_CHILD",
            subagent_type: "helper",
            background: true,
          },
        }
      }
      return { content: "PARENT_UI_RESULT" }
    },
  })
  const config = JSON.parse(runtime.env.APEXO_CONFIG_CONTENT)
  await writeFile(
    join(runtime.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      task: { activeMessages: true },
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      agents: { helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
      providers: {
        xai: {
          api: {
            type: "aisdk",
            package: "@ai-sdk/xai",
            url: config.provider.xai.options.baseURL,
            settings: { apiKey: "fixture" },
          },
          models: {
            "grok-4.7": {
              name: "fixture",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  const nativeFile = join(runtime.output, "native-message-server.mjs")
  await writeFile(
    nativeFile,
    `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:app.handler});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  const logs = []
  const native = spawn(process.execPath, [nativeFile], {
    cwd: runtime.directory,
    env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const exited = new Promise((resolve) => native.once("exit", resolve))
  const ready = Promise.withResolvers()
  native.stdout.on("data", (chunk) => {
    logs.push(chunk)
    const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
    if (match) {
      runtime.url = match[1]
      ready.resolve()
    }
  })
  native.stderr.on("data", (chunk) => logs.push(chunk))
  native.once("exit", (code) => ready.reject(new Error(`Native backend exited ${code}: ${Buffer.concat(logs)}`)))
  await deadline(ready.promise, 30000, "native message backend")
  runtime.api = async (path, body, method = body ? "POST" : "GET") => {
    const url = new URL(path, runtime.url)
    url.searchParams.set("location[directory]", runtime.directory)
    const response = await fetch(url, {
      method,
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    })
    const text = await response.text()
    assert.ok(response.ok, `${method} ${path}: ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  return {
    runtime,
    repo,
    calls,
    async launch(delivery) {
      current = { delivery, childCalls: 0, arrived: Promise.withResolvers(), release: Promise.withResolvers() }
      const session = (
        await runtime.api("/api/session", {
          location: { directory: runtime.directory },
          model: { providerID: "xai", id: "grok-4.7" },
          agent: "build",
        })
      ).data
      await runtime.api(`/api/session/${session.id}/prompt`, { prompt: { text: "MESSAGE_UI_ROOT" } })
      await deadline(current.arrived.promise, 15000, "actual child provider arrival")
      const task = (await runtime.api(`/api/session/${session.id}/task`))[0]
      if (options.completed) {
        current.release.resolve()
        await poll(
          async () => (await runtime.api(`/api/session/${session.id}/task/${task.id}`)).status === "completed",
          "initial child completion",
        )
        await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST")
      }
      return {
        session,
        task,
        release: () => current.release.resolve(),
        childCalls: () => current.childCalls,
        async settle() {
          current.release.resolve()
          await poll(
            async () => (await runtime.api(`/api/session/${session.id}/task/${task.id}`)).status === "completed",
            "child completion",
            20000,
          )
          assert.equal(current.childCalls, 2)
        },
      }
    },
    async close() {
      current?.release.resolve()
      native.kill("SIGTERM")
      await deadline(exited, 10000, "native message backend cleanup").catch(async () => {
        native.kill("SIGKILL")
        await exited
      })
      await writeFile(join(runtime.output, "native-message-server.log"), Buffer.concat(logs))
      await runtime.close()
      await writeFile(join(runtime.output, "message-ui-provider.json"), JSON.stringify(calls, null, 2))
    },
  }
}
