// bun script/grok-parity.mjs cli
// ELECTRON_RUN_AS_NODE=1 <electron> script/grok-parity.mjs desktop
// Runs real tool implementations against a deterministic local provider/media fixture.
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"

const kind = process.argv[2] ?? "cli"
const restricted = process.argv[3] === "restricted"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const output = await mkdtemp(join(tmpdir(), `apexo-grok-parity-${kind}-`))
const directory = join(output, "workspace")
await mkdir(directory)
for (const key of Object.keys(process.env)) {
  if (/^(APEXO_|OPENCODE_|OTEL_)/.test(key) || /(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(key)) delete process.env[key]
}
for (const name of ["DATA", "CACHE", "CONFIG", "STATE"])
  process.env[`XDG_${name}_HOME`] = join(output, name.toLowerCase())
Object.assign(process.env, {
  APEXO_APP_DIR_NAME: "apexo",
  APEXO_RUNTIME_PROFILE: "grok-build",
  APEXO_TEST_HOME: join(output, "home"),
  APEXO_TEST_MANAGED_CONFIG_DIR: join(output, "managed"),
  APEXO_MODELS_PATH: join(output, "models.json"),
  APEXO_DISABLE_MODELS_FETCH: "1",
  APEXO_DISABLE_FFF: "1",
  APEXO_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
  APEXO_CLIENT: kind,
  XAI_API_KEY: "local-parity-key",
})
await mkdir(process.env.APEXO_TEST_HOME)
await writeFile(process.env.APEXO_MODELS_PATH, "{}")
const calls = []
const replies = []
const state = { index: 0, shell: "", monitor: "", schedule: "", image: "", child: "" }
const text = (body) =>
  JSON.stringify(body.input?.filter((item) => item.type === "function_call_output").at(-1)?.output ?? "")
const job = (body) => text(body).match(/job_[\w-]+/)?.[0] ?? "missing"
const steps = [
  ["write", () => ({ file_path: join(directory, "note.txt"), content: "before\n" })],
  ["read_file", () => ({ target_file: join(directory, "note.txt") })],
  ["search_replace", () => ({ file_path: join(directory, "note.txt"), old_string: "before", new_string: "after" })],
  ["run_terminal_cmd", () => ({ command: "printf SHELL_OK", description: "parity shell", block_until_ms: 0 })],
  ["get_task_output", (body) => ({ task_ids: [(state.shell = job(body))], timeout_ms: 10000 })],
  ["monitor", () => ({ command: "printf MONITOR_OK; sleep 30", description: "parity monitor" })],
  ["get_task_output", (body) => ({ task_ids: [(state.monitor = job(body))], timeout_ms: 50 })],
  ["kill_task", () => ({ task_id: state.monitor })],
  ["scheduler_create", () => ({ interval: "1m", prompt: "PARITY_CHILD", recurring: false })],
  [
    "scheduler_list",
    (body) => {
      state.schedule = job(body)
      return {}
    },
  ],
  ["scheduler_delete", () => ({ task_id: state.schedule })],
  [
    "scheduler_create",
    () => ({ interval: "1m", prompt: "SCHEDULED_PARITY_CHILD", recurring: false, fire_immediately: true }),
  ],
  ["get_task_output", (body) => ({ task_ids: [job(body)], timeout_ms: 10000 })],
  ["memory", () => ({ operation: "remember", content: "PARITY_NOTE: use Bun for tests" })],
  ["memory", () => ({ operation: "read" })],
  ["memory", () => ({ operation: "dream" })],
  ["image_gen", () => ({ prompt: "one blue square" })],
  [
    "image_to_video",
    (body) => {
      state.image = text(body).match(/Saved image_gen output to ([^"\\]+?)\./)?.[1] ?? ""
      // The file path may contain periods; the sentence ends at the extension.
      state.image = text(body).match(/Saved image_gen output to (.+?\.(?:png|jpg))/)?.[1] ?? state.image
      return { image: state.image, duration: 6 }
    },
  ],
  ["reference_to_video", () => ({ prompt: "animate the square", images: [state.image], duration: 6 })],
  [
    "task",
    () => ({ description: "parity child", prompt: "PARITY_CHILD", subagent_type: "general", run_in_background: false }),
  ],
  [
    "send_subagent_message",
    (body) => ({
      task_id: (state.child = text(body).match(/ses_[\w]+/)?.[0] ?? "missing"),
      prompt: "PARITY_CHILD followup",
    }),
  ],
  ["get_task_output", () => ({ task_ids: [state.child], timeout_ms: 10000 })],
]
const fixture = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
  const chat = request.url === "/v1/chat/completions"
  const body = chat
    ? {
        ...raw,
        input: raw.messages.map((message) =>
          message.role === "tool" ? { type: "function_call_output", output: message.content } : message,
        ),
        tools: raw.tools?.map((tool) => tool.function),
      }
    : raw
  if (request.url !== "/v1/responses" && !chat) {
    const value =
      request.url === "/v1/images/generations"
        ? {
            data: [
              {
                b64_json:
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1EAAAAASUVORK5CYII=",
              },
            ],
          }
        : request.url === "/v1/videos/generations"
          ? { request_id: "video" }
          : request.url === "/v1/videos/video"
            ? { status: "done", video: { url: `http://127.0.0.1:${fixture.address().port}/asset.mp4` } }
            : undefined
    if (!value) {
      assert.equal(request.url, "/asset.mp4")
      assert.equal(request.headers.authorization, undefined, "CDN download leaked credentials")
    }
    response.writeHead(200, { "content-type": value ? "application/json" : "video/mp4" })
    response.end(value ? JSON.stringify(value) : "fixture-video")
    return
  }
  const lastUser = body.input?.filter((item) => item.role === "user").at(-1)
  const child = JSON.stringify(lastUser).includes("PARITY_CHILD")
  const scheduled = JSON.stringify(lastUser).includes("SCHEDULED_PARITY_CHILD")
  const ancillary = !body.tools?.length
  const step = child || ancillary ? undefined : steps[state.index++]
  if (!child && !ancillary) {
    replies.push(text(body))
    calls.push({ tools: body.tools.map((tool) => tool.name).sort(), step: step?.[0] ?? "done" })
  }
  const id = `parity_${calls.length}_${Date.now()}`
  const item = step
    ? {
        type: "function_call",
        id,
        call_id: id,
        name: step[0],
        arguments: JSON.stringify(step[1](body)),
        status: "completed",
      }
    : {
        type: "message",
        id,
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: scheduled ? "SCHEDULED_CHILD_OK" : child ? "CHILD_OK" : "PARITY_OK",
            annotations: [],
          },
        ],
        status: "completed",
      }
  if (chat) {
    const delta = step
      ? {
          role: "assistant",
          tool_calls: [{ index: 0, id, type: "function", function: { name: item.name, arguments: item.arguments } }],
        }
      : { role: "assistant", content: item.content[0].text }
    const chunks = [
      { id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: null }] },
      {
        id,
        object: "chat.completion.chunk",
        model: body.model,
        choices: [{ index: 0, delta: {}, finish_reason: step ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
    ]
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n")
    return
  }
  const events = [
    { type: "response.created", response: { id, object: "response", output: [], created_at: 1, model: body.model } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, arguments: "", content: [], status: "in_progress" },
    },
    ...(step
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
            delta: item.content[0].text,
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
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(
    events.map((event, index) => `data: ${JSON.stringify({ ...event, sequence_number: index })}\n\n`).join(""),
  )
})
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve))
process.env.XAI_BASE_URL = `http://127.0.0.1:${fixture.address().port}/v1`
process.env.APEXO_CONFIG_CONTENT = JSON.stringify({
  model: "xai/grok-4.7",
  ...(restricted
    ? { default_agent: "parity", agent: { parity: { mode: "primary", permission: { grep: "deny" } } } }
    : {}),
  enabled_providers: ["xai"],
  permission: { "*": "allow" },
  lsp: false,
  provider: {
    xai: {
      npm: "@ai-sdk/xai",
      models: { "grok-4.7": { name: "Parity", tool_call: true, limit: { context: 100000, output: 10000 } } },
      options: { apiKey: "local-parity-key", baseURL: process.env.XAI_BASE_URL },
    },
  },
})
const timer = setTimeout(() => {
  console.error("Parity timed out", output, calls)
  process.exit(2)
}, 120000)
try {
  if (kind === "cli") {
    const proc = spawn(
      "bun",
      [
        "run",
        join(repo, "packages/apexo/src/index.ts"),
        "run",
        "--dir",
        directory,
        "--profile",
        "grok-build",
        "--format",
        "streaming-json",
        "--model",
        "xai/grok-4.7",
        "Run the parity scenario",
      ],
      { cwd: directory, env: { ...process.env, PWD: directory }, stdio: ["ignore", "pipe", "pipe"] },
    )
    const stdout = []
    const stderr = []
    proc.stdout.on("data", (chunk) => stdout.push(chunk))
    proc.stderr.on("data", (chunk) => stderr.push(chunk))
    const code = await new Promise((resolve) => proc.once("exit", resolve))
    await writeFile(join(output, "cli.jsonl"), Buffer.concat(stdout))
    await writeFile(join(output, "cli.stderr"), Buffer.concat(stderr))
    assert.equal(code, 0, Buffer.concat(stderr).toString())
    assert.match(Buffer.concat(stdout).toString(), /PARITY_OK/)
    const events = Buffer.concat(stdout)
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    const advertised = events.find((event) => event.type === "available_commands")
    assert.deepEqual(
      advertised.tools.toSorted(),
      calls[0].tools,
      "CLI manifest differs from the tools sent to the model",
    )
    for (const command of ["memory", "remember", "flush", "dream"]) assert.ok(advertised.commands.includes(command))
  } else {
    const chunks = join(repo, "packages/desktop/out/main/chunks")
    const bundle = (await readdir(chunks)).find((name) => /^node-.*\.js$/.test(name))
    assert.ok(bundle, "Build Desktop before running this check")
    const { Server } = await import(join(chunks, bundle))
    const app = Server.Default().app
    const api = async (endpoint, body) => {
      const response = await app.request(`http://localhost${endpoint}?directory=${encodeURIComponent(directory)}`, {
        method: body ? "POST" : "GET",
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      })
      assert.ok(response.ok, await response.clone().text())
      return response.status === 204 ? undefined : response.json()
    }
    const session = await api("/session", { title: "Grok parity" })
    await api(`/session/${session.id}/message`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      parts: [{ type: "text", text: "Run the parity scenario" }],
    })
    const history = await api(`/session/${session.id}/message`)
    await writeFile(join(output, "history.json"), JSON.stringify(history, null, 2))
    assert.ok(
      history.some((message) => message.parts.some((part) => part.type === "text" && part.text === "PARITY_OK")),
    )
    assert.equal(
      history
        .flatMap((message) => message.parts)
        .filter((part) => part.type === "tool" && part.state.status === "error").length,
      0,
    )
  }
  assert.equal(await readFile(join(directory, "note.txt"), "utf8"), "after\n")
  assert.ok(
    state.image.includes(directory) || state.image.includes(resolve("/private", directory.slice(1))),
    "Media saved outside the session workspace",
  )
  assert.equal(calls.length, steps.length + 1)
  if (restricted) assert.ok(!calls[0].tools.includes("grep"), "Default agent permission was ignored")
  for (const marker of [
    "SHELL_OK",
    "MONITOR_OK",
    "PARITY_NOTE",
    "CHILD_OK",
    "SCHEDULED_CHILD_OK",
    "Saved image_gen",
    "Saved image_to_video",
    "Saved reference_to_video",
  ])
    assert.ok(
      replies.some((reply) => reply.includes(marker)),
      `Missing result ${marker}`,
    )
  const result = {
    kind,
    restricted,
    versions: process.versions,
    tools: calls[0].tools,
    steps: steps.map((step) => step[0]),
    result: "pass",
    output,
  }
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  clearTimeout(timer)
  fixture.close()
}
process.exit(0)
