import { expect } from "bun:test"
import path from "node:path"
import { realpathSync } from "node:fs"
import { ConfigProvider, DateTime, Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { EventV2 } from "@apexo/core/event"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionEvent } from "@apexo/core/session/event"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionStore } from "@apexo/core/session/store"
import { SessionV1 } from "@apexo/core/v1/session"
import { WorkflowControl } from "@apexo/core/workflow/control"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
for (const change of ["source-tighten", "source-relax", "parent-deny", "source-revision"] as const)
  it.live(
    `Task resume rejects ${change} at the actual child Created boundary`,
    () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const directory = yield* tmpdirScoped()
        const llm = yield* TestLLMServer
        const secret = path.join(realpathSync(directory), "secret.txt")
        yield* Effect.promise(() => Bun.write(secret, "SOURCE_LOCAL_SECRET"))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              agents: { helper: { mode: "subagent" } },
              providers: {
                fixture: {
                  api: {
                    type: "aisdk",
                    package: "@ai-sdk/openai-compatible",
                    url: llm.url,
                    settings: { apiKey: "test" },
                  },
                  models: {
                    model: {
                      capabilities: { tools: true, input: ["text"], output: ["text"] },
                      limit: { context: 100000, output: 4096 },
                    },
                  },
                },
              },
            }),
          ),
        )
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const store = yield* SessionStore.Service
          const control = yield* WorkflowControl.Service
          const events = yield* EventV2.Service
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          yield* llm.respond(() => reply().text("SOURCE_COMPLETE").stop().item())
          const first = yield* control.start(parent.id, {
            source: {
              type: "script",
              name: "source",
              script: 'complete(agent("SOURCE_INPUT",#{agent_type:"helper"}));',
            },
          })
          const source = yield* pollWithTimeout(
            control.get(parent.id, first.id).pipe(Effect.map((run) => (run.status === "completed" ? run : undefined))),
            "Source did not complete",
            "10 seconds",
          )
          yield* sessions.wait(parent.id)
          if (change === "source-relax")
            yield* store.setPermissions({
              sessionID: source.children[0],
              permissions: [{ permission: "read", pattern: "secret.txt", action: "deny" }],
            })
          const observed: (typeof parent.id)[] = []
          const unsubscribe = yield* events.listen((event) =>
            Effect.gen(function* () {
              if (event.type !== SessionV1.Event.Created.type) return
              const data = yield* Schema.decodeUnknownEffect(Schema.toType(SessionV1.Event.Created.data))(
                event.data,
              ).pipe(Effect.orDie)
              if (data.info.parentID !== parent.id) return
              observed.push(data.sessionID)
              if (change === "source-revision") {
                yield* events.publish(SessionEvent.Synthetic, {
                  sessionID: source.children[0],
                  timestamp: yield* DateTime.now,
                  messageID: SessionMessage.ID.create(),
                  text: "LATE_SOURCE_HISTORY",
                })
                return
              }
              yield* store.setPermissions({
                sessionID: change === "parent-deny" ? parent.id : source.children[0],
                permissions: [
                  {
                    permission: change === "parent-deny" ? "task" : "read",
                    pattern: change === "parent-deny" ? "helper" : "secret.txt",
                    action: change === "source-relax" ? "allow" : "deny",
                  },
                ],
              })
            }),
          )
          yield* Effect.addFinalizer(() => unsubscribe)
          const requests: Record<string, unknown>[] = []
          yield* llm.respond(() =>
            reply()
              .tool("task", {
                description: "Boundary resume",
                prompt: "NO_CHILD_PROVIDER",
                subagent_type: "helper",
                resume_from: source.children[0],
              })
              .item(),
          )
          yield* llm.respond((hit) => {
            requests.push(hit.body)
            return reply().text("PARENT_REJECTED_RESUME").stop().item()
          })
          yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Resume the source" } })
          yield* sessions.wait(parent.id)
          expect(observed).toHaveLength(1)
          expect(requests).toHaveLength(1)
          const requestMessages = Schema.decodeUnknownSync(
            Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
          )(requests[0].messages)
          expect(
            requestMessages.filter((message) => message.role === "user").map((message) => message.content),
          ).toEqual(["Resume the source"])
          const parentHistory = yield* sessions.messages({ sessionID: parent.id, order: "asc" })
          const tools = parentHistory.flatMap((message) =>
            message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
          )
          expect(tools).toHaveLength(1)
          expect(tools[0].state.status).toBe("error")
          expect(yield* llm.calls).toBe(3)
          expect(yield* sessions.messages({ sessionID: observed[0], order: "asc" })).toEqual([])
          yield* llm.respond(() =>
            reply()
              .tool("task", {
                description: "Retry interrupted import",
                prompt: "MISSING_IMPORT_MUST_NOT_RUN",
                subagent_type: "helper",
                task_id: observed[0],
              })
              .item(),
          )
          yield* llm.respond((hit) => {
            requests.push(hit.body)
            return reply().text("RETRY_REJECTED").stop().item()
          })
          yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Retry the unimported child" } })
          yield* sessions.wait(parent.id)
          expect(yield* llm.calls).toBe(5)
          const retryMessages = Schema.decodeUnknownSync(
            Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
          )(requests[1].messages)
          expect(retryMessages.filter((message) => message.role === "user").map((message) => message.content)).toEqual([
            "Resume the source",
            "Retry the unimported child",
          ])
          expect(yield* sessions.messages({ sessionID: observed[0], order: "asc" })).toEqual([])
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                SessionV2.node,
                SessionStore.node,
                WorkflowControl.node,
                SessionExecutionLocal.node,
                EventV2.node,
              ]),
              [
                [SessionExecution.node, SessionExecutionLocal.node],
                [Global.node, Global.layerWith({ home })],
                [
                  ModelsDev.node,
                  Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void }),
                ],
              ],
            ).pipe(
              Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
            ),
          ),
        )
      }),
    30000,
  )
