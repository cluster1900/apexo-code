import { expect } from "bun:test"
import path from "node:path"
import { realpathSync } from "node:fs"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
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
for (const change of ["tighten", "relax"] as const)
  it.live(
    `resumed Workflow child retains source-local ceiling when policy ${change}s at child Created`,
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
          if (change === "relax")
            yield* store.setPermissions({
              sessionID: source.children[0],
              permissions: [{ permission: "read", pattern: "secret.txt", action: "deny" }],
            })
          const observed: string[] = []
          const unsubscribe = yield* events.listen((event) =>
            Effect.gen(function* () {
              if (event.type !== SessionV1.Event.Created.type) return
              const data = yield* Schema.decodeUnknownEffect(Schema.toType(SessionV1.Event.Created.data))(
                event.data,
              ).pipe(Effect.orDie)
              if (data.info.parentID !== parent.id) return
              observed.push(data.sessionID)
              yield* store.setPermissions({
                sessionID: source.children[0],
                permissions: [
                  { permission: "read", pattern: "secret.txt", action: change === "tighten" ? "deny" : "allow" },
                ],
              })
            }),
          )
          yield* Effect.addFinalizer(() => unsubscribe)
          const requests: Record<string, unknown>[] = []
          yield* llm.respond((hit) => {
            requests.push(hit.body)
            return reply().tool("read", { filePath: secret }).item()
          })
          yield* llm.respond((hit) => {
            requests.push(hit.body)
            return reply().text("DENIAL_RETAINED").stop().item()
          })
          const second = yield* control.start(parent.id, {
            source: {
              type: "script",
              name: "source-denied",
              script: `complete(agent("TRY_SOURCE_SECRET",#{resume_from:"${source.children[0]}"}));`,
            },
          })
          const completed = yield* pollWithTimeout(
            control
              .get(parent.id, second.id)
              .pipe(Effect.map((run) => (["completed", "failed"].includes(run.status) ? run : undefined))),
            "Resumed child did not settle",
            "10 seconds",
          )
          yield* sessions.wait(parent.id)
          expect(completed.status).toBe("completed")
          expect(observed).toEqual(completed.children.map(String))
          expect(requests).toHaveLength(2)
          const messages = requests[1].messages as { role: string; content: unknown }[]
          const results = JSON.stringify(messages.filter((message) => message.role === "tool"))
          expect(results).toContain("Unable to read")
          expect(results).not.toContain("SOURCE_LOCAL_SECRET")
          expect(yield* llm.calls).toBe(3)
          expect(
            (yield* sessions.messages({ sessionID: source.children[0], order: "asc" }))
              .filter((message) => message.type === "user")
              .map((message) => message.text),
          ).toEqual(["SOURCE_INPUT"])
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
