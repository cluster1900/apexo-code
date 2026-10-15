import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { appendFileSync } from "node:fs"
import { createServer, request } from "node:http"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

export async function startPlanUiFixture(options = {}) {
  const repo = resolve(import.meta.dirname, "../../..")
  const state = { stage: 0, mode: options.mode ?? "plan", child: undefined, exited: undefined }
  const runtime = await startShellFixture(options.runtime ?? "cli", {
    config: options.config,
    next:
      options.next ??
      (({ body }) => {
        state.stage += 1
        if (state.mode === "permission")
          return state.stage === 1
            ? {
                tool: "bash",
                args: { command: "printf NATIVE_PERMISSION_EXECUTED", description: "Native terminal permission" },
              }
            : { content: "NATIVE_PERMISSION_DONE" }
        if (state.mode === "stop")
          return state.stage === 1
            ? {
                tool: "bash",
                args: {
                  command: "sleep 30; printf NATIVE_STOP_SHOULD_NOT_APPEAR",
                  description: "Native terminal cancellation",
                },
              }
            : { content: "NATIVE_STOP_UNEXPECTED_CONTINUATION" }
        if (state.mode === "ordinary")
          return state.stage === 1
            ? {
                tool: "question",
                args: {
                  questions: [
                    {
                      header: "Default question",
                      question: "An ordinary question allows a custom answer",
                      options: [
                        { label: "First", description: "First choice" },
                        { label: "Second", description: "Second choice" },
                      ],
                    },
                  ],
                },
              }
            : { content: "ORDINARY_QUESTION_DONE" }
        if (state.stage === 1) return { tool: "plan_enter", args: {} }
        if (state.stage === 2) {
          const filename = JSON.stringify(body).match(/Draft the plan at ([^;]+);/)?.[1]
          assert.ok(filename)
          return {
            tool: "write",
            args: {
              path: filename,
              content: [
                "PLAN_UI_EXACT_ARTIFACT",
                "- Preserve this text: 批准 / 核准 / Approve",
                ...Array.from({ length: 80 }, (_, index) => `${index + 1}. Review line before implementation`),
                "LONG_TOKEN_" + "x".repeat(400),
                "PLAN_UI_END_MARKER",
              ].join("\n"),
            },
          }
        }
        if (state.stage === 3) return { tool: "plan_exit", args: {} }
        return { content: "PLAN_UI_CONTINUED" }
      }),
  })
  if (!options.mixed) await runtime.crash()
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  const logs = []
  const records = join(runtime.output, "plan-http.jsonl")
  const serverFile = join(runtime.output, "plan-native-server.mjs")
  await writeFile(
    serverFile,
    `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};import {appendFileSync} from "node:fs";const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async(req)=>{const body=req.method==="POST"?await req.clone().text():undefined;const response=await app.handler(req);appendFileSync(${JSON.stringify(records)},JSON.stringify({method:req.method,path:new URL(req.url).pathname,status:response.status,body})+"\\n");return response}});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  let proxy
  const forwarding = new Set()
  const eventConnections = new Map()
  const start = async () => {
    if (options.mixed) {
      const target = runtime.url
      proxy = createServer((incoming, outgoing) => {
        const chunks = []
        incoming.on("data", (chunk) => chunks.push(chunk))
        const path = new URL(incoming.url, target)
        const upstream = request(
          path,
          { method: incoming.method, headers: { ...incoming.headers, host: path.host } },
          (response) => {
            appendFileSync(
              records,
              JSON.stringify({
                method: incoming.method,
                path: path.pathname,
                status: response.statusCode,
                ...(incoming.method === "POST" ? { body: Buffer.concat(chunks).toString() } : {}),
              }) + "\n",
            )
            outgoing.writeHead(response.statusCode, response.headers)
            response.pipe(outgoing)
          },
        )
        forwarding.add(upstream)
        if (path.pathname === "/api/event") eventConnections.set(upstream, outgoing)
        upstream.on("error", () => outgoing.destroy())
        outgoing.once("close", () => {
          forwarding.delete(upstream)
          eventConnections.delete(upstream)
          upstream.destroy()
        })
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
      const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
      if (match) runtime.url = match[1]
    })
    state.child.stderr.on("data", (chunk) => logs.push(chunk))
    await poll(() => runtime.url !== old, "native Plan UI server", 30000)
  }
  const stop = async (signal) => {
    if (options.mixed) {
      for (const upstream of forwarding) upstream.destroy()
      proxy.closeAllConnections()
      await deadline(new Promise((resolve) => proxy.close(resolve)), 10000, "recording proxy shutdown")
      return
    }
    state.child?.kill(signal)
    if (state.exited)
      await deadline(state.exited, 10000, "owned Plan UI server cleanup").catch(async () => {
        state.child.kill("SIGKILL")
        await state.exited
      })
  }
  const api = async (path, body, method = body === undefined ? "GET" : "POST") => {
    const url = new URL(path, runtime.url)
    url.searchParams.set("location[directory]", runtime.directory)
    const response = await fetch(url, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    })
    const text = await response.text()
    assert.ok(response.ok, `${path}: ${response.status} ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  const events = []
  const controller = new AbortController()
  let listening
  let reader
  const close = async () => {
    controller.abort()
    await reader?.cancel().catch(() => {})
    await deadline(
      listening?.catch(() => {}),
      10000,
      "fixture SSE reader shutdown",
    )
    try {
      await stop("SIGTERM")
    } finally {
      await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
      await runtime.close()
    }
  }
  try {
    await start()
    const response = await fetch(`${runtime.url}/api/event`, { signal: controller.signal })
    assert.equal(response.status, 200)
    reader = response.body.getReader()
    listening = (async () => {
      let pending = ""
      const decoder = new TextDecoder()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        pending += decoder.decode(next.value, { stream: true })
        const lines = pending.split("\n")
        pending = lines.pop()
        for (const line of lines) if (line.startsWith("data:")) events.push(JSON.parse(line.slice(5).trim()))
      }
    })()
    listening.catch(() => {})
    return {
      repo,
      runtime,
      api,
      disconnectEvents: options.mixed
        ? () =>
            eventConnections.forEach((outgoing, upstream) => {
              outgoing.destroy()
              upstream.destroy()
            })
        : undefined,
      records,
      events,
      close,
      async crash() {
        await stop("SIGKILL")
        await start()
      },
      async prepare(mode = "plan") {
        state.stage = 0
        state.mode = mode
        const session = (
          await api("/api/session", {
            location: { directory: runtime.directory },
            agent: "build",
            model: { providerID: "xai", id: "grok-4.7" },
          })
        ).data
        await api(`/api/session/${session.id}/prompt`, { prompt: { text: "Prepare a plan for explicit review" } })
        if (mode === "stop") {
          await poll(async () => (await api(`/api/session/active`)).data[session.id], "native stop drain")
          return { session }
        }
        const question = await poll(
          async () =>
            (await api(`/api/session/${session.id}/${mode === "permission" ? "permission" : "question"}`)).data[0],
          "native UI Plan review",
        )
        return { session, question }
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
