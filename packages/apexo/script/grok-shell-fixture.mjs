// Shared real CLI/Electron backend and local provider for Shell UI/parity tests.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(import.meta.url)
const repo = resolve(dirname(script), "../../..")
if (process.argv[2] === "--desktop-worker") {
  const chunks = join(repo, "packages/desktop/out/main/chunks")
  const bundle = (await readdir(chunks)).find((name) => /^node-.*\.js$/.test(name))
  assert.ok(bundle, "Build Desktop first")
  const { Server } = await import(join(chunks, bundle))
  const server = await Server.listen({ hostname: "127.0.0.1", port: Number(process.env.SHELL_PARITY_PORT) })
  console.log(`SHELL_READY ${server.url}`)
  process.once("SIGTERM", async () => {
    await server.stop(true)
    process.exit(0)
  })
}

export async function startShellFixture(kind, options = {}) {
  assert.ok(["cli", "desktop"].includes(kind))
  const output = await mkdtemp(join(tmpdir(), `apexo-shell-${kind}-`))
  await mkdir(join(output, "workspace"))
  const directory = await realpath(join(output, "workspace"))
  // options.git: make the workspace a git repo with one commit and a second worktree (for /move flows).
  if (options.git) {
    const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: directory })
    await writeFile(join(directory, "README.md"), "move fixture\n")
    git("init", "-q", "-b", "main")
    git("add", ".")
    git("commit", "-qm", "init")
    git("worktree", "add", "-q", join(output, "worktree-b"), "-b", "b")
  }
  const calls = []
  const reports = new Map()
  const fixture = createServer(async (request, response) => {
    if (await options.http?.(request, response)) return
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const chat = request.url.endsWith("/chat/completions")
    const input = chat ? body.messages : body.input
    const lastUser = input.findLastIndex(
      (item) => item.role === "user" && !JSON.stringify(item).includes("<active-task-reminder>"),
    )
    const text = JSON.stringify(input[lastUser])
    const finished = input
      .slice(lastUser + 1)
      .some((item) => item.role === "tool" || item.type === "function_call_output")
    const ancillary = !body.tools?.length
    const paths =
      options.goalReports &&
      body.tools?.find((item) => item.function?.name === "write")?.function?.parameters?.properties?.file_path?.enum
    const report = paths && reports.get(paths[0])
    const requested = report ? report.shift() : await options.next?.({ body, input, text, finished, ancillary })
    if (report && !report.length) reports.delete(paths[0])
    if (requested?.error) {
      response.writeHead(requested.error.status, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { message: requested.error.message, type: "fixture_error" } }))
      return
    }
    // Older scenarios supply the intended plan/verdict; the provider still writes it through real tools.
    if (paths?.length && !report && requested?.content) {
      const parsed = paths.length === 1 ? JSON.parse(requested.content) : undefined
      reports.set(paths[0], [
        ...(paths.length > 1
          ? [{ tool: "write", args: { file_path: paths[1], content: `# Findings\n${requested.content}` }, usage: 0 }]
          : []),
        { content: "Done", usage: 0 },
      ])
      requested.tool = "write"
      requested.args = { file_path: paths[0], content: parsed?.plan ?? requested.content }
    }
    const wake =
      !ancillary && (text.includes("Background command completed:") || text.includes("Background command failed:"))
    const match = text.match(/SHELL_START_(explicit|steer|default|immediate|bounded|stop)/)
    const panel = text.match(/TASK_PANEL_(shell|monitor|scheduler|task|child)/)?.[1]
    const action =
      requested?.tool ??
      (!ancillary && !wake && !finished && !text.includes("SHELL_STEER")
        ? panel
          ? {
              shell: "run_terminal_cmd",
              monitor: "monitor",
              scheduler: "scheduler_create",
              task: "task",
              child: "run_terminal_cmd",
            }[panel]
          : match
            ? "run_terminal_cmd"
            : undefined
        : undefined)
    const mode = panel ? `panel-${panel}` : match?.[1]
    const command = `printf 'SHELL_STARTED 😀'; printf 'SHELL_STDERR_中文' >&2; echo $$ > ${mode}.pid; while [ ! -f ${mode}.release ]; do sleep 0.1; done; printf SHELL_FINISHED`
    const args =
      requested?.args ??
      (panel === "scheduler"
        ? { interval: "1h", prompt: "TASK_PANEL_SCHEDULED", durable: true }
        : panel === "task"
          ? { description: "panel task", prompt: "TASK_PANEL_child", subagent_type: "general", run_in_background: true }
          : panel === "monitor"
            ? { command, description: "panel monitor", persistent: true }
            : {
                command,
                description: panel ? `panel ${panel}` : "Shell promotion parity",
                ...(panel === "shell" || mode === "immediate"
                  ? { block_until_ms: 0 }
                  : panel === "child"
                    ? { block_until_ms: 60_000 }
                    : mode === "bounded"
                      ? { block_until_ms: 50 }
                      : {}),
              })
    const content = requested?.content ?? (wake ? "SHELL_WAKE_OK" : "SHELL_ACK")
    calls.push({ action, mode, wake, ancillary, report: !!report, time: Date.now() })
    const id = `shell_${calls.length}`
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
          choices: [
            { index: 0, delta: {}, finish_reason: action ? "tool_calls" : (requested?.finishReason ?? "stop") },
          ],
          usage: {
            prompt_tokens: requested?.usage === 0 ? 0 : 100,
            completion_tokens: requested?.usage === 0 ? 0 : 20,
            total_tokens: requested?.usage === 0 ? 0 : 120,
          },
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
        type: requested?.finishReason === "length" ? "response.incomplete" : "response.completed",
        response: {
          id,
          object: "response",
          output: [item],
          status: requested?.finishReason === "length" ? "incomplete" : "completed",
          ...(requested?.finishReason === "length" ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
          usage: {
            input_tokens: requested?.usage === 0 ? 0 : 100,
            output_tokens: requested?.usage === 0 ? 0 : 20,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      },
    ]
    response.end(
      (requested?.finishReason === "missing" ? events.slice(0, -1) : events)
        .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
        .join(""),
    )
  })
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve))
  const baseURL = `http://127.0.0.1:${fixture.address().port}/v1`
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(APEXO_|OPENCODE_|OTEL_|GROK_MEMORY$)|(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(key),
    ),
  )
  for (const name of ["DATA", "CACHE", "CONFIG", "STATE"]) env[`XDG_${name}_HOME`] = join(output, name.toLowerCase())
  Object.assign(env, {
    APEXO_RUNTIME_PROFILE: "grok-build",
    APEXO_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true",
    APEXO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "100",
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
            ...options.models,
          },
          options: { apiKey: "local-parity-key", baseURL },
        },
      },
      ...options.config,
    }),
    ...options.env,
  })
  await mkdir(env.APEXO_TEST_HOME)
  await writeFile(env.APEXO_MODELS_PATH, "{}")
  const reservation = createServer()
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const executable =
    kind === "desktop"
      ? join(
          repo,
          "packages/desktop/node_modules/electron/dist",
          (await readFile(join(repo, "packages/desktop/node_modules/electron/path.txt"), "utf8")).trim(),
        )
      : "bun"
  const logs = []
  const launch = () => {
    const child = spawn(
      executable,
      kind === "desktop"
        ? [script, "--desktop-worker"]
        : [
            ...(options.bunArgs ?? []),
            join(repo, "packages/apexo/src/index.ts"),
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(port),
            ...(options.args ?? []),
          ],
      {
        cwd: join(repo, "packages/apexo"),
        env: {
          ...env,
          SHELL_PARITY_PORT: String(port),
          ...(kind === "desktop"
            ? {
                ELECTRON_RUN_AS_NODE: "1",
                APEXO_WORKFLOW_SCRIPT: join(
                  repo,
                  "packages/desktop/resources",
                  `apexo-workflow-script${process.platform === "win32" ? ".exe" : ""}`,
                ),
              }
            : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })))
    const ready = Promise.withResolvers()
    child.stdout.on("data", (chunk) => {
      logs.push(chunk)
      if (chunk.toString().includes(`http://127.0.0.1:${port}`)) ready.resolve()
    })
    child.stderr.on("data", (chunk) => logs.push(chunk))
    child.once("error", ready.reject)
    child.once("exit", (code) => ready.reject(new Error(`Backend exited ${code}: ${Buffer.concat(logs)}`)))
    return { child, exited, ready: ready.promise }
  }
  const backend = { current: options.deferBackend ? undefined : launch() }
  // Lifecycle controls are restricted to this fixture's own child and isolated data.
  const crash = async () => {
    assert.ok(backend.current, "No fixture backend to crash")
    backend.current.child.kill("SIGKILL")
    const result = await deadline(backend.current.exited, 10_000, "isolated backend crash")
    assert.equal(result.signal, "SIGKILL")
    return result
  }
  const reopen = async () => {
    assert.ok(!backend.current || backend.current.child.exitCode !== null || backend.current.child.signalCode !== null)
    backend.current = launch()
    await deadline(backend.current.ready, 30_000, "recovered backend readiness")
  }
  const close = async () => {
    if (backend.current) {
      backend.current.child.kill("SIGTERM")
      await deadline(backend.current.exited, 10_000, "backend cleanup").catch(async () => {
        backend.current.child.kill("SIGKILL")
        await backend.current.exited
      })
    }
    fixture.closeAllConnections()
    await new Promise((resolve) => fixture.close(resolve))
    await writeFile(join(output, "backend.log"), Buffer.concat(logs))
    await writeFile(join(output, "calls.json"), JSON.stringify(calls, null, 2))
  }
  if (backend.current)
    await deadline(backend.current.ready, 30_000, "backend readiness").catch(async (error) => {
      await close()
      throw new Error(`Backend readiness failed; fixture evidence: ${output}`, { cause: error })
    })
  const url = `http://127.0.0.1:${port}`
  const api = async (endpoint, body, method = body ? "POST" : "GET", timeoutMs = 45_000) => {
    const response = await fetch(`${url}${endpoint}?directory=${encodeURIComponent(directory)}`, {
      method,
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((cause) => {
      throw new Error(`Fixture request failed: ${method} ${endpoint}`, { cause })
    })
    const text = await response.text()
    assert.ok(response.ok, `${method} ${endpoint}: ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  return { output, directory, calls, url, api, close, env, crash, reopen }
}

export async function deadline(promise, ms, name) {
  const timeout = Promise.withResolvers()
  const handle = setTimeout(() => timeout.reject(new Error(`Timed out: ${name}`)), ms)
  return Promise.race([promise, timeout.promise]).finally(() => clearTimeout(handle))
}

export async function poll(check, name, ms = 10_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const result = await check()
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out: ${name}`)
}
