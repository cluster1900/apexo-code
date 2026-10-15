import { expect } from "bun:test"
import { Task } from "@apexo/schema/task"
import { Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SessionMessage } from "@apexo/core/session/message"
import { createRoutes } from "@apexo/server/routes"
import { TestInstance } from "../fixture/fixture"
import { reply, TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"
import path from "node:path"

const served = HttpRouter.serve(createRoutes(), { disableListenLog: true, disableLogger: true })
const it = testEffect(
  Layer.mergeAll(
    served.pipe(
      Layer.provide(HttpServer.layerServices),
      Layer.provide(layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
    TestLLMServer.layer,
  ),
)
const SessionResponse = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })
const MessagesResponse = Schema.Struct({ data: Schema.Array(SessionMessage.Message) })
const post = (url: string, body: unknown) =>
  HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))

const configure = (directory: string, url: string, ask = false) =>
  Effect.promise(() =>
    Bun.write(
      path.join(directory, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        task: { activeMessages: true },
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          ...(ask ? [{ action: "send_subagent_message", resource: "ses_*", effect: "ask" }] : []),
        ],
        agents: {
          helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] },
          restricted: { mode: "primary", permissions: [{ action: "task", resource: "ses_*", effect: "deny" }] },
        },
        providers: {
          "task-fixture": {
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: url, settings: { apiKey: "test" } },
            models: {
              model: {
                name: "Task model",
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 100000, output: 4096 },
              },
            },
          },
        },
      }),
    ),
  )

const readMessages = (id: string) =>
  HttpClient.get(`/api/session/${id}/message?order=asc`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
  )
const finished = (id: string, text: string) =>
  pollWithTimeout(
    readMessages(id).pipe(
      Effect.map((response) =>
        response.data.some(
          (message) =>
            message.type === "assistant" &&
            message.time.completed &&
            message.content.some((part) => part.type === "text" && part.text === text),
        )
          ? response.data
          : undefined,
      ),
    ),
    "Task fixture did not settle",
    "20 seconds",
  )

const create = (directory: string) =>
  post("/api/session", {
    location: { directory },
    model: { providerID: "task-fixture", id: "model" },
    agent: "build",
  }).pipe(
    Effect.flatMap((response) =>
      response.status === 200
        ? response.json
        : Effect.gen(function* () {
            const server = yield* HttpServer.HttpServer
            const text = yield* response.text
            yield* Effect.logError("Subagent fixture Session response provenance", {
              pid: process.pid,
              listener: server.address,
              request: response.request.url,
              status: response.status,
              contentType: response.headers["content-type"],
              server: response.headers.server,
              location: response.headers.location,
            })
            return yield* Effect.fail(new Error(`Create Session returned ${response.status}: ${text}`))
          }),
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(SessionResponse)),
    Effect.map((response) => response.data.id),
  )
const list = (parent: string) =>
  HttpClient.get(`/api/session/${parent}/task`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
  )
const detail = (parent: string, child: string) =>
  HttpClient.get(`/api/session/${parent}/task/${child}`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(Task.Detail)),
  )
const parentRequest = (hit: { body: Record<string, unknown> }) =>
  !Array.isArray(hit.body.messages) ||
  !hit.body.messages.some(
    (message: unknown) =>
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      message.role === "user" &&
      /SUBAGENT_WORK|HELD_HOOK_CHILD/.test(JSON.stringify(message)),
  )

const hooks = (directory: string, response: string) =>
  Effect.gen(function* () {
    const home = path.join(directory, "hook-home")
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const previous = { home: process.env.GROK_HOME, profile: process.env.APEXO_RUNTIME_PROFILE }
        process.env.GROK_HOME = home
        process.env.APEXO_RUNTIME_PROFILE = "grok-build"
        return previous
      }),
      (previous) =>
        Effect.sync(() => {
          if (previous.home === undefined) delete process.env.GROK_HOME
          else process.env.GROK_HOME = previous.home
          if (previous.profile === undefined) delete process.env.APEXO_RUNTIME_PROFILE
          else process.env.APEXO_RUNTIME_PROFILE = previous.profile
        }),
    )
    const script = path.join(directory, "hook.mjs")
    const log = path.join(directory, "hooks.jsonl")
    yield* Effect.promise(async () => {
      await Bun.write(
        script,
        `import fs from "node:fs/promises";
const input = JSON.parse(await Bun.stdin.text());
await fs.appendFile(${JSON.stringify(log)}, JSON.stringify(input) + "\\n");
if (input.hook_event_name === "SubagentStop") { ${response} }
`,
      )
      const command = `exec '${process.execPath.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}'`
      const group = { matcher: "helper", hooks: [{ type: "command", command }] }
      await Bun.write(
        path.join(home, "hooks/subagent.json"),
        JSON.stringify({
          hooks: {
            SubagentStart: [group],
            SubagentStop: [group],
            SubagentEnd: [group],
            subagent_end: [group],
            subagentEnd: [group],
            SubagentFinished: [{ hooks: [{ type: "command", command: "exit 99" }] }],
          },
        }),
      )
    })
    return {
      log,
      read: Effect.promise(async () =>
        (await Bun.file(log).text())
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ),
    }
  })

for (const mode of ["continue", "cap", "turn-limit"] as const)
  it.instance(`native Subagent hooks ${mode} preserve ownership, aliases and provider budgets`, () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      if (mode === "turn-limit")
        yield* Effect.promise(async () => {
          const file = Bun.file(path.join(instance.directory, "apexo.json"))
          const config = await file.json()
          config.agents.helper.steps = 2
          await Bun.write(file, JSON.stringify(config))
        })
      const fixture = yield* hooks(
        instance.directory,
        mode === "cap" || mode === "turn-limit"
          ? 'console.log(JSON.stringify({decision:"block",reason:"HOOK_FOLLOWUP"}));'
          : 'console.log(JSON.stringify(input.stop_hook_active ? {continue:false,decision:"block",reason:"IGNORED_BLOCK"} : {hookSpecificOutput:{additionalContext:"HOOK_FOLLOWUP"}}));',
      )
      const parent = yield* create(instance.directory)
      yield* llm.respond(
        () =>
          reply()
            .tool("task", {
              description: "Hook task",
              prompt: "SUBAGENT_WORK",
              subagent_type: "helper",
            })
            .item(),
        parentRequest,
      )
      const turns = mode === "cap" ? 9 : 2
      for (let index = 0; index < turns; index++)
        yield* llm.respond(
          (hit) => {
            if (index) expect(JSON.stringify(hit.body.messages)).toContain("HOOK_FOLLOWUP")
            return reply().text(`CHILD_DONE_${index}`).stop().item()
          },
          (hit) => !parentRequest(hit),
        )
      yield* llm.respond(() => reply().text("PARENT_DONE").stop().item(), parentRequest)
      expect(
        (yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Run hook child" }, resume: true })).status,
      ).toBe(200)
      yield* finished(parent, "PARENT_DONE")
      const tasks = yield* list(parent)
      expect(tasks).toHaveLength(1)
      const events = yield* fixture.read
      expect(events.filter((event) => event.hook_event_name === "SubagentStart")).toHaveLength(1)
      const stops = events.filter((event) => event.hook_event_name === "SubagentStop")
      expect(stops).toHaveLength(mode === "cap" ? 8 : mode === "turn-limit" ? 1 : 2)
      expect(stops[0]).toMatchObject({ subagent_id: tasks[0].id, subagent_type: "helper", stop_hook_active: false })
      expect(events[0]).toMatchObject({ session_id: parent, subagent_id: tasks[0].id, subagent_type: "helper" })
      expect(events.every((event) => event.subagent_type === "helper")).toBe(true)
      const result = yield* detail(parent, tasks[0].id)
      expect(result.status).toBe("completed")
      expect(result.output).toBe(`CHILD_DONE_${turns - 1}`)
      expect(
        (yield* readMessages(tasks[0].id)).data.some(
          (message) =>
            message.type === "assistant" &&
            message.content.some((part) => part.type === "text" && part.text === `CHILD_DONE_${turns - 1}`),
        ),
      ).toBe(true)
      expect(yield* llm.calls).toBe(turns + 2)
    }),
  )

for (const action of ["queue", "cancel"] as const)
  it.instance(`native Subagent held stop gate ${action} keeps admission open and joins ownership`, () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const release = path.join(instance.directory, "release")
      const pidfile = path.join(instance.directory, "held.pid")
      const fixture = yield* hooks(
        instance.directory,
        `
if (!(await Bun.file(${JSON.stringify(release)}).exists())) {
  process.on("SIGTERM", () => {});
  await Bun.write(${JSON.stringify(pidfile)}, String(process.pid));
  while (!(await Bun.file(${JSON.stringify(release)}).exists())) await Bun.sleep(10);
}
console.log(JSON.stringify({continue:false}));`,
      )
      const parent = yield* create(instance.directory)
      yield* llm.respond(
        () =>
          reply()
            .tool("task", {
              description: "Held hook",
              prompt: "HELD_HOOK_CHILD",
              subagent_type: "helper",
            })
            .item(),
        parentRequest,
      )
      yield* llm.respond(
        () => reply().text("BEFORE_HELD_GATE").stop().item(),
        (hit) => !parentRequest(hit),
      )
      if (action === "queue")
        yield* llm.respond(
          (hit) => {
            expect(JSON.stringify(hit.body.messages)).toContain("DURING_GATE_MESSAGE")
            return reply().text("AFTER_QUEUED_MESSAGE").stop().item()
          },
          (hit) => !parentRequest(hit),
        )
      yield* llm.respond(() => reply().text("PARENT_DONE").stop().item(), parentRequest)
      yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Hold gate" }, resume: true })
      const pid = yield* pollWithTimeout(
        Effect.promise(async () =>
          (await Bun.file(pidfile).exists()) ? Number(await Bun.file(pidfile).text()) : undefined,
        ),
        "Subagent stop process readiness",
        "8 seconds",
      )
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          try {
            process.kill(pid, "SIGKILL")
          } catch {}
        }),
      )
      const child = (yield* list(parent))[0]!.id
      expect((yield* detail(parent, child)).status).toBe("running")
      if (action === "queue") {
        const input = { inputID: SessionMessage.ID.create(), text: "DURING_GATE_MESSAGE", delivery: "queue" }
        expect((yield* post(`/api/session/${parent}/task/${child}/message`, input)).status).toBe(200)
        yield* Effect.promise(() => Bun.write(release, "release"))
      }
      if (action === "cancel")
        expect((yield* HttpClient.post(`/api/session/${parent}/task/${child}/cancel`)).status).toBe(204)
      yield* finished(parent, "PARENT_DONE")
      expect(() => process.kill(pid, 0)).toThrow()
      const result = yield* detail(parent, child)
      expect(result.status).toBe(action === "cancel" ? "cancelled" : "completed")
      if (action === "queue") expect(result.output).toBe("AFTER_QUEUED_MESSAGE")
      const events = yield* fixture.read
      expect(events.filter((event) => event.hook_event_name === "SubagentStart")).toHaveLength(1)
      expect(events.filter((event) => event.hook_event_name === "SubagentStop")).toHaveLength(
        action === "cancel" ? 1 : 2,
      )
      expect(yield* llm.calls).toBe(action === "cancel" ? 3 : 4)
    }),
  )

for (const outcome of ["error", "cancel", "pending"] as const)
  it.instance(`native Subagent ${outcome} reaches only eligible normal completion gates`, () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* configure(instance.directory, llm.url)
      const fixture = yield* hooks(instance.directory, "console.log(JSON.stringify({continue:false}));")
      const parent = yield* create(instance.directory)
      const arrived = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
      yield* llm.respond(
        () =>
          reply()
            .tool("task", {
              description: "Eligibility",
              prompt: "HELD_HOOK_CHILD",
              subagent_type: "helper",
            })
            .item(),
        parentRequest,
      )
      yield* llm.respond(
        () => {
          arrived.resolve()
          if (outcome === "error")
            return { type: "http-error", status: 400, body: { error: { message: "Provider rejected" } } }
          return reply().text("INITIAL_PENDING").wait(release.promise).stop().item()
        },
        (hit) => !parentRequest(hit),
      )
      if (outcome === "pending")
        yield* llm.respond(
          () => reply().text("AFTER_PENDING").stop().item(),
          (hit) => !parentRequest(hit),
        )
      yield* llm.respond(() => reply().text("PARENT_DONE").stop().item(), parentRequest)
      yield* post(`/api/session/${parent}/prompt`, { prompt: { text: "Test eligibility" }, resume: true })
      yield* Effect.promise(() => arrived.promise).pipe(Effect.timeout("8 seconds"))
      const child = (yield* list(parent))[0]!.id
      if (outcome === "cancel")
        expect((yield* HttpClient.post(`/api/session/${parent}/task/${child}/cancel`)).status).toBe(204)
      if (outcome === "pending") {
        expect(
          (yield* post(`/api/session/${parent}/task/${child}/message`, {
            inputID: SessionMessage.ID.create(),
            text: "PENDING_CORRECTION",
            delivery: "queue",
          })).status,
        ).toBe(200)
        release.resolve()
      }
      yield* finished(parent, "PARENT_DONE")
      const events = yield* fixture.read
      expect(events.filter((event) => event.hook_event_name === "SubagentStart")).toHaveLength(1)
      const stops = events.filter((event) => event.hook_event_name === "SubagentStop")
      expect(stops).toHaveLength(outcome === "pending" ? 1 : 0)
      if (outcome === "pending") expect(stops[0].last_assistant_message).toBe("AFTER_PENDING")
      expect((yield* detail(parent, child)).status).toBe(
        outcome === "pending" ? "completed" : outcome === "cancel" ? "cancelled" : "failed",
      )
      expect(yield* llm.calls).toBe(outcome === "pending" ? 4 : 3)
    }),
  )
