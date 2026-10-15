import { SessionV1 } from "@apexo/core/v1/session"
import { Goal } from "@apexo/schema/goal"
import { SessionGoalControl } from "@apexo/core/session/goal-control"
import { expect } from "bun:test"
import path from "node:path"
import { eq } from "drizzle-orm"
import { ConfigProvider, Deferred, Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
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
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionInputTable } from "@apexo/core/session/sql"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
const cases = [false, true]
cases.forEach((continuation) =>
  it.live(
    `native Goal review and summary children reject unrelated prompts${continuation ? " across verifier continuation" : ""}`,
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
              goal: { verifier_count: continuation ? 2 : 1 },
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              agents: {
                helper: {
                  mode: "subagent",
                  permissions: [{ action: "*", resource: "*", effect: "allow" }],
                },
              },
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
                      capabilities: {
                        tools: true,
                        input: ["text"],
                        output: ["text"],
                      },
                      limit: { context: 100000, output: 4096 },
                    },
                  },
                },
              },
            }),
          ),
        )
        yield* Effect.gen(function* () {
          const goals = yield* SessionGoalControl.Service
          const execution = yield* SessionExecution.Service
          const sessions = yield* SessionV2.Service
          const events = yield* EventV2.Service
          const database = yield* Database.Service
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            agent: AgentV2.ID.make("build"),
            model: {
              providerID: ProviderV2.ID.make("fixture"),
              id: ModelV2.ID.make("model"),
            },
          })
          const indexes = continuation ? [0, 1, 2, 3] : [0, 1, 2]
          const observed = indexes.map(() =>
            Deferred.makeUnsafe<{
              id: SessionSchema.ID
              title: string
              info: typeof SessionV1.SessionInfo.Type
            }>(),
          )
          const release = indexes.map(() => Deferred.makeUnsafe<void>())
          const count = { value: 0 }
          yield* Effect.addFinalizer(() => Effect.forEach(release, (gate) => Deferred.succeed(gate, undefined)))
          const unsubscribe = yield* events.listen((event) =>
            Effect.gen(function* () {
              if (event.type !== "session.created") return
              const data = yield* Schema.decodeUnknownEffect(Schema.toType(SessionV1.Event.Created.data))(
                event.data,
              ).pipe(Effect.orDie)
              if (data.info.parentID !== parent.id) return
              const index = count.value++
              if (!observed[index]) return yield* Effect.die("Unexpected Goal child")
              yield* Deferred.succeed(observed[index], {
                id: data.sessionID,
                title: data.info.title,
                info: data.info,
              })
              yield* Deferred.await(release[index])
            }),
          )
          yield* Effect.addFinalizer(() => unsubscribe)
          const report = (body: Record<string, unknown>, key: string) => {
            const text = JSON.stringify(body.messages)
            const messages = body.messages as { content: unknown }[]
            const source = messages
              .map((message) =>
                typeof message.content === "string" ? message.content : JSON.stringify(message.content),
              )
              .join("\n")
            const value = new RegExp(`${key}=("[^"\\n]+")`).exec(source)?.[1]
            if (!value) throw new Error(`Missing ${key}: ${text}`)
            return JSON.parse(value) as string
          }
          yield* llm.respond((hit) =>
            reply()
              .tool("goal_report_write", {
                path: report(hit.body, "PLAN_FILE"),
                content: "Inspect native execution and verify the result.",
              })
              .usage({ input: 1, output: 1 })
              .item(),
          )
          yield* llm.text("Plan complete", { usage: { input: 1, output: 1 } })
          yield* llm.text("The requested native inspection is complete.", {
            usage: { input: 1, output: 1 },
          })
          yield* llm.text(
            JSON.stringify({
              decision: "candidate_complete",
              evidence: "Worker completed the inspection",
              next_step: "Verify independently",
              blocker_key: "",
            }),
            { usage: { input: 1, output: 1 } },
          )
          yield* llm.respond((hit) =>
            reply()
              .tool("goal_report_write", {
                path: report(hit.body, "VERDICT_FILE"),
                content: JSON.stringify({
                  achieved: !continuation,
                  evidence: continuation ? "A required proof is still missing" : "Native result independently verified",
                  unmet: continuation ? ["Provide the missing proof"] : [],
                  confidence: "high",
                  blocking: "none",
                }),
              })
              .usage({ input: 1, output: 1 })
              .item(),
          )
          yield* llm.respond((hit) =>
            reply()
              .tool("goal_report_write", {
                path: report(hit.body, "DETAILS_FILE"),
                content: "The native worker fulfilled the objective.",
              })
              .usage({ input: 1, output: 1 })
              .item(),
          )
          yield* llm.text("Review complete", { usage: { input: 1, output: 1 } })
          if (continuation) {
            yield* llm.text("Additional proof is complete.", { usage: { input: 1, output: 1 } })
            yield* llm.text(
              JSON.stringify({
                decision: "candidate_complete",
                evidence: "Additional proof complete",
                next_step: "Verify independently",
                blocker_key: "",
              }),
              { usage: { input: 1, output: 1 } },
            )
            yield* Effect.forEach([0, 1], () =>
              Effect.gen(function* () {
                yield* llm.respond((hit) =>
                  reply()
                    .tool("goal_report_write", {
                      path: report(hit.body, "VERDICT_FILE"),
                      content: JSON.stringify({
                        achieved: true,
                        evidence: "Native result independently verified",
                        unmet: [],
                        confidence: "high",
                        blocking: "none",
                      }),
                    })
                    .usage({ input: 1, output: 1 })
                    .item(),
                )
                yield* llm.respond((hit) =>
                  reply()
                    .tool("goal_report_write", {
                      path: report(hit.body, "DETAILS_FILE"),
                      content: "The native worker fulfilled the objective.",
                    })
                    .usage({ input: 1, output: 1 })
                    .item(),
                )
                yield* llm.text("Review complete", { usage: { input: 1, output: 1 } })
              }),
            )
          }
          yield* llm.respond((hit) => {
            expect(hit.body.tools ?? []).toEqual([])
            return reply()
              .text("The native execution was independently verified.")
              .usage({ input: 1, output: 1 })
              .stop()
              .item()
          })
          const target = {
            sessionID: parent.id,
            goalID: Goal.ID.make("goal_admissionprobe"),
          }
          yield* goals.create(parent.id, {
            id: target.goalID,
            objective: "Inspect native execution and verify the result.",
          })
          yield* goals.start(target, {
            agent: AgentV2.ID.make("build"),
            model: {
              providerID: ProviderV2.ID.make("fixture"),
              id: ModelV2.ID.make("model"),
            },
          })
          const observations = yield* Effect.forEach(observed, (gate, index) =>
            Effect.gen(function* () {
              const child = yield* Deferred.await(gate).pipe(Effect.timeout("10 seconds"))
              const externalResume = yield* sessions.resume(child.id).pipe(Effect.result)
              expect(externalResume._tag).toBe("Failure")
              if (externalResume._tag === "Failure")
                expect(externalResume.failure._tag).toBe("SessionManagedChildFailure")
              const calls = yield* llm.calls
              yield* execution.wake(child.id)
              expect((yield* execution.active).has(child.id)).toBe(false)
              expect(yield* llm.calls).toBe(calls)
              const admission = yield* sessions
                .prompt({
                  sessionID: child.id,
                  prompt: { text: `UNOWNED_INJECTION_${index}` },
                  resume: false,
                })
                .pipe(Effect.result)
              const inbox = yield* database.db
                .select()
                .from(SessionInputTable)
                .where(eq(SessionInputTable.session_id, child.id))
              const result = {
                title: child.title,
                admission: admission._tag,
                inbox: inbox.length,
              }
              console.error("GOAL_CREATED_ADMISSION", JSON.stringify(result))
              yield* Deferred.succeed(release[index], undefined)
              return result
            }),
          )
          yield* sessions.wait(parent.id)
          const expired = yield* Effect.forEach(observed, (gate, index) =>
            Effect.gen(function* () {
              const child = yield* Deferred.await(gate)
              const admission = yield* sessions
                .prompt({
                  sessionID: child.id,
                  prompt: { text: `EXPIRED_ROLE_INJECTION_${index}` },
                  resume: false,
                })
                .pipe(Effect.result)
              const messages = yield* sessions.messages({ sessionID: child.id })
              return {
                admission: admission._tag,
                contaminated: messages.some(
                  (message) => message.type === "user" && message.text.startsWith("UNOWNED_INJECTION_"),
                ),
              }
            }),
          )
          if (continuation) {
            const previous = yield* Deferred.await(observed[1])
            const final = yield* goals.get(parent.id)
            expect(final?.verification?.results.find((result) => result.index === 0)?.sessionID).toBe(previous.id)
            expect(final?.verificationRounds).toBe(2)
          }
          yield* goals.clear(target)
          yield* goals.create(parent.id, {
            id: target.goalID,
            objective: "A distinct Goal lifetime using the same ID",
          })
          const reusedGoal = yield* Effect.forEach(observed, (gate) =>
            Effect.gen(function* () {
              const child = yield* Deferred.await(gate)
              yield* events.publish(
                SessionV1.Event.Updated,
                { sessionID: child.id, info: { ...child.info, metadata: {} } },
                { location: parent.location },
              )
              const admission = yield* sessions
                .prompt({
                  sessionID: child.id,
                  prompt: { text: "REUSED_GOAL_INPUT" },
                  resume: false,
                })
                .pipe(Effect.result)
              const resumed = yield* execution.resume(child.id).pipe(Effect.exit)
              yield* execution.wake(child.id)
              expect((yield* execution.active).has(child.id)).toBe(false)
              return { admission: admission._tag, resumed: resumed._tag }
            }),
          )
          const ordinary = yield* sessions.prompt({
            sessionID: parent.id,
            prompt: { text: "ORDINARY_PARENT_INPUT" },
            resume: false,
          })
          expect(ordinary).toBeDefined()
          expect(observations.map((item) => item.title)).toEqual([
            "Goal planning",
            "Goal verifying",
            ...(continuation ? ["Goal verifying"] : []),
            "Goal closing summary",
          ])
          expect(observations.every((item) => item.admission === "Failure" && item.inbox === 0)).toBe(true)
          expect(expired).toEqual(indexes.map(() => ({ admission: "Failure", contaminated: false })))
          expect(reusedGoal).toEqual(indexes.map(() => ({ admission: "Failure", resumed: "Failure" })))
          expect(yield* llm.calls).toBe(continuation ? 16 : 8)
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                SessionV2.node,
                SessionGoalControl.node,
                SessionExecutionLocal.node,
                EventV2.node,
                Database.node,
              ]),
              [
                [SessionExecution.node, SessionExecutionLocal.node],
                [Global.node, Global.layerWith({ home })],
                [
                  ModelsDev.node,
                  Layer.succeed(ModelsDev.Service, {
                    get: () => Effect.succeed({}),
                    refresh: () => Effect.void,
                  }),
                ],
              ],
            ).pipe(
              Layer.provide(
                ConfigProvider.layer(
                  ConfigProvider.fromUnknown({
                    APEXO_RUNTIME_PROFILE: "grok-build",
                  }),
                ),
              ),
            ),
          ),
        )
      }),
    30000,
  ),
)
