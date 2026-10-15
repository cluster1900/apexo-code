import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

export async function startSchedulerUiFixture(options = {}) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const calls = []
  const held = Promise.withResolvers()
  const runtime = await startShellFixture("cli", {
    async next({ body, text, finished, ancillary }) {
      if (ancillary) return { content: "Scheduler UI acceptance" }
      const parent = (body.tools ?? []).some((tool) => (tool.function?.name ?? tool.name) === "task")
      calls.push({ parent, text, finished })
      if (!parent && text.includes("SCHED_UI_CHILD_HELD")) {
        await held.promise
        return { content: "SCHED_UI_CHILD_RESULT" }
      }
      if (parent && !finished && /SCHED_UI_CREATE_(RESTART|HELD)/u.test(text))
        return {
          tool: "scheduler_create",
          args: {
            interval: "1h",
            prompt: "SCHED_UI_CHILD_HELD",
            durable: true,
            fire_immediately: text.includes("SCHED_UI_CREATE_HELD"),
          },
        }
      if (parent && !finished && text.includes("SCHED_UI_LOOP_PROMPT"))
        return {
          tool: "scheduler_create",
          args: { interval: "1h", prompt: "SCHED_UI_LOOP_CHILD", durable: false, fire_immediately: false },
        }
      return { content: "SCHED_UI_PARENT_DONE" }
    },
  })
  await runtime.crash()
  await writeFile(
    join(runtime.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        ...(options.permission ? [{ action: "task", resource: "*", effect: "ask" }] : []),
      ],
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
              name: "Scheduler UI",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  const log = join(runtime.output, "scheduler-http.jsonl")
  const fault = join(runtime.output, "scheduler-fault.json")
  const file = join(runtime.output, "native-scheduler-server.mjs")
  await writeFile(
    file,
    `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};import {appendFileSync,existsSync,readFileSync} from "node:fs";const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,idleTimeout:0,fetch:async(request)=>{const url=new URL(request.url);const fault=existsSync(${JSON.stringify(fault)})?JSON.parse(readFileSync(${JSON.stringify(fault)},"utf8")):undefined;const fail=fault&&(fault.action==="list"?request.method==="GET"&&url.pathname.endsWith("/schedule"):request.method==="POST"&&url.pathname.endsWith("/resume"));const response=fail?Response.json({message:"PRIVATE_SCHEDULE_CAUSE"},{status:fault.status,headers:{"Access-Control-Allow-Origin":"*"}}):await app.handler(request);appendFileSync(${JSON.stringify(log)},JSON.stringify({path:url.pathname,method:request.method,status:response.status,errorBody:response.status>=400&&url.pathname.endsWith("/resume")?await response.clone().text():undefined,contentLength:request.headers.get("content-length")})+"\\n");return response}});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  const state = {},
    logs = []
  const start = async () => {
    const old = runtime.url
    state.child = spawn(process.execPath, [file], {
      cwd: runtime.directory,
      env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    state.exited = new Promise((resolve) => state.child.once("exit", resolve))
    state.child.stdout.on("data", (chunk) => {
      logs.push(chunk)
      const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/u)
      if (match) runtime.url = match[1]
    })
    state.child.stderr.on("data", (chunk) => logs.push(chunk))
    await poll(() => runtime.url !== old, "Scheduler native server ready", 30000)
  }
  const stop = async () => {
    if (state.child?.exitCode === null) state.child.kill("SIGTERM")
    if (state.exited)
      await deadline(state.exited, 10000, "Scheduler server cleanup").catch(async () => {
        state.child.kill("SIGKILL")
        await state.exited
      })
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
  const close = async () => {
    held.resolve()
    await stop()
    await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
    await runtime.close()
  }
  try {
    await start()
    assert.equal((await fetch(`${runtime.url}/global/health`)).status, 404)
    const session = (
      await runtime.api("/api/session", {
        location: { directory: runtime.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    const list = () => runtime.api(`/api/session/${session.id}/schedule`)
    const tasks = () => runtime.api(`/api/session/${session.id}/task`)
    const permissions = async () => (await runtime.api(`/api/session/${session.id}/permission`)).data
    const approveSetup = async () => {
      if (!options.permission) return
      for (const item of await permissions())
        await runtime.api(`/api/session/${session.id}/permission/${item.id}/reply`, { reply: "once" })
    }
    const prompt = async (text) => {
      await runtime.api(`/api/session/${session.id}/prompt`, { prompt: { text } })
      const state = { done: false }
      const settled = runtime
        .api(`/api/session/${session.id}/wait`, undefined, "POST")
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
        .then((result) => {
          state.done = true
          return result
        })
      await poll(async () => {
        await approveSetup()
        return state.done
      }, "Scheduler setup permission and parent settlement")
      const result = await settled
      if (result.error) throw result.error
    }
    await prompt("SCHED_UI_CREATE_RESTART")
    const restart = (await list())[0]
    assert.ok(restart?.id)
    await stop()
    await start()
    assert.equal((await list()).find((item) => item.id === restart.id).blockedReason, "restart_required")
    await prompt("SCHED_UI_CREATE_HELD")
    const active = (await list()).find((item) => item.id !== restart.id)
    assert.ok(active?.id)
    const child = await poll(async () => {
      await approveSetup()
      return (await tasks()).find((item) => item.status === "running")
    }, "Scheduler occurrence Task running")
    await poll(
      () => calls.some((call) => !call.parent && call.text.includes("SCHED_UI_CHILD_HELD")),
      "Scheduler child provider entered",
    )
    return {
      repo,
      runtime,
      calls,
      session,
      restart,
      active,
      child,
      list,
      tasks,
      permissions,
      prompt,
      fault,
      records: async () =>
        (await readFile(log, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      release: () => held.resolve(),
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
