import { ApplicationTools } from "@apexo/core/tool/application-tools"
import { Tool } from "@apexo/core/tool/tool"
import { expect } from "bun:test"
import { Task } from "@apexo/schema/task"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { SessionRunner } from "@apexo/core/session/runner"
import { SessionMessage } from "@apexo/core/session/message"
import path from "node:path"
import { eq } from "drizzle-orm"
import { ConfigProvider, Deferred, Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { EventV2 } from "@apexo/core/event"
import { EventTable, EventSequenceTable } from "@apexo/core/event/sql"
import { SessionV1 } from "@apexo/core/v1/session"
import { SessionCommandSandbox } from "@apexo/core/session/command-sandbox"
import { SessionCommandSandboxTable } from "@apexo/core/session/command-sandbox.sql"
import { SessionTable } from "@apexo/core/session/sql"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionInputTable } from "@apexo/core/session/sql"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
it.live(
  "native Task ownership is committed before Created observers can admit a child prompt",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      const llm = yield* TestLLMServer
      yield* Effect.promise(() =>
        Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            agents: { helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
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
                    name: "Fixture",
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
        const application = yield* ApplicationTools.Service
        const children = Deferred.makeUnsafe<SessionRunner.Children>()
        yield* application.register({
          capture_children: Tool.make({
            description: "Capture the actual parent runner capability for exact receipt replay testing",
            input: Schema.Struct({}),
            output: Schema.String,
            execute: () =>
              Effect.gen(function* () {
                const capability = yield* SessionRunner.CurrentChildren
                if (!capability) return yield* Effect.die("Native parent child capability missing")
                yield* Deferred.succeed(children, capability)
                return "Captured"
              }),
          }),
        })
        const events = yield* EventV2.Service
        const tasks = yield* SessionTaskStore.Service
        const sandbox = yield* SessionCommandSandbox.Service
        const execution = yield* SessionExecution.Service
        const locations = yield* LocationServiceMap.Service
        const database = yield* Database.Service
        const parent = yield* sessions.create({
          location: { directory: AbsolutePath.make(directory) },
          agent: AgentV2.ID.make("build"),
          model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
        })
        const observed = Deferred.makeUnsafe<SessionSchema.ID>()
        const release = Deferred.makeUnsafe<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        const unsubscribe = yield* events.listen((event) =>
          Effect.gen(function* () {
            if (event.type !== "session.created") return
            const data = yield* Schema.decodeUnknownEffect(
              Schema.Struct({
                sessionID: SessionSchema.ID,
                info: Schema.Struct({ parentID: Schema.optional(SessionSchema.ID) }),
              }),
            )(event.data).pipe(Effect.orDie)
            if (data.info.parentID !== parent.id) return
            yield* Deferred.succeed(observed, data.sessionID)
            yield* Deferred.await(release)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        yield* llm.respond(() => reply().tool("capture_children", {}).item())
        yield* llm.respond(() =>
          reply()
            .tool("task", { description: "Atomic ownership", prompt: "OWNED_CHILD_INPUT", subagent_type: "helper" })
            .item(),
        )
        yield* llm.respond((hit) => {
          expect(JSON.stringify(hit.body.messages)).toContain("OWNED_CHILD_INPUT")
          expect(JSON.stringify(hit.body.messages)).not.toContain("UNOWNED_INJECTION")
          return reply().text("CHILD_DONE").stop().item()
        })
        yield* llm.respond(() => reply().text("PARENT_DONE").stop().item())
        yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Run the child" } })
        const childID = yield* Deferred.await(observed).pipe(Effect.timeout("10 seconds"))
        // A separate caller sees Created while its publisher is still held in notification.
        const visible = yield* tasks.read(childID)
        const externalResume = yield* sessions.resume(childID).pipe(Effect.result)
        expect(externalResume._tag).toBe("Failure")
        if (externalResume._tag === "Failure") expect(externalResume.failure._tag).toBe("SessionManagedChildFailure")
        yield* execution.wake(childID)
        expect((yield* execution.active).has(childID)).toBe(false)
        expect(yield* llm.calls).toBe(2)
        const admission = yield* sessions
          .prompt({ sessionID: childID, prompt: { text: "UNOWNED_INJECTION" }, resume: false })
          .pipe(Effect.result)
        const inbox = yield* database.db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, childID))
        yield* Deferred.succeed(release, undefined)
        yield* sessions.wait(parent.id)
        expect({ owner: visible?.sessionID, admission: admission._tag, inbox: inbox.length }).toEqual({
          owner: childID,
          admission: "Failure",
          inbox: 0,
        })
        if (admission._tag === "Failure") expect(admission.failure._tag).toBe("Session.ManagedInputError")
        expect(inbox).toHaveLength(0)
        expect(
          (yield* sessions.messages({ sessionID: childID }))
            .filter((message) => message.type === "user")
            .map((message) => message.text),
        ).toEqual(["OWNED_CHILD_INPUT"])
        expect(yield* llm.calls).toBe(4)
        expect((yield* execution.resume(childID).pipe(Effect.result))._tag).toBe("Failure")
        yield* execution.wake(childID)
        expect((yield* execution.active).has(childID)).toBe(false)
        expect(yield* llm.calls).toBe(4)
        const created = yield* database.db
          .select()
          .from(EventTable)
          .where(eq(EventTable.id, EventV2.ID.make(visible!.childCreated)))
          .get()
        const original = yield* Schema.decodeUnknownEffect(SessionV1.Event.Created.data)(created!.data)
        for (const phase of ["ownership", "after_commit"]) {
          const rejectedID = SessionSchema.ID.create()
          const publication = yield* sandbox.prepareChild(yield* sandbox.capture(parent.id), rejectedID)
          const rejected = yield* events
            .publish(
              SessionV1.Event.Created,
              {
                sessionID: rejectedID,
                info: { ...original.info, id: rejectedID },
              },
              {
                id: publication.eventID,
                location: parent.location,
                commit: () =>
                  publication.commit.pipe(
                    Effect.andThen(
                      tasks.commitCreated({
                        ...visible!,
                        sessionID: rejectedID,
                        childCreated: publication.eventID,
                        parentCreated: phase === "ownership" ? "wrong-parent-proof" : visible!.parentCreated,
                      }),
                    ),
                    Effect.andThen(
                      phase === "after_commit"
                        ? Effect.fail(new Error("Deliberate publication rollback"))
                        : Effect.void,
                    ),
                    Effect.orDie,
                  ),
              },
            )
            .pipe(Effect.exit)
          expect(rejected._tag).toBe("Failure")
          expect(yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, rejectedID))).toEqual([])
          expect(yield* tasks.read(rejectedID)).toBeUndefined()
          expect(
            yield* database.db
              .select()
              .from(SessionCommandSandboxTable)
              .where(eq(SessionCommandSandboxTable.session_id, rejectedID)),
          ).toEqual([])
          expect(yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, rejectedID))).toEqual(
            [],
          )
          expect(
            yield* database.db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, rejectedID)),
          ).toEqual([])
        }
        yield* llm.text("EXACT_RECEIPT_A")
        yield* llm.text("LATEST_RECEIPT_B")
        yield* Effect.gen(function* () {
          const tools = yield* ToolRegistry.Service
          const registry = yield* tools.materialize()
          const input = {
            sessionID: parent.id,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.create(),
            call: {
              type: "tool-call" as const,
              id: "exact-A",
              name: "task",
              input: { description: "Receipt A", prompt: "Return receipt A", subagent_type: "helper" },
            },
          }
          const first = yield* Schema.decodeUnknownEffect(Task.Detail)(
            (yield* registry.settle(input)).output?.structured,
          )
          expect(first.output).toBe("EXACT_RECEIPT_A")
          const second = yield* Schema.decodeUnknownEffect(Task.Detail)(
            (yield* registry.settle({
              ...input,
              assistantMessageID: SessionMessage.ID.create(),
              call: {
                ...input.call,
                id: "exact-B",
                input: { ...input.call.input, description: "Receipt B", prompt: "Return receipt B", task_id: first.id },
              },
            })).output?.structured,
          )
          expect(second.id).toBe(first.id)
          expect(second.output).toBe("LATEST_RECEIPT_B")
          const retry = yield* Schema.decodeUnknownEffect(Task.Detail)(
            (yield* registry.settle(input)).output?.structured,
          )
          expect(retry).toEqual(first)
          const latest = yield* Schema.decodeUnknownEffect(Task.Detail)(
            (yield* registry.settle({
              ...input,
              call: { type: "tool-call", id: "read-latest", name: "task_output", input: { task_id: first.id } },
            })).output?.structured,
          )
          expect(latest).toEqual(second)
          expect(yield* llm.calls).toBe(6)
        }).pipe(
          Effect.provide(locations.get(parent.location)),
          Effect.provideService(SessionRunner.CurrentChildren, yield* Deferred.await(children)),
        )
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([
              SessionV2.node,
              ApplicationTools.node,
              SessionExecutionLocal.node,
              EventV2.node,
              Database.node,
              SessionTaskStore.node,
              SessionCommandSandbox.node,
              LocationServiceMap.node,
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
