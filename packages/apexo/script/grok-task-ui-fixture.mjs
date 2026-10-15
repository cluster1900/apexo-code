import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

// Real native Sessions and Task execution. No synthetic rows or provider work from UI polling.
export async function startTaskUiFixture(options = {}) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const calls = []
  const hold = Promise.withResolvers()
  const restart = Promise.withResolvers()
  const background = options.background === true
  const scenarios = new Map()
  const scenario = (mode) => {
    if (!scenarios.has(mode))
      scenarios.set(mode, {
        child: mode === "HOLD" ? hold : mode === "RESTART" ? restart : Promise.withResolvers(),
        started: Promise.withResolvers(),
        parent: Promise.withResolvers(),
        parentCalls: 0,
        notices: 0,
      })
    return scenarios.get(mode)
  }
  const output =
    "TASK_OUTPUT_START\n" +
    Array.from({ length: 80 }, (_, i) => `Output line ${i + 1}: preserved 中文 evidence.`).join("\n") +
    "\nTASK_OUTPUT_END"
  const runtime = await startShellFixture("cli", {
    async next({ body, input, text, finished }) {
      if (background) {
        const parent = (body.tools ?? []).some((tool) => (tool.function?.name ?? tool.name) === "task")
        const mode = parent
          ? input
              .filter((item) => item.role === "user")
              .reverse()
              .map(
                (item) => JSON.stringify(item).match(/UI_PARENT_(DONE|RESTART|HOLD|IDLE|ACTIVE|WAIT)(?![A-Z_])/)?.[1],
              )
              .find(Boolean)
          : text.match(/UI_CHILD_(DONE|RESTART|HOLD|IDLE|ACTIVE|WAIT)/)?.[1]
        assert.ok(mode, "Exact background UI scenario is present")
        const state = scenario(mode)
        calls.push({ text, finished, mode, parent })
        if (!parent) {
          state.started.resolve()
          if (mode !== "DONE") await state.child.promise
          return { content: mode === "DONE" ? output : `UI_RESULT_${mode}` }
        }
        state.parentCalls++
        if (state.parentCalls === 1)
          return {
            tool: "task",
            args: {
              description:
                mode === "HOLD"
                  ? "Running UI task"
                  : mode === "RESTART"
                    ? "Interrupted UI task"
                    : mode === "DONE"
                      ? "Completed UI task"
                      : `Background UI ${mode}`,
              prompt: `UI_CHILD_${mode}`,
              subagent_type: "helper",
              background: true,
            },
          }
        if (state.parentCalls === 2 && mode === "WAIT") {
          await state.started.promise
          const childID = [...JSON.stringify(input).matchAll(/ses_[a-f0-9]{64}/g)].at(-1)?.[0]
          assert.ok(childID)
          return {
            tool: "task_wait",
            args: { task_id: childID, timeout_ms: 120000 },
          }
        }
        if (state.parentCalls === 2 && mode === "ACTIVE") await state.parent.promise
        if (state.parentCalls > 2 && mode !== "WAIT") {
          assert.match(JSON.stringify(input), /Background Task completion data follows/)
          assert.ok(JSON.stringify(input).includes(mode === "DONE" ? "TASK_OUTPUT_START" : `UI_RESULT_${mode}`))
          state.notices++
          return { content: `UI_NOTICE_${mode}` }
        }
        return { content: `UI_PARENT_DONE_${mode}` }
      }
      calls.push({ text, finished })
      if (text.includes("CHILD_HOLD")) {
        await hold.promise
        return { content: "LATE_CANCELLED" }
      }
      if (text.includes("CHILD_RESTART")) {
        await restart.promise
        return { content: "LATE_INTERRUPTED" }
      }
      if (text.includes("CHILD_DONE"))
        return {
          content:
            "TASK_OUTPUT_START\n" +
            Array.from({ length: 80 }, (_, i) => `Output line ${i + 1}: preserved 中文 evidence.`).join("\n") +
            "\nTASK_OUTPUT_END",
        }
      if (!finished)
        return {
          tool: "task",
          args: {
            description: text.includes("TASK_HOLD")
              ? "Running UI task"
              : text.includes("TASK_RESTART")
                ? "Interrupted UI task"
                : "Completed UI task",
            prompt: text.includes("TASK_HOLD")
              ? "CHILD_HOLD"
              : text.includes("TASK_RESTART")
                ? "CHILD_RESTART"
                : "CHILD_DONE",
            subagent_type: "helper",
          },
        }
      return { content: "PARENT_DONE" }
    },
  })
  await runtime.crash()
  await writeFile(
    join(runtime.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      agents: {
        helper: {
          mode: "subagent",
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        },
      },
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
  const requests = join(runtime.output, "task-http.jsonl")
  const outage = join(runtime.output, "task-cancel-conflict")
  const serverFile = join(runtime.output, "native-server.mjs")
  await writeFile(
    serverFile,
    `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};import {appendFileSync,existsSync} from "node:fs";const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async(req)=>{const url=new URL(req.url);const response=req.method==="POST"&&url.pathname.endsWith("/cancel")&&existsSync(${JSON.stringify(outage)})?Response.json({message:"private fixture conflict cause"},{status:409,headers:{"Access-Control-Allow-Origin":"*"}}):await app.handler(req);appendFileSync(${JSON.stringify(requests)},JSON.stringify({method:req.method,path:url.pathname,query:url.search,status:response.status,contentLength:req.headers.get("content-length")})+"\\n");return response}});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  const state = { child: undefined, exited: undefined }
  const logs = []
  const start = async () => {
    const old = runtime.url
    state.child = spawn(process.execPath, [serverFile], {
      cwd: runtime.directory,
      env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    state.exited = new Promise((resolve) => state.child.once("exit", resolve))
    state.child.stdout.on("data", (chunk) => {
      logs.push(chunk)
      const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
      if (match) runtime.url = match[1]
    })
    state.child.stderr.on("data", (chunk) => logs.push(chunk))
    await poll(() => runtime.url !== old, "native Task server ready", 30000)
  }
  runtime.api = async (path, body, method = body ? "POST" : "GET") => {
    const url = new URL(path, runtime.url)
    url.searchParams.set("location[directory]", runtime.directory)
    const response = await fetch(url, {
      method,
      ...(body
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    })
    const text = await response.text()
    assert.ok(response.ok, `${response.status}: ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  const close = async () => {
    hold.resolve()
    restart.resolve()
    for (const item of scenarios.values()) {
      item.child.resolve()
      item.parent.resolve()
    }
    state.child?.kill("SIGTERM")
    if (state.exited)
      await deadline(state.exited, 10000, "Task native server cleanup").catch(async () => {
        state.child.kill("SIGKILL")
        await state.exited
      })
    await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
    if (background)
      await writeFile(
        join(runtime.output, "background-ui-state.json"),
        JSON.stringify(
          {
            calls: calls.map(({ mode, parent }) => ({ mode, parent })),
            scenarios: [...scenarios].map(([mode, state]) => ({
              mode,
              parentCalls: state.parentCalls,
              notices: state.notices,
            })),
          },
          null,
          2,
        ),
      )
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
    const prompt = (text) =>
      runtime.api(`/api/session/${session.id}/prompt`, {
        prompt: {
          text: background ? text.replace("TASK_", "UI_PARENT_") : text,
        },
      })
    const list = () => runtime.api(`/api/session/${session.id}/task`)
    await prompt("TASK_DONE")
    await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST")
    if (background) await poll(() => scenario("DONE").notices === 1, "initial background completion")
    assert.equal((await list())[0].status, "completed")
    await prompt("TASK_RESTART")
    await poll(
      () =>
        calls.some((call) =>
          background ? call.mode === "RESTART" && !call.parent : call.text.includes("CHILD_RESTART"),
        ),
      "Task restart child",
    )
    state.child.kill("SIGKILL")
    await state.exited
    restart.resolve()
    await start()
    assert.ok((await list()).some((task) => task.status === "interrupted" && task.blockedReason === "process_restart"))
    await prompt("TASK_HOLD")
    await poll(
      () =>
        calls.some((call) => (background ? call.mode === "HOLD" && !call.parent : call.text.includes("CHILD_HOLD"))),
      "Task held child",
    )
    if (background) await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST")
    const tasks = await list()
    assert.equal(tasks[0].status, "running")
    if (background) assert.ok(tasks.every((task) => task.background === true))
    return {
      runtime,
      repo,
      calls,
      session,
      tasks,
      list,
      hold,
      outage,
      close,
      background: background
        ? {
            scenario,
            async launch(mode) {
              assert.ok(["IDLE", "ACTIVE", "WAIT"].includes(mode))
              await prompt(`TASK_${mode}`)
              await poll(
                () => scenario(mode).parentCalls === 2 && calls.some((call) => call.mode === mode && !call.parent),
                `background ${mode} started`,
              )
              if (mode === "IDLE") await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST")
              const task = (await list())[0]
              assert.equal(task.background, true)
              assert.equal(task.status, "running")
              return task
            },
            async settle(mode) {
              await poll(async () => (await list())[0].status === "completed", `background ${mode} receipt`)
              if (mode === "ACTIVE") {
                assert.equal(scenario(mode).parentCalls, 2)
                assert.equal(scenario(mode).notices, 0)
                scenario(mode).parent.resolve()
              }
              await poll(() => scenario(mode).parentCalls === 3, `background ${mode} parent result`)
              await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST")
              assert.equal(scenario(mode).notices, mode === "WAIT" ? 0 : 1)
              const result = await runtime.api(`/api/session/${session.id}/task/${(await list())[0].id}`)
              assert.equal(result.output, `UI_RESULT_${mode}`)
              return result
            },
          }
        : undefined,
      records: async () => (await readFile(requests, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse),
    }
  } catch (error) {
    await close()
    throw error
  }
}
