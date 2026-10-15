import { ProjectCopy } from "@apexo/core/project/copy"
import { EventV2 } from "@apexo/core/event"
import { rm } from "node:fs/promises"
import { eq } from "drizzle-orm"
import { Database } from "@apexo/core/database/database"
import { SessionInputTable } from "@apexo/core/session/sql"
import { ProjectDirectories } from "@apexo/core/project/directories"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { expect } from "bun:test"
import path from "node:path"
import { realpathSync } from "node:fs"
import { ConfigProvider, Effect, Layer, Schema, Scope } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
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
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
for (const scenario of [
  "external-revoked",
  "follow-up-revoked",
  "allocation-rejected",
  "allocation-modified",
  "allocation-ignored",
] as const) {
  it.live(
    `Placement ${scenario} does not launch or retain an unowned copy`,
    () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const temporary = yield* tmpdirScoped()
        const directory = AbsolutePath.make(realpathSync(temporary))
        const alternate = yield* tmpdirScoped()
        const target = AbsolutePath.make(realpathSync(alternate))
        const llm = yield* TestLLMServer
        if (scenario.startsWith("allocation-")) {
          for (const args of [
            ["init"],
            [
              "-c",
              "user.name=Fixture",
              "-c",
              "user.email=fixture@example.test",
              "commit",
              "--allow-empty",
              "-m",
              "base",
            ],
          ])
            expect(Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], { cwd: directory }).exitCode).toBe(0)
        }
        const configuration = JSON.stringify({
          snapshots: false,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          agents: { helper: { mode: "subagent" } },
          providers: {
            fixture: {
              api: {
                type: "aisdk",
                package: "@ai-sdk/openai-compatible",
                url: llm.url,
                settings: { apiKey: "fixture" },
              },
              models: {
                model: {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
              },
            },
          },
        })
        yield* Effect.promise(() => Bun.write(path.join(directory, "apexo.json"), configuration))
        yield* Effect.promise(() => Bun.write(path.join(target, "apexo.json"), configuration))
        if (scenario === "allocation-ignored")
          yield* Effect.promise(() => Bun.write(path.join(directory, ".gitignore"), "outside-edit.txt\n"))
        yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const sessions = yield* SessionV2.Service
          const store = yield* SessionStore.Service
          const tasks = yield* SessionTaskStore.Service
          const events = yield* EventV2.Service
          const directories = yield* ProjectDirectories.Service
          const locations = yield* LocationServiceMap.Service
          const scope = yield* Scope.Scope
          const parent = yield* sessions.create({
            location: { directory },
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          if (scenario.startsWith("allocation-")) {
            yield* directories.create({ projectID: parent.projectID, directory })
            if (scenario === "allocation-modified" || scenario === "allocation-ignored") {
              const unsubscribe = yield* events.listen((event) =>
                Effect.gen(function* () {
                  if (event.type !== ProjectCopy.Event.Updated.type) return
                  for (const item of yield* directories.list(parent.projectID)) {
                    if (item.strategy === "git_worktree")
                      yield* Effect.promise(() =>
                        Bun.write(path.join(item.directory, "outside-edit.txt"), "PRESERVE_EXTERNAL_EDIT"),
                      )
                  }
                }),
              )
              yield* Effect.addFinalizer(() => unsubscribe)
            }
            yield* Effect.gen(function* () {
              const agents = yield* AgentV2.Service
              yield* agents.transform((draft) =>
                draft.update(AgentV2.ID.make("ephemeral"), (agent) => {
                  agent.mode = "subagent"
                  agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
                }),
              )
            }).pipe(Effect.provide(locations.get(parent.location)), Effect.provideService(Scope.Scope, scope))
            yield* llm.respond(() =>
              reply()
                .tool("task", {
                  description: "Reject target",
                  prompt: "NO_CHILD",
                  subagent_type: "ephemeral",
                  isolation: "worktree",
                })
                .item(),
            )
            yield* llm.respond(() => reply().text("PARENT_DONE").stop().item())
            yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Reject unavailable target agent" } })
            yield* sessions.wait(parent.id)
            expect(yield* llm.calls).toBe(2)
            expect(JSON.stringify(yield* sessions.messages({ sessionID: parent.id, order: "asc" }))).toContain(
              "Selected child agent is unavailable in its placement",
            )
            expect(yield* tasks.list(parent.id)).toHaveLength(0)
            const copies = (yield* directories.list(parent.projectID)).filter(
              (entry) => entry.strategy === "git_worktree",
            )
            expect(copies).toHaveLength(scenario === "allocation-modified" || scenario === "allocation-ignored" ? 1 : 0)
            if (scenario === "allocation-modified" || scenario === "allocation-ignored") {
              expect(
                yield* Effect.promise(() => Bun.file(path.join(copies[0].directory, "outside-edit.txt")).text()),
              ).toBe("PRESERVE_EXTERNAL_EDIT")
              yield* Effect.promise(() => rm(copies[0].directory, { recursive: true, force: true }))
            }
            return
          }
          yield* llm.respond(() =>
            reply()
              .tool("task", {
                description: "External source",
                prompt: "EXTERNAL_SOURCE",
                subagent_type: "helper",
                cwd: target,
              })
              .item(),
          )
          yield* llm.respond(() => reply().text("EXTERNAL_SOURCE_DONE").stop().item())
          yield* llm.respond(() => reply().text("PARENT_FIRST_DONE").stop().item())
          yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Make source" } })
          yield* sessions.wait(parent.id)
          const source = (yield* tasks.list(parent.id))[0]
          expect(source).toBeDefined()
          const inputs = yield* database.db
            .select()
            .from(SessionInputTable)
            .where(eq(SessionInputTable.session_id, source.sessionID))
            .all()
            .pipe(Effect.orDie)
          const original = yield* sessions.messages({ sessionID: source.sessionID, order: "asc" })
          yield* store.setPermissions({
            sessionID: parent.id,
            permissions: [{ permission: "external_directory", pattern: target, action: "deny" }],
          })
          yield* llm.respond(() =>
            reply()
              .tool("task", {
                description: "Revoked resume",
                prompt: "NO_RESUMED_PROVIDER",
                subagent_type: "helper",
                ...(scenario === "follow-up-revoked"
                  ? { task_id: source.sessionID }
                  : { resume_from: source.sessionID }),
              })
              .item(),
          )
          const requests: Record<string, unknown>[] = []
          yield* llm.respond((hit) => {
            requests.push(hit.body)
            return reply().text("EXPECTED_PARENT_REJECTION").stop().item()
          })
          yield* llm.respond(() => reply().text("UNEXPECTED_PARENT_AFTER_CHILD").stop().item())
          yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Resume denied external source" } })
          yield* sessions.wait(parent.id)
          const messages = Schema.decodeUnknownSync(
            Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
          )(requests[0].messages)
          expect(messages.filter((message) => message.role === "user").map((message) => message.content)).toEqual([
            "Make source",
            "Resume denied external source",
          ])
          expect(yield* llm.calls).toBe(5)
          expect(yield* tasks.list(parent.id)).toHaveLength(1)
          expect(yield* sessions.messages({ sessionID: source.sessionID, order: "asc" })).toEqual(original)
          expect(
            yield* database.db
              .select()
              .from(SessionInputTable)
              .where(eq(SessionInputTable.session_id, source.sessionID))
              .all()
              .pipe(Effect.orDie),
          ).toEqual(inputs)
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                EventV2.node,
                Database.node,
                SessionV2.node,
                SessionStore.node,
                SessionExecutionLocal.node,
                SessionTaskStore.node,
                ProjectDirectories.node,
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
}
