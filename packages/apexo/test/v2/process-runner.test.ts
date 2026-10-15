import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Effect, Layer } from "effect"
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

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
for (const mode of ["idle", "active", "deny", "external-deny", "sandbox", "stop", "wait", "cancel"] as const)
  it.live(
    `native shell ${mode} follows ordinary coordinator ownership without fabricated prompts`,
    () =>
      Effect.gen(function* () {
        if (mode === "sandbox" && process.platform !== "darwin") return
        const home = yield* tmpdirScoped()
        const directory = yield* tmpdirScoped()
        const external = yield* tmpdirScoped()
        const denied = mode === "deny" || mode === "external-deny"
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
                  ? [{ action: mode === "deny" ? "bash" : "external_directory", resource: "*", effect: "deny" }]
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
              .tool("bash", {
                command: `${mode === "sandbox" ? `printf ESCAPE > ${JSON.stringify(path.join(external, "escape"))}; ` : ""}echo $$ > started; printf 'BEGIN😀'; while [ ! -f release ]; do sleep 0.02; done; printf END`,
                ...(mode === "external-deny" ? { workdir: external } : {}),
                description: "Native background shell",
                background: true,
              })
              .item(),
          )
          yield* llm.respond((hit) => {
            if (mode === "wait" || mode === "cancel") {
              const id = JSON.stringify(hit.body.messages).match(/proc_[A-Za-z0-9]{26}/)?.[0]
              expect(id).toBeDefined()
              return reply()
                .tool(mode === "wait" ? "process_wait" : "process_cancel", { process_id: id, timeout_ms: 5000 })
                .item()
            }
            return mode === "active" || mode === "stop"
              ? reply().text("ACTIVE_PARENT").wait(active.promise).stop().item()
              : reply().text("PARENT_IDLE").stop().item()
          })
          yield* llm.respond(() => reply().text("COMPLETION_ACKNOWLEDGED").stop().item())
          yield* sessions.prompt({
            sessionID: parent.id,
            prompt: { text: "Run the owned background shell and summarize its result when ready." },
          })
          yield* llm.wait(2).pipe(Effect.timeout("10 seconds"))
          if (mode === "idle" || mode === "sandbox" || denied) yield* sessions.wait(parent.id)
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
          expect(listed[0].background).toBe(true)
          if (mode === "cancel") {
            yield* llm.wait(3).pipe(Effect.timeout("10 seconds"))
            yield* sessions.wait(parent.id)
            yield* jobs.wait({ id: listed[0].id })
            expect((yield* processes.output(parent.id, listed[0].id)).status).toBe("cancelled")
            expect(yield* llm.calls).toBe(3)
            expect(JSON.stringify((yield* llm.hits)[2].body)).not.toContain("Background shell completion data follows")
            return
          }
          if (mode === "stop") {
            yield* execution.interrupt(parent.id)
            yield* sessions.wait(parent.id)
          }
          expect(listed[0].status).toBe("running")
          expect((yield* processes.wait(parent.id, listed[0].id, 0)).timedOut).toBe(true)
          expect(yield* llm.calls).toBe(2)
          yield* Effect.promise(() => Bun.write(path.join(directory, "release"), "ready"))
          const receipt = yield* processes.wait(parent.id, listed[0].id, 5000)
          expect(receipt.process.status).toBe("completed")
          if (mode === "sandbox") {
            expect(receipt.process.output).toContain("BEGIN😀")
            expect(receipt.process.output).toContain("END")
            expect(receipt.process.output).not.toContain("APEXO_COMMAND_SANDBOX_")
            expect(yield* Effect.promise(() => Bun.file(path.join(external, "escape")).exists())).toBe(false)
          } else expect(receipt.process.output).toBe("BEGIN😀END")
          if (mode === "stop") {
            yield* jobs.wait({ id: listed[0].id })
            expect(yield* llm.calls).toBe(2)
            active.resolve()
            return
          }
          if (mode === "active") {
            expect(yield* llm.calls).toBe(2)
            active.resolve()
          }
          yield* llm.wait(3).pipe(Effect.timeout("10 seconds"))
          yield* sessions.wait(parent.id)
          expect(yield* llm.calls).toBe(3)
          const hits = yield* llm.hits
          if (mode === "wait")
            expect(JSON.stringify(hits[2].body)).not.toContain("Background shell completion data follows")
          else expect(JSON.stringify(hits[2].body)).toContain("Background shell completion data follows")
          expect(JSON.stringify(hits[2].body)).toContain(mode === "sandbox" ? "BEGIN😀" : "BEGIN😀END")
          const history = yield* store.context(parent.id)
          expect(history.filter((message) => message.type === "user")).toHaveLength(1)
          expect(history.filter((message) => message.type === "assistant").at(-1)?.content).toContainEqual(
            expect.objectContaining({ type: "text", text: "COMPLETION_ACKNOWLEDGED" }),
          )
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
