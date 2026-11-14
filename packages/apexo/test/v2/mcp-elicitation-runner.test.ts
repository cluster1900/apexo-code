import { expect } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { ConfigProvider, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { SessionScheduleStore } from "@apexo/core/session/schedule-store"
import { SessionScheduleOwner } from "@apexo/core/session/schedule-owner"
import { SessionEvent } from "@apexo/core/session/event"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { SessionInputExecution } from "@apexo/core/session/input-execution"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { McpElicitation } from "@apexo/core/mcp-elicitation"
import { McpTools } from "@apexo/core/mcp-tools"
import { PermissionV2 } from "@apexo/core/permission"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
const setup = Effect.gen(function* () {
  const root = yield* tmpdirScoped()
  const llm = yield* TestLLMServer
  yield* Effect.promise(async () => {
    await mkdir(path.join(root, "data"), { recursive: true })
    await Bun.write(
      path.join(root, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        task: { maxDepth: 2 },
        compaction: { auto: false },
        agents: {
          manual: { mode: "primary", permissions: [{ action: "*", resource: "*", effect: "ask" }] },
          operator: { mode: "primary", permissions: [{ action: "*", resource: "*", effect: "allow" }] },
          worker: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] },
        },
        mcp: {
          servers: {
            forms: {
              type: "local",
              command: [process.execPath, path.join(import.meta.dir, "../fixture/mcp-forms-stdio.ts")],
              defer_tools: false,
            },
          },
        },
        providers: {
          test: {
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url, settings: { apiKey: "fixture" } },
            models: {
              fixture: {
                name: "Fixture",
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 100000, output: 4096 },
              },
            },
          },
        },
      }),
    )
  })
  return {
    root,
    llm,
    create: {
      location: { directory: AbsolutePath.make(root) },
      model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("fixture") },
    },
    app: AppNodeBuilder.build(
      LayerNode.group([
        SessionV2.node,
        SessionExecutionLocal.node,
        LocationServiceMap.node,
        SessionTaskStore.node,
        SessionInputExecution.node,
        SessionScheduleStore.node,
        SessionScheduleOwner.node,
      ]),
      [
        [SessionExecution.node, SessionExecutionLocal.node],
        [
          Global.node,
          Layer.succeed(Global.Service)(
            Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
          ),
        ],
      ],
    ).pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            APEXO_RUNTIME_PROFILE: "grok-build",
            APEXO_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true",
          }),
        ),
      ),
    ),
  }
})

it.live(
  "native runner prompts with manual and auto-accepted permissions but rejects both headless policies",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        for (const mode of ["manual", "operator", "reject", "approve_once"] as const) {
          const session = yield* sessions.create({
            ...f.create,
            agent: AgentV2.ID.make(mode === "manual" ? "manual" : "operator"),
          })
          yield* f.llm.tool(McpTools.name("forms", "collect"), { mode: "form" })
          yield* f.llm.text("FORM_SETTLED")
          yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "collect options" },
            ...(mode === "reject" || mode === "approve_once"
              ? { executionPolicy: { mode: "headless" as const, permissions: mode } }
              : {}),
          })
          if (mode === "manual" || mode === "operator") {
            yield* Effect.gen(function* () {
              const permissions = yield* PermissionV2.Service
              const forms = yield* McpElicitation.Service
              if (mode === "manual") {
                const request = yield* pollWithTimeout(
                  permissions.list().pipe(Effect.map((items) => items[0])),
                  "manual permission",
                )
                yield* permissions.reply({ requestID: request.id, reply: "once" })
              }
              const request = yield* pollWithTimeout(
                forms.list(session.id).pipe(Effect.map((items) => items[0])),
                "runner-owned form",
              )
              yield* forms.reply(session.id, request.id, { action: "decline" })
            }).pipe(Effect.provide(locations.get(session.location)))
          }
          yield* sessions.wait(session.id)
          const tools = (yield* sessions.messages({ sessionID: session.id, order: "asc" })).flatMap((message) =>
            message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
          )
          expect(tools).toHaveLength(1)
          expect(tools[0].state.status).toBe(mode === "manual" || mode === "operator" ? "completed" : "error")
          expect(
            yield* McpElicitation.Service.use((forms) => forms.list(session.id)).pipe(
              Effect.provide(locations.get(session.location)),
            ),
          ).toEqual([])
        }
      }).pipe(Effect.provide(f.app))
    }),
  30000,
)

it.live(
  "native headless descendants cannot restore MCP form eligibility",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const outcomes = yield* SessionInputExecution.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ ...f.create, agent: AgentV2.ID.make("operator") })
        yield* f.llm.tool("task", { description: "Collect choices", prompt: "collect", subagent_type: "worker" })
        yield* f.llm.tool(McpTools.name("forms", "collect"), { mode: "form" })
        yield* f.llm.text("CHILD_SETTLED")
        yield* f.llm.text("PARENT_SETTLED")
        yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "delegate" },
          executionPolicy: { mode: "headless", permissions: "approve_once" },
        })
        yield* sessions.wait(session.id)
        const child = (yield* sessions.list()).find((item) => item.parentID === session.id)!
        expect(child).toBeDefined()
        expect(
          (yield* sessions.history({ sessionID: child.id, limit: 100 })).events
            .filter((event) => event.type === SessionEvent.PromptAdmitted.type)
            .map((event) => event.data.origin),
        ).toEqual(["task"])
        expect((yield* outcomes.selected(child.id))?.policy.mode).toBe("headless")
        const tools = (yield* sessions.messages({ sessionID: child.id, order: "asc" })).flatMap((message) =>
          message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
        )
        expect(tools[0]?.state.status).toBe("error")
        expect(
          yield* McpElicitation.Service.use((forms) => forms.list(child.id)).pipe(
            Effect.provide(locations.get(child.location)),
          ),
        ).toEqual([])
      }).pipe(Effect.provide(f.app))
    }),
  30000,
)

it.live(
  "verified scheduled native work cannot open an MCP form",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const schedules = yield* SessionScheduleStore.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ ...f.create, agent: AgentV2.ID.make("operator") })
        const schedule = yield* schedules.create({
          sessionID: session.id,
          messageID: SessionMessage.ID.create(),
          callID: "form-timer",
          request: { prompt: "SCHEDULED_COLLECT", intervalSeconds: 60, durable: true, fireImmediately: true },
          authority: {
            parentAgent: session.agent!,
            agent: AgentV2.ID.make("worker"),
            model: session.model!,
            authority: [],
          },
        })
        const scheduled = (hit: { body: Record<string, unknown> }) =>
          JSON.stringify(hit.body).includes("SCHEDULED_COLLECT")
        yield* f.llm.toolMatch(scheduled, McpTools.name("forms", "collect"), { mode: "form" })
        yield* f.llm.textMatch(scheduled, "SCHEDULED_SETTLED")
        yield* f.llm.text("PARENT_SETTLED")
        yield* f.llm.text("NOTICE_SETTLED")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "start timers" } })
        yield* pollWithTimeout(
          schedules
            .occurrences(schedule.record.id)
            .pipe(Effect.map((items) => (items[0]?.status === "completed" ? items[0] : undefined))),
          "scheduled form denial",
          "10 seconds",
        )
        const child = (yield* sessions.list()).find((item) => item.parentID === session.id)!
        expect(child).toBeDefined()
        expect(
          (yield* sessions.history({ sessionID: child.id, limit: 100 })).events
            .filter((event) => event.type === SessionEvent.PromptAdmitted.type)
            .map((event) => event.data.origin),
        ).toEqual(["schedule"])
        const tools = (yield* sessions.messages({ sessionID: child.id, order: "asc" })).flatMap((message) =>
          message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
        )
        expect(tools[0]?.state.status).toBe("error")
        expect(
          yield* McpElicitation.Service.use((forms) => forms.list(child.id)).pipe(
            Effect.provide(locations.get(child.location)),
          ),
        ).toEqual([])
        yield* sessions.interrupt(session.id)
      }).pipe(Effect.provide(f.app))
    }),
  30000,
)

it.live(
  "scheduled descendants inherit the private no-interaction evidence",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const schedules = yield* SessionScheduleStore.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ ...f.create, agent: AgentV2.ID.make("operator") })
        const schedule = yield* schedules.create({
          sessionID: session.id,
          messageID: SessionMessage.ID.create(),
          callID: "nested-form-timer",
          request: { prompt: "SCHEDULED_DELEGATE", intervalSeconds: 60, durable: true, fireImmediately: true },
          authority: {
            parentAgent: session.agent!,
            agent: AgentV2.ID.make("worker"),
            model: session.model!,
            authority: [],
          },
        })
        const scheduled = (hit: { body: Record<string, unknown> }) =>
          JSON.stringify(hit.body).includes("SCHEDULED_DELEGATE")
        const nested = (hit: { body: Record<string, unknown> }) => JSON.stringify(hit.body).includes("NESTED_COLLECT")
        yield* f.llm.toolMatch(scheduled, "task", {
          description: "Nested choices",
          prompt: "NESTED_COLLECT",
          subagent_type: "worker",
        })
        yield* f.llm.toolMatch(nested, McpTools.name("forms", "collect"), { mode: "form" })
        yield* f.llm.textMatch(nested, "NESTED_SETTLED")
        yield* f.llm.textMatch(scheduled, "SCHEDULED_SETTLED")
        yield* f.llm.text("PARENT_SETTLED")
        yield* f.llm.text("NOTICE_SETTLED")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "start timers" } })
        yield* pollWithTimeout(
          schedules
            .occurrences(schedule.record.id)
            .pipe(Effect.map((items) => (items[0]?.status === "completed" ? items[0] : undefined))),
          "scheduled descendant form denial",
          "10 seconds",
        )
        const children = (yield* sessions.list()).filter((item) => item.parentID)
        const child = children.find((item) => children.some((parent) => parent.id === item.parentID))!
        expect(child).toBeDefined()
        const tools = (yield* sessions.messages({ sessionID: child.id, order: "asc" })).flatMap((message) =>
          message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
        )
        expect(tools[0]?.state.status).toBe("error")
        expect(
          yield* McpElicitation.Service.use((forms) => forms.list(child.id)).pipe(
            Effect.provide(locations.get(child.location)),
          ),
        ).toEqual([])
        yield* sessions.interrupt(session.id)
      }).pipe(Effect.provide(f.app))
    }),
  30000,
)

it.live(
  "ordinary interactive child launches retain MCP form eligibility",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ ...f.create, agent: AgentV2.ID.make("operator") })
        yield* f.llm.tool("task", { description: "Interactive choices", prompt: "collect", subagent_type: "worker" })
        yield* f.llm.tool(McpTools.name("forms", "collect"), { mode: "form" })
        yield* f.llm.text("CHILD_SETTLED")
        yield* f.llm.text("PARENT_SETTLED")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "delegate" } })
        const child = yield* pollWithTimeout(
          sessions.list().pipe(Effect.map((items) => items.find((item) => item.parentID === session.id))),
          "interactive child",
        )
        yield* Effect.gen(function* () {
          const forms = yield* McpElicitation.Service
          const request = yield* pollWithTimeout(
            forms.list(child.id).pipe(Effect.map((items) => items[0])),
            "interactive child form",
          )
          yield* forms.reply(child.id, request.id, { action: "decline" })
        }).pipe(Effect.provide(locations.get(child.location)))
        yield* sessions.wait(session.id)
        const tools = (yield* sessions.messages({ sessionID: child.id, order: "asc" })).flatMap((message) =>
          message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
        )
        expect(tools[0]?.state.status).toBe("completed")
      }).pipe(Effect.provide(f.app))
    }),
  30000,
)
