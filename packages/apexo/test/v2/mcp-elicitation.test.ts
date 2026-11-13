import { expect } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionMessage } from "@apexo/core/session/message"
import { AgentV2 } from "@apexo/core/agent"
import { MCP } from "@apexo/core/mcp"
import { McpElicitation } from "@apexo/core/mcp-elicitation"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const answers = { name: "selected", quantity: 3, ratio: 0.25, confirm: false, environment: "prod", regions: ["a", "b"] }
const setup = (
  server?:
    | { type: "remote"; url: string; oauth: false }
    | {
        type: "local"
        command: string[]
        elicitation?: false
        environment?: Record<string, string>
        timeout?: { request: number }
      },
) =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    yield* Effect.promise(async () => {
      await mkdir(path.join(root, "data"), { recursive: true })
      await Bun.write(
        path.join(root, "apexo.json"),
        JSON.stringify({
          snapshots: false,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          mcp: {
            servers: {
              forms: server ?? {
                type: "local",
                command: [process.execPath, path.join(import.meta.dir, "../fixture/mcp-forms-stdio.ts")],
                timeout: { request: 500 },
              },
            },
          },
        }),
      )
    })
    const app = AppNodeBuilder.build(
      LayerNode.group([SessionV2.node, SessionLifecycle.node, LocationServiceMap.node]),
      [
        [
          Global.node,
          Layer.succeed(Global.Service)(
            Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
          ),
        ],
        [SessionExecution.node, SessionExecution.noopLayer],
      ],
    )
    return { root, app }
  })

for (const stateful of [true, false]) {
  it.live(
    `real ${stateful ? "stateful" : "stateless"} stdio forms preserve typed replies, pause active time, and reject unarmed resource forms`,
    () =>
      Effect.gen(function* () {
        const f = yield* setup(
          stateful
            ? undefined
            : {
                type: "local",
                command: [process.execPath, path.join(import.meta.dir, "../fixture/mcp-forms-stdio.ts")],
                environment: { MCP_FORMS_STATELESS: "true" },
                timeout: { request: 500 },
              },
        )
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const locations = yield* LocationServiceMap.Service
          const lifecycle = yield* SessionLifecycle.Service
          const first = yield* sessions.create({ location: { directory: AbsolutePath.make(f.root) } })
          const second = yield* sessions.create({ location: first.location })
          yield* Effect.gen(function* () {
            const mcp = yield* MCP.Service
            const forms = yield* McpElicitation.Service
            const entry = (yield* mcp.toolCatalog).find((tool) => tool.name === "collect")!
            const call = (sessionID: typeof first.id, mode = "form") =>
              lifecycle
                .run(
                  sessionID,
                  entry.call(
                    { mode },
                    {
                      sessionID,
                      agent: AgentV2.ID.make("build"),
                      assistantMessageID: SessionMessage.ID.create(),
                      toolCallID: crypto.randomUUID(),
                    },
                  ),
                )
                .pipe(Effect.provideService(McpElicitation.Interactive, true))
            const run = yield* call(first.id).pipe(Effect.forkChild)
            const pending = yield* pollWithTimeout(
              forms.list(first.id).pipe(Effect.map((items) => items[0])),
              "first MCP form",
              "10 seconds",
            )
            expect(pending.server).toBe("forms")
            expect(yield* forms.list(second.id)).toEqual([])
            const wrongSession = yield* forms
              .reply(second.id, pending.id, { action: "accept", content: answers })
              .pipe(Effect.result)
            expect(wrongSession._tag).toBe("Failure")
            const invalid = yield* forms
              .reply(first.id, pending.id, { action: "accept", content: { ...answers, quantity: "3" } })
              .pipe(Effect.result)
            expect(invalid._tag).toBe("Failure")
            expect(yield* forms.list(first.id)).toHaveLength(1)
            const queued = yield* call(second.id, "normal").pipe(Effect.forkChild)
            const resource = yield* mcp.readResource("forms", "fixture://details").pipe(Effect.forkChild)
            // Deliberately exceed the old SDK tool timeout while a validated human form is pending.
            yield* Effect.sleep("700 millis")
            expect(yield* forms.list(first.id)).toHaveLength(1)
            yield* forms.reply(first.id, pending.id, { action: "accept", content: answers })
            yield* forms.reply(first.id, pending.id, { action: "accept", content: answers })
            const result = yield* Fiber.join(run)
            const text = result.content.find((part) => part.type === "text")
            expect(text && "text" in text ? JSON.parse(text.text) : undefined).toMatchObject({
              call: 1,
              replies: [{ action: "accept", content: answers }],
            })
            const next = yield* Fiber.join(queued)
            const nextText = next.content.find((part) => part.type === "text")
            expect(nextText && "text" in nextText ? JSON.parse(nextText.text) : undefined).toMatchObject({
              call: stateful ? 2 : 1,
            })
            expect(
              text && "text" in text && nextText && "text" in nextText
                ? JSON.parse(text.text).pid === JSON.parse(nextText.text).pid
                : false,
            ).toBe(true)
            expect((yield* Fiber.join(resource)).contents[0]).toMatchObject({ text: "UNARMED_REJECTED" })
            expect(yield* forms.list(first.id)).toEqual([])
            expect(yield* forms.list(second.id)).toEqual([])
          }).pipe(Effect.provide(locations.get(first.location)))
        }).pipe(Effect.provide(f.app))
      }),
    25000,
  )
}

it.live(
  "forms reject unattended calls and concurrent second forms, and decline/cancel remain explicit",
  () =>
    Effect.gen(function* () {
      const f = yield* setup()
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const lifecycle = yield* SessionLifecycle.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.root) } })
        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          const forms = yield* McpElicitation.Service
          const entry = (yield* mcp.toolCatalog).find((tool) => tool.name === "collect")!
          const call = (mode: string) =>
            lifecycle.run(
              session.id,
              entry.call(
                { mode },
                {
                  sessionID: session.id,
                  agent: AgentV2.ID.make("build"),
                  assistantMessageID: SessionMessage.ID.create(),
                  toolCallID: crypto.randomUUID(),
                },
              ),
            )
          const unattended = yield* call("form").pipe(Effect.result)
          expect(unattended._tag).toBe("Failure")
          expect(yield* forms.list(session.id)).toEqual([])
          for (const action of ["decline", "cancel"] as const) {
            const run = yield* call("form").pipe(
              Effect.provideService(McpElicitation.Interactive, true),
              Effect.forkChild,
            )
            const pending = yield* pollWithTimeout(
              forms.list(session.id).pipe(Effect.map((items) => items[0])),
              "explicit form action",
            )
            yield* forms.reply(session.id, pending.id, { action })
            const result = yield* Fiber.join(run)
            expect(result.content[0]).toMatchObject({
              type: "text",
              text: expect.stringContaining(`"action":"${action}"`),
            })
          }
          const serverCancelled = yield* call("server_cancel").pipe(
            Effect.provideService(McpElicitation.Interactive, true),
          )
          expect(serverCancelled.content[0]).toMatchObject({ text: "SERVER_CANCELLED" })
          expect(yield* forms.list(session.id)).toEqual([])
          const parallel = yield* call("parallel").pipe(
            Effect.provideService(McpElicitation.Interactive, true),
            Effect.forkChild,
          )
          const pending = yield* pollWithTimeout(
            forms.list(session.id).pipe(Effect.map((items) => items[0])),
            "parallel form",
          )
          expect(yield* forms.list(session.id)).toHaveLength(1)
          yield* forms.reply(session.id, pending.id, { action: "accept", content: answers })
          expect((yield* Fiber.join(parallel)).content[0]).toMatchObject({
            type: "text",
            text: expect.stringContaining('"replies":["fulfilled","rejected"]'),
          })
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(f.app))
    }),
  25000,
)

for (const stateful of [true, false]) {
  it.live(
    `StreamableHTTP ${stateful ? "stateful" : "sessionless"} forms return exact types and reuse the client`,
    () =>
      Effect.gen(function* () {
        const { WebStandardStreamableHTTPServerTransport } = yield* Effect.promise(
          () => import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"),
        )
        const { formServer, sessionlessFormServer } = yield* Effect.promise(() => import("../fixture/mcp-forms"))
        const peer = formServer()
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        })
        const endpoint = stateful ? transport : yield* Effect.promise(sessionlessFormServer)
        if (stateful) yield* Effect.promise(() => peer.connect(transport))
        const headers: (string | null)[] = []
        const responseHeaders: (string | null)[] = []
        const http = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              idleTimeout: 0,
              async fetch(request) {
                headers.push(request.headers.get("mcp-session-id"))
                const response = await endpoint.handleRequest(request)
                responseHeaders.push(response.headers.get("mcp-session-id"))
                return response
              },
            }),
          ),
          (http) =>
            Effect.promise(async () => {
              await http.stop(true)
              await peer.close()
              if (!stateful) await endpoint.close()
            }),
        )
        const f = yield* setup({ type: "remote", url: http.url.toString(), oauth: false })
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const locations = yield* LocationServiceMap.Service
          const lifecycle = yield* SessionLifecycle.Service
          const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.root) } })
          yield* Effect.gen(function* () {
            const mcp = yield* MCP.Service
            const forms = yield* McpElicitation.Service
            const tool = (yield* mcp.toolCatalog).find((entry) => entry.name === "collect")!
            const call = (mode: string) =>
              lifecycle
                .run(
                  session.id,
                  tool.call(
                    { mode },
                    {
                      sessionID: session.id,
                      agent: AgentV2.ID.make("build"),
                      assistantMessageID: SessionMessage.ID.create(),
                      toolCallID: crypto.randomUUID(),
                    },
                  ),
                )
                .pipe(Effect.provideService(McpElicitation.Interactive, true))
            const first = yield* call("normal")
            const run = yield* call("form").pipe(Effect.forkChild)
            const pending = yield* pollWithTimeout(
              forms.list(session.id).pipe(Effect.map((items) => items[0])),
              "HTTP form",
            )
            yield* forms.reply(session.id, pending.id, { action: "accept", content: answers })
            expect((yield* Fiber.join(run)).content[0]).toMatchObject({
              text: expect.stringContaining(JSON.stringify(answers)),
            })
            expect(first.content[0]).toMatchObject({ text: expect.stringContaining('"call":1') })
            expect((yield* call("normal")).content[0]).toMatchObject({
              text: expect.stringContaining(stateful ? '"call":3' : '"call":1'),
            })
            expect(headers.some(Boolean)).toBe(stateful)
            expect(responseHeaders.some(Boolean)).toBe(stateful)
            if (stateful) expect(new Set(headers.filter(Boolean)).size).toBe(1)
          }).pipe(Effect.provide(locations.get(session.location)))
        }).pipe(Effect.provide(f.app))
      }),
    25000,
  )
}

it.live(
  "queued interruption preserves the owner; active interruption retires queued dispatch and reconnect never replays",
  () =>
    Effect.gen(function* () {
      const f = yield* setup()
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const lifecycle = yield* SessionLifecycle.Service
        const first = yield* sessions.create({ location: { directory: AbsolutePath.make(f.root) } })
        const second = yield* sessions.create({ location: first.location })
        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          const forms = yield* McpElicitation.Service
          const tool = (yield* mcp.toolCatalog).find((entry) => entry.name === "collect")!
          const call = (sessionID: typeof first.id, mode: string) =>
            lifecycle
              .run(
                sessionID,
                tool.call(
                  { mode },
                  {
                    sessionID,
                    agent: AgentV2.ID.make("build"),
                    assistantMessageID: SessionMessage.ID.create(),
                    toolCallID: crypto.randomUUID(),
                  },
                ),
              )
              .pipe(Effect.provideService(McpElicitation.Interactive, true))
          const owner = yield* call(first.id, "form").pipe(Effect.forkChild)
          const pending = yield* pollWithTimeout(
            forms.list(first.id).pipe(Effect.map((items) => items[0])),
            "owned form",
          )
          const waiting = yield* call(second.id, "normal").pipe(Effect.forkChild)
          yield* Fiber.interrupt(waiting)
          expect(yield* forms.list(first.id)).toHaveLength(1)
          yield* forms.reply(first.id, pending.id, { action: "decline" })
          expect((yield* Fiber.join(owner)).content[0]).toMatchObject({ text: expect.stringContaining('"call":1') })
          expect((yield* call(second.id, "normal")).content[0]).toMatchObject({
            text: expect.stringContaining('"call":2'),
          })
          const active = yield* call(first.id, "form").pipe(Effect.forkChild)
          const stale = yield* pollWithTimeout(
            forms.list(first.id).pipe(Effect.map((items) => items[0])),
            "interrupted form",
          )
          const queued = yield* call(second.id, "normal").pipe(Effect.result, Effect.forkChild)
          yield* Fiber.interrupt(active)
          expect((yield* Fiber.join(queued))._tag).toBe("Failure")
          expect(yield* forms.list(first.id)).toEqual([])
          expect(
            (yield* forms.reply(first.id, stale.id, { action: "accept", content: answers }).pipe(Effect.result))._tag,
          ).toBe("Failure")
          yield* mcp.connect("forms")
          const fresh = (yield* mcp.toolCatalog).find((entry) => entry.name === "collect")!
          const result = yield* lifecycle.run(
            second.id,
            fresh.call(
              { mode: "normal" },
              {
                sessionID: second.id,
                agent: AgentV2.ID.make("build"),
                assistantMessageID: SessionMessage.ID.create(),
                toolCallID: crypto.randomUUID(),
              },
            ),
          )
          expect(result.content[0]).toMatchObject({ text: expect.stringContaining('"call":1') })
          expect(yield* forms.list(first.id)).toEqual([])
        }).pipe(Effect.provide(locations.get(first.location)))
      }).pipe(Effect.provide(f.app))
    }),
  25000,
)

it.live(
  "per-server elicitation opt-out does not admit a form",
  () =>
    Effect.gen(function* () {
      const f = yield* setup({
        type: "local",
        command: [process.execPath, path.join(import.meta.dir, "../fixture/mcp-forms-stdio.ts")],
        elicitation: false,
      })
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const lifecycle = yield* SessionLifecycle.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.root) } })
        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          const forms = yield* McpElicitation.Service
          const tool = (yield* mcp.toolCatalog).find((entry) => entry.name === "collect")!
          const result = yield* lifecycle
            .run(
              session.id,
              tool.call(
                { mode: "form" },
                {
                  sessionID: session.id,
                  agent: AgentV2.ID.make("build"),
                  assistantMessageID: SessionMessage.ID.create(),
                  toolCallID: crypto.randomUUID(),
                },
              ),
            )
            .pipe(Effect.provideService(McpElicitation.Interactive, true), Effect.result)
          expect(result._tag).toBe("Failure")
          expect(yield* forms.list(session.id)).toEqual([])
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(f.app))
    }),
  25000,
)

it.live(
  "SDK initialization, idle and retired-generation late forms cannot attach to a successor call",
  () =>
    Effect.gen(function* () {
      const f = yield* setup()
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const lifecycle = yield* SessionLifecycle.Service
        const first = yield* sessions.create({ location: { directory: AbsolutePath.make(f.root) } })
        const second = yield* sessions.create({ location: first.location })
        yield* Effect.gen(function* () {
          const { McpCall } = yield* Effect.promise(() => import("@apexo/core/mcp-call"))
          const { Client } = yield* Effect.promise(() => import("@modelcontextprotocol/sdk/client/index.js"))
          const { InMemoryTransport } = yield* Effect.promise(() => import("@modelcontextprotocol/sdk/inMemory.js"))
          const { ElicitRequestSchema } = yield* Effect.promise(() => import("@modelcontextprotocol/sdk/types.js"))
          const { FiberSet } = yield* Effect.promise(() => import("effect"))
          const { formServer } = yield* Effect.promise(() => import("../fixture/mcp-forms"))
          const forms = yield* McpElicitation.Service
          const makeCalls = yield* McpCall.make
          const runForm = yield* FiberSet.makeRuntimePromise<never, McpElicitation.Reply, McpElicitation.Failure>()
          const state = { generation: 0, closed: 0 }
          const probe = { message: "Unarmed probe", requestedSchema: { type: "object" as const, properties: {} } }
          const generations = yield* Effect.forEach([0, 1], (generation) =>
            Effect.gen(function* () {
              const client = new Client(
                { name: "generation-fixture", version: "1" },
                { capabilities: { elicitation: { form: {} } } },
              )
              const peer = formServer()
              const pair = InMemoryTransport.createLinkedPair()
              const calls = makeCalls({
                server: "generation",
                enabled: true,
                timeout: 3000,
                current: () => state.generation === generation,
                // Keep the test wire open to inject a packet already in flight when a real close occurs.
                close: async () => {
                  state.closed++
                },
                runForm: async (effect) => {
                  const reply = await runForm(effect)
                  return reply.action === "accept"
                    ? {
                        ...reply,
                        content: Object.fromEntries(
                          Object.entries(reply.content).map(([name, value]) => [
                            name,
                            typeof value === "object" ? [...value] : value,
                          ]),
                        ),
                      }
                    : reply
                },
              })
              client.setRequestHandler(ElicitRequestSchema, (request, extra) =>
                calls.handle(request.params, extra.signal),
              )
              const send = pair[0].send.bind(pair[0])
              const init = { sent: false, rejected: false }
              pair[0].send = async (message, options) => {
                if (!init.sent && "result" in message) {
                  init.sent = true
                  init.rejected = await peer.elicitInput(probe).then(
                    () => false,
                    () => true,
                  )
                }
                await send(message, options)
              }
              yield* Effect.addFinalizer(() =>
                Effect.promise(async () => {
                  await client.close()
                  await peer.close()
                }),
              )
              yield* Effect.promise(() => Promise.all([peer.connect(pair[0]), client.connect(pair[1])]))
              expect(init.rejected).toBe(true)
              expect(
                yield* Effect.promise(() =>
                  peer.elicitInput(probe).then(
                    () => false,
                    () => true,
                  ),
                ),
              ).toBe(true)
              return { client, peer, calls }
            }),
          )
          expect(yield* forms.list()).toEqual([])
          const call = (generation: number, sessionID: typeof first.id) =>
            lifecycle
              .run(
                sessionID,
                generations[generation].calls.tool(
                  {
                    sessionID,
                    agent: AgentV2.ID.make("build"),
                    assistantMessageID: SessionMessage.ID.create(),
                    toolCallID: crypto.randomUUID(),
                  },
                  (signal, timeout) =>
                    generations[generation].client.callTool(
                      { name: "collect", arguments: { mode: "form" } },
                      undefined,
                      { signal, timeout },
                    ),
                ),
              )
              .pipe(Effect.provideService(McpElicitation.Interactive, true))
          const old = yield* call(0, first.id).pipe(Effect.forkChild)
          yield* pollWithTimeout(forms.list(first.id).pipe(Effect.map((items) => items[0])), "old generation form")
          yield* Fiber.interrupt(old)
          expect(state.closed).toBe(1)
          expect(generations[0].calls.retired()).toBe(true)
          state.generation = 1
          const next = yield* call(1, second.id).pipe(Effect.forkChild)
          const pending = yield* pollWithTimeout(
            forms.list(second.id).pipe(Effect.map((items) => items[0])),
            "successor form",
          )
          expect(
            yield* Effect.promise(() =>
              generations[0].peer.elicitInput(probe).then(
                () => false,
                () => true,
              ),
            ),
          ).toBe(true)
          expect((yield* forms.list()).map((item) => item.id)).toEqual([pending.id])
          yield* forms.reply(second.id, pending.id, { action: "accept", content: answers })
          expect((yield* Fiber.join(next)).content[0]).toMatchObject({
            text: expect.stringContaining(JSON.stringify(answers)),
          })
          expect(yield* forms.list()).toEqual([])
        }).pipe(Effect.provide(locations.get(first.location)))
      }).pipe(Effect.provide(f.app))
    }),
  20000,
)

for (const limit of ["active", "human", "hard"] as const) {
  it.live(
    `real SDK ${limit} timeout retires the generation with no queued replay`,
    () =>
      Effect.gen(function* () {
        const f = yield* setup()
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const locations = yield* LocationServiceMap.Service
          const lifecycle = yield* SessionLifecycle.Service
          const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.root) } })
          yield* Effect.gen(function* () {
            const { McpCall } = yield* Effect.promise(() => import("@apexo/core/mcp-call"))
            const { Client } = yield* Effect.promise(() => import("@modelcontextprotocol/sdk/client/index.js"))
            const { InMemoryTransport } = yield* Effect.promise(() => import("@modelcontextprotocol/sdk/inMemory.js"))
            const { ElicitRequestSchema } = yield* Effect.promise(() => import("@modelcontextprotocol/sdk/types.js"))
            const { FiberSet } = yield* Effect.promise(() => import("effect"))
            const { formServer } = yield* Effect.promise(() => import("../fixture/mcp-forms"))
            const forms = yield* McpElicitation.Service
            const runForm = yield* FiberSet.makeRuntimePromise<never, McpElicitation.Reply, McpElicitation.Failure>()
            const client = new Client(
              { name: "budget-fixture", version: "1" },
              { capabilities: { elicitation: { form: {} } } },
            )
            const peer = formServer()
            const pair = InMemoryTransport.createLinkedPair()
            const makeCalls = yield* McpCall.make
            const calls = makeCalls({
              server: "budget",
              enabled: true,
              timeout: limit === "active" ? 400 : 2000,
              humanTimeout: limit === "human" ? 250 : 3000,
              hardTimeout: limit === "hard" ? 350 : 4000,
              current: () => true,
              close: () => client.close(),
              runForm: async (effect) => {
                const reply = await runForm(effect)
                return reply.action === "accept"
                  ? {
                      ...reply,
                      content: Object.fromEntries(
                        Object.entries(reply.content).map(([key, value]) => [
                          key,
                          typeof value === "object" ? [...value] : value,
                        ]),
                      ),
                    }
                  : reply
              },
            })
            client.setRequestHandler(ElicitRequestSchema, (request, extra) =>
              calls.handle(request.params, extra.signal),
            )
            yield* Effect.promise(() => Promise.all([peer.connect(pair[0]), client.connect(pair[1])]))
            yield* Effect.addFinalizer(() =>
              Effect.promise(async () => {
                await client.close()
                await peer.close()
              }),
            )
            const context = {
              sessionID: session.id,
              agent: AgentV2.ID.make("build"),
              assistantMessageID: SessionMessage.ID.create(),
              toolCallID: crypto.randomUUID(),
            }
            const run = yield* lifecycle
              .run(
                session.id,
                calls.tool(context, (signal, timeout) =>
                  client.callTool(
                    {
                      name: "collect",
                      arguments: limit === "active" ? { mode: "repeat", before: 100, after: 200 } : { mode: "form" },
                    },
                    undefined,
                    { signal, timeout, maxTotalTimeout: timeout, resetTimeoutOnProgress: false },
                  ),
                ),
              )
              .pipe(Effect.provideService(McpElicitation.Interactive, true), Effect.result, Effect.forkChild)
            const pending = yield* pollWithTimeout(
              forms.list(session.id).pipe(Effect.map((items) => items[0])),
              "budget form",
            )
            const queued = yield* calls
              .request((signal, timeout) => client.listTools(undefined, { signal, timeout }))
              .pipe(Effect.result, Effect.forkChild)
            if (limit === "active") {
              for (let index = 0; index < 2; index++) {
                const request =
                  index === 0
                    ? pending
                    : yield* pollWithTimeout(
                        forms.list(session.id).pipe(Effect.map((items) => items[0])),
                        "second budget form",
                      )
                yield* Effect.sleep("500 millis")
                expect(yield* forms.list(session.id)).toHaveLength(1)
                yield* forms.reply(session.id, request.id, { action: "accept", content: answers })
              }
            }
            expect((yield* Fiber.join(run))._tag).toBe("Failure")
            expect((yield* Fiber.join(queued))._tag).toBe("Failure")
            expect(calls.retired()).toBe(true)
            expect(yield* forms.list(session.id)).toEqual([])
          }).pipe(Effect.provide(locations.get(session.location)))
        }).pipe(Effect.provide(f.app))
      }),
    10000,
  )
}
