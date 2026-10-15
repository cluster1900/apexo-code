import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Effect, Layer, Schedule, Schema } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { BackgroundJob } from "@apexo/core/background-job"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionStore } from "@apexo/core/session/store"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionProcessControl } from "@apexo/core/session/process-control"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const updates = (body: Record<string, unknown>) =>
  JSON.stringify(
    Schema.decodeUnknownSync(
      Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.optional(Schema.Unknown) })),
    )(body.messages).filter(
      (message) =>
        message.role === "user" && typeof message.content === "string" && message.content.startsWith("<system-update>"),
    ),
  )

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
for (const mode of [
  "idle",
  "active",
  "deny",
  "bash-deny",
  "external-deny",
  "sandbox",
  "stop",
  "wait",
  "cancel",
  "rearm",
] as const)
  it.live(
    `native Monitor ${mode} uses one coordinator and owned process lifecycle`,
    () =>
      Effect.gen(function* () {
        if (mode === "sandbox" && process.platform !== "darwin") return
        const home = yield* tmpdirScoped()
        const directory = yield* tmpdirScoped()
        const external = yield* tmpdirScoped()
        const denied = mode === "deny" || mode === "external-deny" || mode === "bash-deny"
        const llm = yield* TestLLMServer
        const active = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(() => active.resolve()))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              permissions: [
                { action: "*", resource: "*", effect: "allow" },
                ...(denied
                  ? [
                      {
                        action: mode === "deny" ? "monitor" : mode === "bash-deny" ? "bash" : "external_directory",
                        resource: "*",
                        effect: "deny",
                      },
                    ]
                  : []),
              ],
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
          const execution = yield* SessionExecution.Service
          const jobs = yield* BackgroundJob.Service
          const store = yield* SessionStore.Service
          const processes = yield* SessionProcessControl.Service
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            ...(mode === "sandbox" ? { commandSandbox: "workspace" as const } : {}),
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          yield* llm.respond(() =>
            reply()
              .tool("monitor", {
                command: `${mode === "sandbox" ? `printf ESCAPE > ${JSON.stringify(path.join(external, "escape"))}; ` : ""}echo $$ > started; while [ ! -f release ]; do sleep 0.02; done; printf 'EVENT😀\n'; printf 'ERROR中文\n' >&2; ${mode === "rearm" ? "while [ ! -f resume-check ]; do sleep 0.02; done; printf 'RESUME_ONLY\\n'; while [ ! -f user-gate ]; do sleep 0.02; done; printf 'FUTURE\\n'; " : ""}while [ ! -f finish ]; do sleep 0.02; done; printf TAIL`,
                ...(mode === "external-deny" ? { workdir: external } : {}),
                description: "Native Monitor",
                persistent: true,
              })
              .item(),
          )
          yield* llm.respond((hit) => {
            if (mode === "cancel" || mode === "wait") {
              const id = JSON.stringify(hit.body.messages).match(/proc_[A-Za-z0-9]{26}/)?.[0]
              expect(id).toBeDefined()
              return reply()
                .tool(mode === "cancel" ? "process_cancel" : "process_wait", { process_id: id, timeout_ms: 5000 })
                .item()
            }
            return mode === "active" || mode === "stop" || mode === "rearm"
              ? reply().text("ACTIVE_PARENT").wait(active.promise).stop().item()
              : reply().text("IDLE_PARENT").stop().item()
          })
          yield* llm.respond(() => reply().text("EVENT_ACK").stop().item())
          yield* llm.respond(() => reply().text("COMPLETION_ACK").stop().item())
          yield* llm.respond(() => reply().text("FUTURE_ACK").stop().item())
          yield* llm.respond(() => reply().text("FINAL_ACK").stop().item())
          yield* sessions.prompt({
            sessionID: parent.id,
            prompt: { text: "Watch the command events and report when it completes." },
          })
          yield* llm.wait(2).pipe(Effect.timeout("10 seconds"))
          if (denied || mode === "idle" || mode === "sandbox") yield* sessions.wait(parent.id)
          const listed = yield* processes.list(parent.id)
          if (denied) {
            expect(listed).toEqual([])
            expect(
              yield* Effect.promise(() =>
                Bun.file(path.join(mode === "external-deny" ? external : directory, "started")).exists(),
              ),
            ).toBe(false)
            expect(yield* llm.calls).toBe(2)
            return
          }
          expect(listed).toHaveLength(1)
          expect(listed[0].kind).toBe("monitor")
          expect(listed[0].monitor?.persistent).toBe(true)
          if (mode === "cancel") {
            yield* llm.wait(3).pipe(Effect.timeout("10 seconds"))
            yield* sessions.wait(parent.id)
            yield* jobs.wait({ id: listed[0].id })
            expect((yield* processes.output(parent.id, listed[0].id)).status).toBe("cancelled")
            expect(yield* llm.calls).toBe(3)
            return
          }
          if (mode === "stop" || mode === "rearm") {
            yield* execution.interrupt(parent.id)
            yield* sessions.wait(parent.id)
          }
          yield* Effect.promise(() => Bun.write(path.join(directory, "release"), "go"))
          yield* Effect.gen(function* () {
            if (!(yield* processes.output(parent.id, listed[0].id)).output.includes("EVENT😀"))
              return yield* Effect.fail("pending output")
          }).pipe(
            Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") }),
            Effect.timeout("5 seconds"),
            Effect.tapError(() =>
              Effect.gen(function* () {
                console.error(
                  "MONITOR_DIAGNOSTIC",
                  JSON.stringify({
                    receipt: yield* processes.output(parent.id, listed[0].id),
                    calls: yield* llm.calls,
                    model: JSON.stringify((yield* llm.hits).at(-1)?.body.messages),
                  }),
                )
              }),
            ),
          )
          if (mode === "rearm") {
            yield* Effect.sleep("250 millis")
            expect(yield* llm.calls).toBe(2)
            active.resolve()
            yield* execution.resume(parent.id)
            yield* sessions.wait(parent.id)
            expect(yield* llm.calls).toBe(3)
            yield* Effect.promise(() => Bun.write(path.join(directory, "resume-check"), "go"))
            yield* Effect.gen(function* () {
              if (!(yield* processes.output(parent.id, listed[0].id)).output.includes("RESUME_ONLY"))
                return yield* Effect.fail("pending resume output")
            }).pipe(Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") }))
            yield* Effect.sleep("250 millis")
            expect(yield* llm.calls).toBe(3)
            expect((yield* processes.wait(parent.id, listed[0].id, 0)).timedOut).toBe(true)
            yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Continue watching future events." } })
            yield* sessions.wait(parent.id)
            expect(yield* llm.calls).toBe(4)
            yield* Effect.promise(() => Bun.write(path.join(directory, "user-gate"), "go"))
            yield* llm.wait(5).pipe(Effect.timeout("10 seconds"))
            yield* sessions.wait(parent.id)
            const event = updates((yield* llm.hits)[4].body)
            expect(event).toContain("FUTURE")
            expect(event).not.toContain("RESUME_ONLY")
            expect(event).not.toContain("EVENT😀")
            yield* Effect.promise(() => Bun.write(path.join(directory, "finish"), "go"))
            yield* llm.wait(6).pipe(Effect.timeout("10 seconds"))
            yield* sessions.wait(parent.id)
            expect((yield* processes.output(parent.id, listed[0].id)).status).toBe("completed")
            expect((yield* store.context(parent.id)).filter((message) => message.type === "user")).toHaveLength(2)
            return
          }
          if (mode === "active") {
            expect(yield* llm.calls).toBe(2)
            active.resolve()
          }
          if (mode !== "stop" && mode !== "wait") {
            yield* llm.wait(3).pipe(Effect.timeout("10 seconds"))
            yield* sessions.wait(parent.id)
            const hit = updates((yield* llm.hits)[2].body)
            expect(hit).toContain("Live Monitor data follows")
            expect(hit).toContain("EVENT😀")
            expect(hit).toContain("ERROR中文")
          }
          yield* Effect.promise(() => Bun.write(path.join(directory, "finish"), "go"))
          const final = yield* processes.wait(parent.id, listed[0].id, 5000)
          expect(final.process.status).toBe("completed")
          expect(final.process.output).toContain("TAIL")
          if (mode === "stop") {
            yield* jobs.wait({ id: listed[0].id })
            expect(yield* llm.calls).toBe(2)
            active.resolve()
            return
          }
          yield* llm.wait(mode === "wait" ? 3 : 4).pipe(Effect.timeout("10 seconds"))
          yield* sessions.wait(parent.id)
          expect(yield* llm.calls).toBe(mode === "wait" ? 3 : 4)
          const hit = JSON.stringify((yield* llm.hits).at(-1)?.body)
          if (mode === "wait") expect(hit).not.toContain("Live Monitor data follows")
          else expect(hit).toContain("Background shell completion data follows")
          expect(hit).toContain("TAIL")
          expect((yield* store.context(parent.id)).filter((message) => message.type === "user")).toHaveLength(1)
          if (mode === "sandbox") {
            expect(final.process.output).not.toContain("APEXO_COMMAND_SANDBOX_")
            expect(yield* Effect.promise(() => Bun.file(path.join(external, "escape")).exists())).toBe(false)
          }
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                SessionV2.node,
                BackgroundJob.node,
                SessionExecution.node,
                SessionStore.node,
                SessionExecutionLocal.node,
                SessionProcessControl.node,
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
