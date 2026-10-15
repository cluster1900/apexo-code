import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { BackgroundJob } from "@apexo/core/background-job"
import { GrokBuildTools } from "@/tool/grok-build"
import { Tool } from "@/tool/tool"
import { MessageID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"
import { promoteSession } from "@/background/job"

const it = testEffect(Layer.empty)

it.effect("an omitted shell wait backgrounds at 30 seconds without stopping the command", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const started = yield* Deferred.make<void>()
    const watched: string[] = []
    const tool = GrokBuildTools.adaptTools(
      [
        {
          id: "bash",
          description: "controlled shell",
          parameters: Schema.Unknown,
          execute: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        },
      ],
      { background: jobs },
    )[0]!
    const execution = yield* tool
      .execute(
        { command: "controlled", description: "default wait" },
        {
          sessionID: SessionID.make("ses_default_wait"),
          messageID: MessageID.ascending(),
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
          watchBackground: (id) =>
            Effect.sync(() => {
              watched.push(id)
            }),
        },
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(started)
    yield* TestClock.adjust(29_999)
    expect(watched).toEqual([])
    yield* TestClock.adjust(1)
    const result = yield* Fiber.join(execution)
    expect(result.metadata).toMatchObject({ background: true, timed_out: true })
    expect(watched).toEqual([result.metadata.task_id])
    expect((yield* jobs.get(String(result.metadata.task_id)))?.status).toBe("running")
    yield* jobs.cancel(String(result.metadata.task_id))
  }),
)
;["get_task_output", "wait_tasks"].forEach((name) => {
  it.effect(`${name} caps a multi-task wait at one hour without cancelling tasks`, () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.make
      const sessionID = SessionID.make("ses_wait_cap")
      const tasks = yield* Effect.forEach(["one", "two"], (id) =>
        jobs.start({
          id,
          type: "shell",
          metadata: { ownerSessionId: sessionID },
          run: Effect.never,
        }),
      )
      const completed: boolean[] = []
      const tool = GrokBuildTools.adaptTools([], { background: jobs }).find((item) => item.id === name)!
      const execution = yield* tool
        .execute(
          { task_ids: tasks.map((task) => task.id), timeout_ms: 7_200_000 },
          {
            sessionID,
            messageID: MessageID.ascending(),
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              completed.push(true)
            }),
          ),
          Effect.forkChild,
        )
      yield* TestClock.adjust(3_599_999)
      expect(completed).toEqual([])
      yield* TestClock.adjust(1)
      const result = yield* Fiber.join(execution)
      expect(result.output).toContain('<task id="one" status="running">')
      expect(result.output).toContain('<task id="two" status="running">')
      expect((yield* jobs.list()).every((job) => job.status === "running")).toBe(true)
    }),
  )
})
;[0, 1, 100].forEach((budget) => {
  it.effect(`shell watches only commands returned in background (budget=${budget})`, () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.make
      const watched: string[] = []
      const shell: Tool.Def = {
        id: "bash",
        description: "controlled shell completion",
        parameters: Schema.Unknown,
        execute: () => Effect.sleep(10).pipe(Effect.as({ title: "done", metadata: { exit: 0 }, output: "done" })),
      }
      const tool = GrokBuildTools.adaptTools([shell], { background: jobs })[0]
      const execution = yield* tool
        .execute(
          { command: "controlled", description: "notification decision", block_until_ms: budget },
          {
            sessionID: SessionID.make("ses_background_notification"),
            messageID: MessageID.ascending(),
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
            watchBackground: (id) =>
              Effect.sync(() => {
                watched.push(id)
              }),
          },
        )
        .pipe(Effect.forkChild)
      yield* TestClock.adjust(10)
      const result = yield* Fiber.join(execution)
      expect(watched).toEqual(budget < 10 ? [result.metadata.task_id] : [])
      expect((yield* jobs.get(String(result.metadata.task_id)))?.metadata?.exit).toBe(0)
    }),
  )
})

it.effect("a foreground shell is promoted without restarting and outlives its parent's abort", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const watched: string[] = []
    const calls: string[] = []
    const abort = new AbortController()
    const shell: Tool.Def = {
      id: "bash",
      description: "controlled foreground command",
      parameters: Schema.Unknown,
      execute: (_, ctx) =>
        Effect.gen(function* () {
          calls.push("started")
          yield* ctx.metadata({ metadata: { output: "partial" } })
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
          return { title: "finished", metadata: { exit: 0 }, output: "partial\nfinished" }
        }),
    }
    const sessionID = SessionID.make("ses_foreground_shell")
    const execution = yield* GrokBuildTools.adaptTools([shell], { background: jobs })[0]
      .execute(
        { command: "controlled", description: "promote me" },
        {
          sessionID,
          messageID: MessageID.ascending(),
          agent: "build",
          abort: abort.signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
          watchBackground: (id) =>
            Effect.sync(() => {
              watched.push(id)
            }),
        },
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(started)
    const job = (yield* jobs.list())[0]!
    expect(job.output).toBe("partial")
    expect(yield* promoteSession(jobs, SessionID.make("ses_foreign"), false)).toBe(false)
    expect(yield* promoteSession(jobs, sessionID, false)).toBe(true)
    const result = yield* Fiber.join(execution)
    expect(result.metadata.task_id).toBe(job.id)
    expect(result.metadata.background).toBe(true)
    expect(watched).toEqual([job.id])
    expect(yield* promoteSession(jobs, sessionID, false)).toBe(false)
    abort.abort()
    expect((yield* jobs.get(job.id))?.status).toBe("running")
    yield* Deferred.succeed(release, undefined)
    expect((yield* jobs.wait({ id: job.id })).info?.output).toBe("partial\nfinished")
    expect(calls).toEqual(["started"])
    expect(watched).toEqual([job.id])
  }),
)

it.effect("aborting an unpromoted foreground shell cancels its process and does not notify", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const started = yield* Deferred.make<void>()
    const stopped = yield* Deferred.make<void>()
    const watched: string[] = []
    const abort = new AbortController()
    const shell: Tool.Def = {
      id: "bash",
      description: "controlled cancellation",
      parameters: Schema.Unknown,
      execute: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(stopped, undefined)),
        ),
    }
    const execution = yield* GrokBuildTools.adaptTools([shell], { background: jobs })[0]
      .execute(
        { command: "controlled", description: "stop me" },
        {
          sessionID: SessionID.make("ses_foreground_abort"),
          messageID: MessageID.ascending(),
          agent: "build",
          abort: abort.signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
          watchBackground: (id) =>
            Effect.sync(() => {
              watched.push(id)
            }),
        },
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(started)
    abort.abort()
    expect(Exit.isFailure(yield* Fiber.await(execution))).toBe(true)
    yield* Deferred.await(stopped)
    expect((yield* jobs.list())[0]?.status).toBe("cancelled")
    expect(watched).toEqual([])
  }),
)
