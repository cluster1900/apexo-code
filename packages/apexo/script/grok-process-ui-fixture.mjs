import assert from "node:assert/strict"
import { appendFileSync } from "node:fs"
import { createServer, request } from "node:http"
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

export async function startProcessUiFixture(options = {}) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const calls = [],
    scenarios = new Map()
  const scenario = (mode) => {
    if (!scenarios.has(mode)) scenarios.set(mode, { turns: 0, notices: 0, events: 0 })
    return scenarios.get(mode)
  }
  const runtime = await startShellFixture(options.runtime ?? "cli", {
    config: { agent: { helper: { mode: "subagent", permission: { "*": "allow" } } } },
    async next({ input, body, text, ancillary }) {
      if (ancillary) return { content: "Process UI acceptance" }
      const mode = input
        .filter((item) => item.role === "user")
        .reverse()
        .map(
          (item) =>
            JSON.stringify(item).match(
              /SHELL_UI_(TASK|CHILD|DONE|RESTART|HOLD|FAIL|LONG|MONITOR_RESTART|MONITOR|OVERLOAD)(?![A-Z_])/,
            )?.[1],
        )
        .find(Boolean)
      assert.ok(mode, "Original process UI scenario marker")
      calls.push({ mode })
      if (mode === "CHILD") return { content: "TASK_OUTPUT_START\nReal subagent result\nTASK_OUTPUT_END" }
      const state = scenario(mode)
      state.turns++
      if (JSON.stringify(input.findLast((item) => item.role === "user")).includes("Live Monitor data follows"))
        state.events++
      if (state.turns === 1) {
        if (mode === "TASK")
          return {
            tool: "task",
            args: { description: "Actual subagent task", prompt: "SHELL_UI_CHILD", subagent_type: "helper" },
          }
        if (mode.startsWith("MONITOR") || mode === "OVERLOAD")
          return {
            tool: "monitor",
            args: {
              command:
                mode === "OVERLOAD"
                  ? `echo $$ > ${mode}.pid; while true; do printf 'NOISY\n'; sleep 0.02; done`
                  : `echo $$ > ${mode}.pid; printf 'MONITOR_READY😀\n'; printf 'MONITOR_ERROR中文\n' >&2; while [ ! -f ${mode}.release ]; do sleep 0.02; done; printf 'MONITOR_TAIL\n'`,
              description: `Monitor UI ${mode}`,
              persistent: mode !== "OVERLOAD",
              timeout_ms: mode === "OVERLOAD" ? 60000 : 0,
            },
          }
        const command =
          mode === "LONG"
            ? `${JSON.stringify(process.execPath)} -e 'process.stdout.write(("Retained output 中文 line.\\n").repeat(60000))'`
            : `printf 'LIVE_${mode}😀'; while [ ! -f ${mode}.release ]; do sleep 0.02; done; printf 'FINAL_${mode}中文'; ${mode === "FAIL" ? "exit 7" : "exit 0"}`
        return { tool: "bash", args: { command, description: `Shell UI ${mode}`, background: true, timeout: 180000 } }
      }
      if (JSON.stringify(input).includes("Background shell completion data follows")) state.notices++
      return { content: `SHELL_UI_SETTLED_${mode}` }
    },
  })
  if (!options.mixed) await runtime.crash()
  await writeFile(
    join(runtime.directory, "apexo.json"),
    options.mixed
      ? runtime.env.APEXO_CONFIG_CONTENT
      : JSON.stringify({
          snapshots: false,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          agents: { helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
          providers: {
            xai: {
              api: {
                type: "aisdk",
                package: "@ai-sdk/openai-compatible",
                url: runtime.env.XAI_BASE_URL,
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
  const log = join(runtime.output, "process-http.jsonl"),
    fault = join(runtime.output, "process-fault.json"),
    serverFile = join(runtime.output, "native-process-server.mjs")
  await writeFile(
    serverFile,
    `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};import {appendFileSync,existsSync,readFileSync} from "node:fs";const app=webHandler();const server=Bun.serve({idleTimeout:0,hostname:"127.0.0.1",port:0,fetch:async(req)=>{const url=new URL(req.url);const fault=existsSync(${JSON.stringify(fault)})?JSON.parse(readFileSync(${JSON.stringify(fault)},"utf8")):undefined;const matches=fault&&(fault.action==="task-list"?req.method==="GET"&&url.pathname.endsWith("/task"):fault.action==="cancel"?req.method==="POST"&&url.pathname.endsWith("/cancel"):req.method==="GET"&&url.pathname.endsWith("/process"));const response=matches?Response.json({message:"private fixture process cause"},{status:fault.status,headers:{"Access-Control-Allow-Origin":"*"}}):await app.handler(req);appendFileSync(${JSON.stringify(log)},JSON.stringify({method:req.method,path:url.pathname,status:response.status,contentLength:req.headers.get("content-length")})+"\\n");return response}});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  const state = {},
    logs = []
  const backendURL = runtime.url
  let proxy
  const streams = new Set()
  const start = async () => {
    if (options.mixed) {
      if (proxy) {
        await runtime.reopen()
        return
      }
      proxy = createServer((incoming, outgoing) => {
        const url = new URL(incoming.url, backendURL)
        const chunks = []
        incoming.on("data", (chunk) => chunks.push(chunk))
        const upstream = request(
          url,
          { method: incoming.method, headers: { ...incoming.headers, host: url.host } },
          (response) => {
            streams.add(response)
            appendFileSync(
              log,
              JSON.stringify({
                method: incoming.method,
                path: url.pathname,
                status: response.statusCode,
                contentLength: incoming.headers["content-length"],
              }) + "\n",
            )
            outgoing.writeHead(response.statusCode, response.headers)
            response.pipe(outgoing)
            outgoing.once("close", () => {
              streams.delete(response)
              response.destroy()
              upstream.destroy()
            })
          },
        )
        upstream.on("error", () => outgoing.destroy())
        incoming.pipe(upstream)
      })
      await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve))
      runtime.url = `http://127.0.0.1:${proxy.address().port}`
      return
    }
    const old = runtime.url
    state.child = spawn(process.execPath, [serverFile], {
      cwd: runtime.directory,
      env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    state.exited = new Promise((resolve) => state.child.once("exit", resolve))
    state.child.stdout.on("data", (chunk) => {
      logs.push(chunk)
      const url = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
      if (url) runtime.url = url[1]
    })
    state.child.stderr.on("data", (chunk) => logs.push(chunk))
    await poll(() => runtime.url !== old, "native process server ready", 30000)
  }
  runtime.api = async (path, body, method = body ? "POST" : "GET") => {
    const url = new URL(path, runtime.url)
    url.searchParams.set("location[directory]", runtime.directory)
    const response = await fetch(url, {
      method,
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    assert.ok(response.ok, `${response.status}: ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  const release = (mode) => writeFile(join(runtime.directory, `${mode}.release`), "release")
  const close = async () => {
    for (const mode of scenarios.keys()) await release(mode)
    state.child?.kill("SIGTERM")
    if (state.exited)
      await deadline(state.exited, 10000, "Process server cleanup").catch(async () => {
        state.child.kill("SIGKILL")
        await state.exited
      })
    await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
    if (proxy) {
      for (const stream of streams) stream.destroy()
      proxy.closeAllConnections()
      await deadline(new Promise((resolve) => proxy.close(resolve)), 10000, "Process proxy cleanup")
    }
    await runtime.close()
  }
  try {
    await start()
    assert.equal((await fetch(`${runtime.url}/global/health`)).status, options.mixed ? 200 : 404)
    const session = (
      await runtime.api("/api/session", {
        location: { directory: runtime.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    const list = () => runtime.api(`/api/session/${session.id}/process`)
    const tasks = () => runtime.api(`/api/session/${session.id}/task`)
    const launch = async (mode) => {
      await runtime.api(`/api/session/${session.id}/prompt`, { prompt: { text: `SHELL_UI_${mode}` } })
      await poll(() => scenario(mode).turns >= 2, `parent ${mode} continuation`)
      await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST")
      if (mode === "TASK") return (await tasks())[0]
      return poll(
        async () =>
          (await list()).find(
            (item) =>
              item.description ===
              `${mode.startsWith("MONITOR") || mode === "OVERLOAD" ? "Monitor" : "Shell"} UI ${mode}`,
          ),
        `process ${mode} receipt`,
      )
    }
    const task = await launch("TASK")
    assert.equal(task.status, "completed")
    const receipts = {}
    for (const mode of ["DONE", "FAIL", "LONG"]) {
      receipts[mode] = await launch(mode)
      await release(mode)
      await runtime.api(`/api/session/${session.id}/process/${receipts[mode].id}/wait`, { timeoutMs: 15000 })
      await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST")
    }
    receipts.RESTART = await launch("RESTART")
    if (options.monitors) receipts.MONITOR_RESTART = await launch("MONITOR_RESTART")
    if (options.mixed) await runtime.crash()
    else {
      state.child.kill("SIGKILL")
      await state.exited
    }
    await release("RESTART")
    if (options.monitors) await release("MONITOR_RESTART")
    await start()
    receipts.HOLD = await launch("HOLD")
    if (options.monitors) {
      receipts.MONITOR = await launch("MONITOR")
      await poll(() => scenario("MONITOR").events > 0, "real Monitor event consumed", 15000)
      await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST")
      assert.equal((await list()).find((item) => item.id === receipts.MONITOR_RESTART.id).status, "interrupted")
    }
    if (options.overload) {
      receipts.OVERLOAD = await launch("OVERLOAD")
      await poll(
        async () => (await list()).find((item) => item.id === receipts.OVERLOAD.id)?.monitor?.overloaded,
        "real Monitor overload",
        50000,
      )
      await runtime.api(`/api/session/${session.id}/process/${receipts.OVERLOAD.id}/wait`, { timeoutMs: 15000 })
      await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST")
    }
    assert.equal((await list()).find((item) => item.id === receipts.RESTART.id).status, "interrupted")
    return {
      repo,
      runtime,
      session,
      calls,
      task,
      receipts,
      list,
      tasks,
      fault,
      release,
      close,
      records: async () => (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse),
    }
  } catch (error) {
    await close()
    throw error
  }
}

export async function startCompatibilityTaskUiFixture() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const runtime = await startShellFixture("cli")
  const session = await runtime.api("/session", { title: "Compatibility task manager regression" })
  const close = async () => {
    const tasks = await runtime.api(`/experimental/session/${session.id}/task`).catch(() => [])
    for (const task of tasks)
      await runtime.api(`/experimental/session/${session.id}/task/${task.id}/cancel`, undefined, "POST").catch(() => {})
    await runtime.close()
  }
  try {
    for (const type of ["shell", "task"])
      await runtime.api(`/session/${session.id}/message`, {
        model: { providerID: "xai", modelID: "grok-4.7" },
        parts: [{ type: "text", text: `TASK_PANEL_${type}` }],
      })
    const tasks = await poll(async () => {
      const items = await runtime.api(`/experimental/session/${session.id}/task`)
      return items.length === 2 && items.every((item) => item.status === "running") && items
    }, "two real compatibility task kinds")
    return { repo, runtime, session, calls: runtime.calls, tasks, close }
  } catch (error) {
    await close()
    throw error
  }
}
