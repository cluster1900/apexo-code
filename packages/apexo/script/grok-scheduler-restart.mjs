// bun script/grok-scheduler-restart.mjs cli|desktop
// Real process restarts; the local model fixture drives production scheduler tools.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"

const script = fileURLToPath(import.meta.url)
const repo = resolve(dirname(script), "../../..")
if (process.argv[2] === "--desktop-worker") {
  const chunks = join(repo, "packages/desktop/out/main/chunks")
  const bundle = (await readdir(chunks)).find((name) => /^node-.*\.js$/.test(name))
  assert.ok(bundle, "Build Desktop first")
  const { Server } = await import(join(chunks, bundle))
  const app = Server.Default().app
  const send = (message) => process.stdout.write(`RESTART_IPC ${JSON.stringify(message)}\n`)
  createInterface({ input: process.stdin }).on("line", async (line) => {
    const { id, endpoint, body, method } = JSON.parse(line)
    try {
      const response = await app.request(`http://localhost${endpoint}`, {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      })
      send({ id, status: response.status, text: await response.text() })
    } catch (error) {
      send({ id, status: 500, text: String(error) })
    }
  })
  send({ ready: true })
} else {
  await main()
}

async function main() {
  const kind = process.argv[2] ?? "cli"
  assert.ok(["cli", "desktop"].includes(kind))
  const output = await mkdtemp(join(tmpdir(), `apexo-scheduler-restart-${kind}-`))
  const directory = join(output, "workspace")
  await mkdir(directory)
  const calls = []
  const state = { taskID: "", fires: 0, wakes: 0 }
  const fixture = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const chat = request.url.endsWith("/chat/completions")
    const input = chat ? body.messages : body.input
    const lastUser = input.findLastIndex((item) => item.role === "user")
    const text = JSON.stringify(input[lastUser])
    const finished = input
      .slice(lastUser + 1)
      .some((item) => item.role === "tool" || item.type === "function_call_output")
    const ancillary = !body.tools?.length
    const wake = !ancillary && text.includes("Scheduled task completed:")
    const child = !ancillary && !wake && text.includes("RESTART_CHILD")
    const action =
      !ancillary && !child && !wake && !finished
        ? text.includes("RESTART_CREATE")
          ? "scheduler_create"
          : text.includes("RESTART_LIST")
            ? "scheduler_list"
            : text.includes("RESTART_DELETE")
              ? "scheduler_delete"
              : undefined
        : undefined
    if (child) state.fires++
    if (wake) state.wakes++
    const args =
      action === "scheduler_create"
        ? { interval: "1m", prompt: "RESTART_CHILD", durable: true, fire_immediately: false }
        : action === "scheduler_delete"
          ? { task_id: state.taskID }
          : {}
    const content = child ? "RESTART_CHILD_OK" : wake ? "RESTART_WAKE_OK" : "RESTART_ACK"
    calls.push({ action, child, wake, ancillary })
    const id = `restart_${calls.length}`
    response.writeHead(200, { "content-type": "text/event-stream" })
    if (chat) {
      const delta = action
        ? {
            role: "assistant",
            tool_calls: [
              { index: 0, id, type: "function", function: { name: action, arguments: JSON.stringify(args) } },
            ],
          }
        : { role: "assistant", content }
      const events = [
        { id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: null }] },
        {
          id,
          object: "chat.completion.chunk",
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: action ? "tool_calls" : "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        },
      ]
      response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n")
      return
    }
    const item = action
      ? { type: "function_call", id, call_id: id, name: action, arguments: JSON.stringify(args), status: "completed" }
      : {
          type: "message",
          id,
          role: "assistant",
          content: [{ type: "output_text", text: content, annotations: [] }],
          status: "completed",
        }
    const events = [
      { type: "response.created", response: { id, object: "response", output: [], created_at: 1, model: body.model } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, arguments: "", content: [], status: "in_progress" },
      },
      ...(action
        ? [
            { type: "response.function_call_arguments.delta", output_index: 0, item_id: id, delta: item.arguments },
            { type: "response.function_call_arguments.done", output_index: 0, item_id: id, arguments: item.arguments },
          ]
        : [
            {
              type: "response.output_text.delta",
              output_index: 0,
              content_index: 0,
              item_id: id,
              delta: content,
              logprobs: [],
            },
          ]),
      { type: "response.output_item.done", output_index: 0, item },
      {
        type: "response.completed",
        response: {
          id,
          object: "response",
          output: [item],
          status: "completed",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      },
    ]
    response.end(
      events.map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(""),
    )
  })
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve))
  const baseURL = `http://127.0.0.1:${fixture.address().port}/v1`
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(APEXO_|OPENCODE_|OTEL_)|(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(key),
    ),
  )
  for (const name of ["DATA", "CACHE", "CONFIG", "STATE"]) env[`XDG_${name}_HOME`] = join(output, name.toLowerCase())
  Object.assign(env, {
    APEXO_RUNTIME_PROFILE: "grok-build",
    APEXO_APP_DIR_NAME: "apexo",
    APEXO_CLIENT: kind,
    APEXO_TEST_HOME: join(output, "home"),
    APEXO_TEST_MANAGED_CONFIG_DIR: join(output, "managed"),
    APEXO_MODELS_PATH: join(output, "models.json"),
    APEXO_DISABLE_MODELS_FETCH: "1",
    APEXO_DISABLE_FFF: "1",
    APEXO_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
    XAI_API_KEY: "local-parity-key",
    XAI_BASE_URL: baseURL,
    APEXO_CONFIG_CONTENT: JSON.stringify({
      model: "xai/grok-4.7",
      enabled_providers: ["xai"],
      permission: { "*": "allow" },
      lsp: false,
      provider: {
        xai: {
          npm: "@ai-sdk/xai",
          models: {
            "grok-4.7": { name: "Restart parity", tool_call: true, limit: { context: 100000, output: 10000 } },
          },
          options: { apiKey: "local-parity-key", baseURL },
        },
      },
    }),
  })
  await mkdir(env.APEXO_TEST_HOME)
  await writeFile(env.APEXO_MODELS_PATH, "{}")
  const processes = []
  const start = async () => {
    const desktop = kind === "desktop"
    // Kill the actual backend, not Electron's JS launcher (SIGKILL cannot be forwarded).
    const executable = desktop
      ? join(
          repo,
          "packages/desktop/node_modules/electron/dist",
          (await readFile(join(repo, "packages/desktop/node_modules/electron/path.txt"), "utf8")).trim(),
        )
      : "bun"
    const child = spawn(
      executable,
      desktop
        ? [script, "--desktop-worker"]
        : [join(repo, "packages/apexo/src/index.ts"), "serve", "--hostname", "127.0.0.1", "--port", "0"],
      {
        cwd: join(repo, "packages/apexo"),
        env: { ...env, ...(desktop ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
        stdio: ["pipe", "pipe", "pipe"],
      },
    )
    processes.push(child)
    const logs = []
    const pending = new Map()
    const ready = Promise.withResolvers()
    const exited = new Promise((resolve) => child.once("exit", resolve))
    child.stderr.on("data", (data) => logs.push(data))
    child.stdout.on("data", (data) => {
      logs.push(data)
      const address = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]
      if (address) ready.resolve(address)
    })
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (!line.startsWith("RESTART_IPC ")) return
      const message = JSON.parse(line.slice("RESTART_IPC ".length))
      if (message.ready) ready.resolve()
      pending.get(message.id)?.resolve(message)
    })
    child.once("error", ready.reject)
    child.once("exit", (code) => ready.reject(new Error(`Backend exited ${code}: ${Buffer.concat(logs)}`)))
    const address = await deadline(ready.promise, 30_000, "backend readiness")
    const api = async (endpoint, body, method = body ? "POST" : "GET") => {
      const url = `${endpoint}?directory=${encodeURIComponent(directory)}`
      if (!desktop) {
        const response = await fetch(`${address}${url}`, {
          method,
          ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(30_000),
        })
        const text = await response.text()
        assert.ok(response.ok, text)
        return text ? JSON.parse(text) : undefined
      }
      const id = crypto.randomUUID()
      const reply = Promise.withResolvers()
      pending.set(id, reply)
      child.stdin.write(JSON.stringify({ id, endpoint: url, body, method }) + "\n")
      const response = await deadline(reply.promise, 30_000, endpoint).finally(() => pending.delete(id))
      assert.ok(response.status < 300, response.text)
      return response.text ? JSON.parse(response.text) : undefined
    }
    return {
      api,
      stop: async (signal = "SIGTERM") => {
        child.kill(signal)
        await deadline(exited, 10_000, "backend exit")
        await writeFile(join(output, `process-${processes.indexOf(child)}.log`), Buffer.concat(logs))
      },
    }
  }
  try {
    const first = await start()
    const session = await first.api("/session", { title: "Scheduler restart parity" })
    const prompt = (server, text) =>
      server.api(`/session/${session.id}/message`, {
        model: { providerID: "xai", modelID: "grok-4.7" },
        parts: [{ type: "text", text }],
      })
    const created = await prompt(first, "RESTART_CREATE")
    const history = await first.api(`/session/${session.id}/message`)
    const creation = history
      .flatMap((message) => message.parts)
      .find((part) => part.type === "tool" && part.tool === "scheduler_create")
    assert.equal(creation?.state.status, "completed", JSON.stringify(created))
    state.taskID = creation.state.metadata.task_id
    assert.ok(state.taskID)
    const original = creation.state.metadata
    await writeFile(join(output, "created.json"), JSON.stringify(creation, null, 2))
    await first.stop("SIGKILL")
    const second = await start()
    await prompt(second, "RESTART_LIST")
    const resumed = await second.api(`/session/${session.id}/message`)
    const list = resumed
      .flatMap((message) => message.parts)
      .findLast((part) => part.type === "tool" && part.tool === "scheduler_list")
    assert.equal(list?.state.status, "completed")
    assert.equal(list.state.metadata.count, 1, JSON.stringify(list))
    assert.deepEqual(list.state.metadata.task_ids, [state.taskID])
    const end = Date.now() + 75_000
    while (!state.wakes && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(state.fires, 1, "Recovered schedule did not fire exactly once")
    assert.equal(state.wakes, 1, "Recovered schedule did not wake its parent exactly once")
    await prompt(second, "RESTART_DELETE")
    await prompt(second, "RESTART_LIST")
    await writeFile(
      join(output, "resumed.json"),
      JSON.stringify(await second.api(`/session/${session.id}/message`), null, 2),
    )
    await second.stop()
    const third = await start()
    await prompt(third, "RESTART_LIST")
    const deleted = (await third.api(`/session/${session.id}/message`))
      .flatMap((message) => message.parts)
      .findLast((part) => part.type === "tool" && part.tool === "scheduler_list")
    assert.equal(deleted?.state.metadata.count, 0, "Deleted schedule resurrected")
    assert.equal(state.fires, 1)
    await third.stop()
    await writeFile(
      join(output, "result.json"),
      JSON.stringify({ kind, taskID: state.taskID, original, calls, ...state }, null, 2),
    )
    console.log(
      JSON.stringify({
        result: "pass",
        kind,
        output,
        processes: processes.length,
        fires: state.fires,
        wakes: state.wakes,
        deletionSurvivedRestart: true,
      }),
    )
  } finally {
    for (const child of processes) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    fixture.closeAllConnections()
    await new Promise((resolve) => fixture.close(resolve))
    console.error(`Restart evidence: ${output}`)
  }
}

function deadline(promise, ms, label) {
  let timeout
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms)
    }),
  ]).finally(() => clearTimeout(timeout))
}
