import { expect } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { ConfigProvider, Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionInputExecution } from "@apexo/core/session/input-execution"
import { SessionTaskCompletion } from "@apexo/core/session/task-completion"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { SessionMessage } from "@apexo/core/session/message"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer, reply } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
const policy = { mode: "headless", permissions: "reject" } as const
const setup = Effect.gen(function* () {
  const root = yield* tmpdirScoped()
  const llm = yield* TestLLMServer
  yield* Effect.promise(async () => {
    await mkdir(path.join(root, "data"), { recursive: true })
    await Bun.write(
      path.join(root, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        compaction: { auto: false },
        agents: {
          limited: { mode: "primary", steps: 1, permissions: [{ action: "*", resource: "*", effect: "allow" }] },
          operator: { mode: "primary", permissions: [{ action: "*", resource: "*", effect: "allow" }] },
          worker: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] },
          headless: {
            mode: "primary",
            permissions: [
              { action: "*", resource: "*", effect: "ask" },
              { action: "bash", resource: "*DENIED*", effect: "deny" },
            ],
          },
        },
        providers: {
          test: {
            name: "Headless fixture",
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
      agent: AgentV2.ID.make("headless"),
    },
    app: AppNodeBuilder.build(
      LayerNode.group([
        SessionV2.node,
        SessionExecutionLocal.node,
        SessionInputExecution.node,
        SessionTaskStore.node,
        SessionTaskCompletion.node,
        Database.node,
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
    ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" })))),
  }
})

it.live(
  "native headless result is durable before wait and never repeats provider work on exact retry or resume",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const outcomes = yield* SessionInputExecution.Service
        const session = yield* sessions.create(f.create)
        yield* f.llm.text("HEADLESS_DONE", { usage: { input: 4, output: 3 } })
        const request = {
          sessionID: session.id,
          id: SessionMessage.ID.create(),
          prompt: { text: "finish once" },
          executionPolicy: policy,
        }
        const admitted = yield* sessions.prompt(request)
        const target = { sessionID: session.id, inputID: admitted.id }
        const result = yield* outcomes.wait(target, 10000)
        expect(result.timedOut).toBe(false)
        expect(result.execution.status).toBe("completed")
        expect(result.execution.finish).toBe("stop")
        expect(result.execution.usageIncomplete).toBe(false)
        expect((yield* outcomes.wait(target, 0)).execution).toEqual(result.execution)
        expect((yield* sessions.prompt(request)).id).toBe(admitted.id)
        expect((yield* sessions.resume(session.id).pipe(Effect.result))._tag).toBe("Failure")
        expect(yield* f.llm.calls).toBe(1)
        expect(
          (yield* sessions.messages({ sessionID: session.id, order: "asc" })).filter((item) => item.type === "user"),
        ).toHaveLength(1)
        yield* f.llm.text("ORDINARY_DONE")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "ordinary remains supported" } })
        yield* sessions.wait(session.id)
        expect(yield* f.llm.calls).toBe(2)
        expect((yield* outcomes.get(target)).status).toBe("completed")
      }).pipe(Effect.provide(f.app))
    }),
  20000,
)

it.live(
  "new steering supersedes only the prior input and conditional cancellation joins the current owned input",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const execution = yield* SessionExecution.Service
        const outcomes = yield* SessionInputExecution.Service
        const session = yield* sessions.create(f.create)
        const release = Promise.withResolvers<void>()
        yield* f.llm.hold("FIRST_TURN", release.promise)
        const first = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "first" },
          executionPolicy: policy,
        })
        yield* f.llm.wait(1)
        yield* f.llm.hang
        const second = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "second" },
          executionPolicy: policy,
        })
        release.resolve()
        yield* f.llm.wait(2)
        const prior = yield* outcomes.wait({ sessionID: session.id, inputID: first.id }, 1000)
        expect(prior.execution.status).toBe("superseded")
        expect(prior.timedOut).toBe(false)
        const oldCancel = yield* outcomes.interrupt({ sessionID: session.id, inputID: first.id }, execution.interrupt)
        expect(oldCancel.status).toBe("superseded")
        const queued = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "withdraw queued" },
          delivery: "queue",
          executionPolicy: policy,
        })
        const withdrawn = yield* outcomes.interrupt({ sessionID: session.id, inputID: queued.id }, execution.interrupt)
        expect(withdrawn.reason).toBe("withdrawn")
        const cancelled = yield* outcomes.interrupt({ sessionID: session.id, inputID: second.id }, execution.interrupt)
        expect(cancelled.status).toBe("interrupted")
        expect(cancelled.usageIncomplete).toBe(true)
        yield* sessions.wait(session.id)
        expect(yield* f.llm.calls).toBe(2)
        const transcript = yield* sessions.messages({ sessionID: session.id, order: "asc" })
        expect(transcript.filter((item) => item.type === "user").map((item) => item.id)).toEqual([first.id, second.id])
      }).pipe(Effect.provide(f.app))
    }),
  20000,
)

it.live(
  "headless permission rejects asks, allows explicit once policy, retains hard denies and rejects unsupported tool work",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const outcomes = yield* SessionInputExecution.Service
        const session = yield* sessions.create(f.create)
        for (const entry of [
          { permissions: "reject" as const, command: "printf ok > ask.txt", file: "ask.txt", exists: false },
          { permissions: "approve_once" as const, command: "printf ok > once.txt", file: "once.txt", exists: true },
          {
            permissions: "approve_once" as const,
            command: "printf DENIED > denied.txt",
            file: "denied.txt",
            exists: false,
          },
        ]) {
          yield* f.llm.tool("bash", { command: entry.command })
          yield* f.llm.text("TOOL_SETTLED")
          const admitted = yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: entry.command },
            executionPolicy: { ...policy, permissions: entry.permissions },
          })
          expect((yield* outcomes.wait({ sessionID: session.id, inputID: admitted.id }, 10000)).execution.status).toBe(
            "completed",
          )
          expect(yield* Effect.promise(() => Bun.file(path.join(f.root, entry.file)).exists())).toBe(entry.exists)
        }
        yield* f.llm.tool("question", {
          questions: [{ header: "Choose", question: "Choose one", options: [{ label: "one", description: "one" }] }],
        })
        yield* f.llm.text("NO_OPERATOR")
        const question = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "ask" },
          executionPolicy: { ...policy, permissions: "approve_once" },
        })
        expect((yield* outcomes.wait({ sessionID: session.id, inputID: question.id }, 10000)).execution.status).toBe(
          "completed",
        )
        expect(JSON.stringify(yield* f.llm.inputs)).toContain("interactive operator")
        expect(yield* f.llm.calls).toBe(8)
      }).pipe(Effect.provide(f.app))
    }),
  30000,
)

it.live(
  "foreground Task inherits the canonical input policy and parent hard deny without detached admission",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const outcomes = yield* SessionInputExecution.Service
        const tasks = yield* SessionTaskStore.Service
        const session = yield* sessions.create(f.create)
        for (const entry of [
          { command: "printf ok > child-once.txt", file: "child-once.txt", exists: true },
          { command: "printf DENIED > child-denied.txt", file: "child-denied.txt", exists: false },
        ]) {
          yield* f.llm.tool("task", { description: "Foreground child", prompt: entry.command, subagent_type: "worker" })
          yield* f.llm.tool("bash", { command: entry.command })
          yield* f.llm.text("CHILD_DONE")
          yield* f.llm.text("PARENT_DONE")
          const admitted = yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: entry.command },
            executionPolicy: { ...policy, permissions: "approve_once" },
          })
          expect((yield* outcomes.wait({ sessionID: session.id, inputID: admitted.id }, 10000)).execution.status).toBe(
            "completed",
          )
          expect(yield* Effect.promise(() => Bun.file(path.join(f.root, entry.file)).exists())).toBe(entry.exists)
        }
        expect(yield* f.llm.calls).toBe(8)
        const children = (yield* sessions.list()).filter((item) => item.parentID === session.id)
        expect(children).toHaveLength(2)
        for (const child of children) {
          const record = yield* tasks.read(child.id)
          expect(record?.parentID).toBe(session.id)
          const receipt = yield* outcomes.selected(child.id)
          expect(receipt?.policy.permissions).toBe("approve_once")
          expect(receipt?.status).toBe("completed")
        }
        yield* f.llm.tool("task", {
          description: "Detached rejected",
          prompt: "must not execute",
          subagent_type: "worker",
          background: true,
        })
        yield* f.llm.text("NO_DETACH")
        const background = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "background" },
          executionPolicy: { ...policy, permissions: "approve_once" },
        })
        expect((yield* outcomes.wait({ sessionID: session.id, inputID: background.id }, 10000)).execution.status).toBe(
          "completed",
        )
        expect((yield* sessions.list()).filter((item) => item.parentID === session.id)).toHaveLength(2)
        expect(yield* f.llm.calls).toBe(10)
      }).pipe(Effect.provide(f.app))
    }),
  30000,
)

it.live(
  "a newer promotion revokes an already captured cancel predicate and deletion cannot mutate a reused ID",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const execution = yield* SessionExecution.Service
        const outcomes = yield* SessionInputExecution.Service
        const session = yield* sessions.create(f.create)
        const release = Promise.withResolvers<void>()
        yield* f.llm.hold("OLD", release.promise)
        const old = yield* sessions.prompt({ sessionID: session.id, prompt: { text: "old" }, executionPolicy: policy })
        yield* f.llm.wait(1)
        const captured = yield* Deferred.make<void>()
        const continueCancel = yield* Deferred.make<void>()
        const cancel = yield* outcomes
          .interrupt({ sessionID: session.id, inputID: old.id }, (sessionID, when) =>
            Deferred.succeed(captured, undefined).pipe(
              Effect.andThen(Deferred.await(continueCancel)),
              Effect.andThen(execution.interrupt(sessionID, when)),
            ),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(captured)
        yield* f.llm.hang
        const fresh = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "fresh" },
          executionPolicy: policy,
        })
        release.resolve()
        yield* f.llm.wait(2)
        yield* Deferred.succeed(continueCancel, undefined)
        expect((yield* Fiber.join(cancel)).status).toBe("superseded")
        expect((yield* outcomes.get({ sessionID: session.id, inputID: fresh.id })).status).toBe("active")
        yield* sessions.remove(session.id)
        expect((yield* outcomes.get({ sessionID: session.id, inputID: fresh.id }).pipe(Effect.result))._tag).toBe(
          "Failure",
        )
        yield* sessions.create({ ...f.create, id: session.id })
        yield* f.llm.text("REUSED")
        const reused = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "reused" },
          executionPolicy: policy,
        })
        expect((yield* outcomes.wait({ sessionID: session.id, inputID: reused.id }, 10000)).execution.status).toBe(
          "completed",
        )
        expect(
          (yield* outcomes
            .interrupt({ sessionID: session.id, inputID: fresh.id }, execution.interrupt)
            .pipe(Effect.result))._tag,
        ).toBe("Failure")
        expect(
          (yield* sessions.messages({ sessionID: session.id, order: "asc" }))
            .filter((item) => item.type === "user")
            .map((item) => item.id),
        ).toEqual([reused.id])
        expect(yield* f.llm.calls).toBe(3)
      }).pipe(Effect.provide(f.app))
    }),
  20000,
)

it.live(
  "provider errors and turn allowance have truthful terminal receipts; unsupported process work never spawns",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const outcomes = yield* SessionInputExecution.Service
        const session = yield* sessions.create(f.create)
        yield* f.llm.error(400, { error: { message: "fixture bad request" } })
        const failed = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "provider fails" },
          executionPolicy: policy,
        })
        const failedOutcome = yield* outcomes.wait({ sessionID: session.id, inputID: failed.id }, 10000)
        expect(failedOutcome.execution.status).toBe("failed")
        expect(failedOutcome.execution.reason).toBe("provider_error")
        expect(failedOutcome.execution.usageIncomplete).toBe(true)
        expect(yield* f.llm.calls).toBe(1)
        const limited = yield* sessions.create({ ...f.create, agent: AgentV2.ID.make("limited") })
        yield* f.llm.text("ALLOWANCE_ENDED", { usage: { input: 2, output: 1 } })
        const last = yield* sessions.prompt({
          sessionID: limited.id,
          prompt: { text: "one turn" },
          executionPolicy: policy,
        })
        const lastOutcome = yield* outcomes.wait({ sessionID: limited.id, inputID: last.id }, 10000)
        expect(lastOutcome.execution.status).toBe("failed")
        expect(lastOutcome.execution.reason).toBe("turn_limit")
        expect(lastOutcome.execution.usageIncomplete).toBe(false)
        yield* f.llm.tool("bash", {
          command: "printf forbidden > detached.txt",
          background: true,
          description: "No detach",
        })
        yield* f.llm.text("NO_PROCESS", { usage: { input: 2, output: 1 } })
        const processInput = yield* sessions.prompt({
          sessionID: session.id,
          prompt: { text: "detached shell" },
          executionPolicy: { ...policy, permissions: "approve_once" },
        })
        const processOutcome = yield* outcomes.wait({ sessionID: session.id, inputID: processInput.id }, 10000)
        expect(processOutcome.execution.status).toBe("completed")
        // The preceding tool-call transport omitted usage; the final known receipt cannot make the aggregate exact.
        expect(processOutcome.execution.usageIncomplete).toBe(true)
        expect(yield* Effect.promise(() => Bun.file(path.join(f.root, "detached.txt")).exists())).toBe(false)
        expect(yield* f.llm.calls).toBe(4)
      }).pipe(Effect.provide(f.app))
    }),
  20000,
)

for (const delivery of ["steer", "queue"] as const)
  it.live(
    `headless leaves unrelated ready Task notice for a later ordinary ${delivery}`,
    () =>
      Effect.gen(function* () {
        const f = yield* setup
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const outcomes = yield* SessionInputExecution.Service
          const completions = yield* SessionTaskCompletion.Service
          const tasks = yield* SessionTaskStore.Service
          const session = yield* sessions.create({ ...f.create, agent: AgentV2.ID.make("operator") })
          const release = Promise.withResolvers<void>()
          yield* f.llm.tool("task", {
            description: "Unrelated background",
            prompt: "BACKGROUND_ONLY",
            subagent_type: "worker",
            background: true,
          })
          yield* f.llm.pushMatch(
            (hit) =>
              JSON.stringify(hit.body).includes("BACKGROUND_ONLY") &&
              !JSON.stringify(hit.body).includes("launch background"),
            reply().wait(release.promise).text("BACKGROUND_RESULT").stop(),
          )
          yield* f.llm.text("LAUNCHED")
          yield* sessions.prompt({ sessionID: session.id, prompt: { text: "launch background" } })
          yield* sessions.wait(session.id)
          yield* f.llm.wait(3)
          yield* sessions.wait(session.id)
          expect(yield* f.llm.calls).toBe(3)
          yield* f.llm.text("HEADLESS_ONLY")
          const admitted = yield* sessions.prompt({
            sessionID: session.id,
            prompt: { text: "headless now" },
            executionPolicy: policy,
          })
          expect((yield* outcomes.wait({ sessionID: session.id, inputID: admitted.id }, 10000)).execution.status).toBe(
            "completed",
          )
          release.resolve()
          yield* pollWithTimeout(
            completions.pending(session.id).pipe(Effect.map((pending) => pending || undefined)),
            "background notice did not become ready",
            "5 seconds",
          )
          yield* sessions.wait(session.id)
          expect(yield* f.llm.calls).toBe(4)
          expect(yield* completions.pending(session.id)).toBe(true)
          const child = (yield* sessions.list()).find((item) => item.parentID === session.id)
          expect(child).toBeDefined()
          if (!child) return yield* Effect.die("missing child")
          expect((yield* tasks.latest(session.id, child.id))?.notice).toBe("pending")
          yield* f.llm.text("ORDINARY_WITH_NOTICE")
          yield* sessions.prompt({ sessionID: session.id, prompt: { text: "ordinary now" }, delivery })
          yield* sessions.wait(session.id)
          expect(yield* f.llm.calls).toBe(5)
          expect(yield* completions.pending(session.id)).toBe(false)
          expect((yield* tasks.latest(session.id, child.id))?.notice).toBe("delivered")
          expect(JSON.stringify((yield* f.llm.inputs).at(-1))).toContain("BACKGROUND_RESULT")
          expect((yield* outcomes.get({ sessionID: session.id, inputID: admitted.id })).status).toBe("completed")
        }).pipe(Effect.provide(f.app))
      }),
    20000,
  )
