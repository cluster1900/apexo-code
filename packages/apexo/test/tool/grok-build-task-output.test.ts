import { expect } from "bun:test"
import { Clock, Deferred, Duration, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { BackgroundJob } from "@apexo/core/background-job"
import { GrokBuildTools } from "@/tool/grok-build"
import { ToolJsonSchema } from "@/tool/json-schema"
import { Tool } from "@/tool/tool"
import { MessageID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const context = {
  sessionID: SessionID.make("ses_task_inputs"),
  messageID: MessageID.ascending(),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  ask: () => Effect.void,
  metadata: () => Effect.void,
} satisfies Tool.Context

it.effect("a raised host ceiling schedules platform-safe timers and still reaches its deadline", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    yield* jobs.start({ id: "long", type: "shell", metadata: { ownerSessionId: context.sessionID }, run: Effect.never })
    const maxWaitMs = 2 ** 31 - 1 + 80
    const tool = GrokBuildTools.adaptTools([], { background: jobs, maxWaitMs }).find(
      (item) => item.id === "get_task_output",
    )!
    const clock = yield* Clock.Clock
    const sleeps: number[] = []
    const finished: boolean[] = []
    const execution = yield* tool.execute({ task_ids: ["long"], timeout_ms: maxWaitMs }, context).pipe(
      Effect.tap(() => Effect.sync(() => finished.push(true))),
      Effect.provideService(Clock.Clock, {
        ...clock,
        sleep(duration) {
          sleeps.push(Duration.toMillis(duration))
          return clock.sleep(duration)
        },
      }),
      Effect.forkChild,
    )
    yield* TestClock.adjust(1)
    expect(sleeps).toEqual([2 ** 31 - 1])
    yield* TestClock.adjust(2 ** 31 - 2)
    expect(finished).toEqual([])
    yield* TestClock.adjust(79)
    expect(finished).toEqual([])
    yield* TestClock.adjust(1)
    expect((yield* Fiber.join(execution)).output).toContain('status="running"')
  }),
)

it.effect("task output normalizes lenient IDs before applying the limit and preserves ownership", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    yield* jobs.start({ id: "228", type: "shell", metadata: { ownerSessionId: context.sessionID }, run: Effect.never })
    yield* jobs.report({ id: "228", output: "visible output" })
    yield* jobs.start({ id: "foreign", type: "shell", metadata: { ownerSessionId: "ses_other" }, run: Effect.never })
    yield* jobs.report({ id: "foreign", output: "private output" })
    const tool = GrokBuildTools.adaptTools([], { background: jobs }).find((item) => item.id === "get_task_output")!
    yield* Effect.forEach(
      [
        { task_ids: 228 },
        { task_id: 228 },
        { task_ids: " 228 " },
        { task_id: [228, " 228 "] },
        { task_ids: Array(21).fill(" 228 ") },
      ],
      (input) =>
        Effect.gen(function* () {
          const result = yield* tool.execute(input, context)
          expect(result.metadata).toMatchObject({ task_id: "228", status: "running" })
          expect(result.output.match(/visible output/g)).toHaveLength(1)
        }),
    )
    const result = yield* tool.execute({ task_ids: [" foreign ", 228, "", "  ", "228", " missing "] }, context)
    expect(result.metadata).toMatchObject({
      task_ids: ["foreign", "228", "missing"],
      statuses: [
        { task_id: "foreign", status: "not_found" },
        { task_id: "228", status: "running" },
        { task_id: "missing", status: "not_found" },
      ],
    })
    expect(result.output).not.toContain("private output")
  }),
)

it.effect("task output handles empty inputs and rejects duplicate fields or non-ID values", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const tool = GrokBuildTools.adaptTools([], { background: jobs }).find((item) => item.id === "get_task_output")!
    yield* Effect.forEach([{}, { task_ids: null }, { task_id: null }, { task_ids: ["", " \n"] }], (input) =>
      Effect.gen(function* () {
        expect((yield* tool.execute(input, context)).metadata.status).toBe("invalid_request")
      }),
    )
    expect((yield* tool.execute({ task_id: "one", task_ids: ["two"] }, context)).metadata.status).toBe(
      "invalid_request",
    )
    yield* Effect.forEach([true, {}, [["nested"]], [true], [null]], (task_ids) =>
      Effect.gen(function* () {
        expect((yield* Effect.exit(tool.execute({ task_ids }, context)))._tag).toBe("Failure")
      }),
    )
    expect((yield* tool.execute({ task_ids: 0 }, context)).metadata).toMatchObject({
      task_id: "0",
      status: "not_found",
    })
  }),
)
;["get_task_output", "wait_tasks"].forEach((name) => {
  it.effect(`${name} allows 20 IDs and rejects 21 before starting a wait`, () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.make
      const tool = GrokBuildTools.adaptTools([], { background: jobs }).find((item) => item.id === name)!
      const ids = Array.from({ length: 20 }, (_, index) => `missing-${index}`)
      expect((yield* tool.execute({ task_ids: ids, mode: "wait_all" }, context)).metadata.task_ids).toEqual(ids)
      const result = yield* tool.execute({ task_ids: [...ids, "extra"], mode: "wait_all" }, context)
      expect(result.metadata.status).toBe("invalid_request")
      expect(result.output).toContain("maximum of 20")
    }),
  )
})

it.effect("legacy wait retains raw strings and duplicates and applies the limit before lookup", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const tool = GrokBuildTools.adaptTools([], { background: jobs }).find((item) => item.id === "wait_tasks")!
    const ids = [" missing ", "missing", "missing", ""]
    expect((yield* tool.execute({ task_ids: ids, mode: "wait_all" }, context)).metadata.task_ids).toEqual(ids)
    expect(
      (yield* tool.execute({ task_ids: Array(21).fill("missing"), mode: "wait_all" }, context)).metadata.status,
    ).toBe("invalid_request")
    expect((yield* Effect.exit(tool.execute({ task_ids: 228, mode: "wait_all" }, context)))._tag).toBe("Failure")
  }),
)

it.effect("wait_any returns every snapshot after one pending task finishes and leaves other tasks running", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const release = yield* Deferred.make<string>()
    yield* jobs.start({
      id: "fast",
      type: "task",
      metadata: { parentSessionId: context.sessionID },
      run: Deferred.await(release),
    })
    yield* jobs.start({ id: "slow", type: "shell", metadata: { ownerSessionId: context.sessionID }, run: Effect.never })
    const tool = GrokBuildTools.adaptTools([], { background: jobs }).find((item) => item.id === "wait_tasks")!
    const finished: boolean[] = []
    const execution = yield* tool
      .execute({ task_ids: ["missing", "fast", "slow"], mode: "wait_any", timeout_ms: 1000 }, context)
      .pipe(
        Effect.tap(() => Effect.sync(() => finished.push(true))),
        Effect.forkChild,
      )
    yield* TestClock.adjust(1)
    expect(finished).toEqual([])
    yield* Deferred.succeed(release, "finished")
    const result = yield* Fiber.join(execution)
    expect(result.metadata.statuses).toEqual([
      { task_id: "missing", status: "not_found" },
      { task_id: "fast", status: "completed" },
      { task_id: "slow", status: "running" },
    ])
    expect((yield* jobs.get("slow"))?.status).toBe("running")
  }),
)

it.effect("wait_all zero uses the default wait while wait_any zero and task output remain snapshots", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    yield* jobs.start({
      id: "pending",
      type: "shell",
      metadata: { ownerSessionId: context.sessionID },
      run: Effect.never,
    })
    const tools = GrokBuildTools.adaptTools([], { background: jobs })
    const wait = tools.find((item) => item.id === "wait_tasks")!
    const finished: boolean[] = []
    const execution = yield* wait.execute({ task_ids: ["pending"], mode: "wait_all", timeout_ms: 0 }, context).pipe(
      Effect.tap(() => Effect.sync(() => finished.push(true))),
      Effect.forkChild,
    )
    yield* TestClock.adjust(29_999)
    expect(finished).toEqual([])
    yield* TestClock.adjust(1)
    expect((yield* Fiber.join(execution)).output).toContain('status="running"')
    expect((yield* wait.execute({ task_ids: ["pending"], mode: "wait_any", timeout_ms: 0 }, context)).output).toContain(
      'status="running"',
    )
    const output = tools.find((item) => item.id === "get_task_output")!
    expect((yield* output.execute({ task_ids: ["pending"], timeout_ms: null }, context)).output).toContain(
      'status="running"',
    )
  }),
)
;["get_task_output", "wait_tasks"].forEach((name) => {
  it.effect(`${name} advertises and enforces the same host wait ceiling without cancelling work`, () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.make
      yield* jobs.start({
        id: "pending",
        type: "shell",
        metadata: { ownerSessionId: context.sessionID },
        run: Effect.never,
      })
      const tool = GrokBuildTools.adaptTools([], { background: jobs, maxWaitMs: 80 }).find((item) => item.id === name)!
      const schema = ToolJsonSchema.fromTool(tool)
      expect(schema.properties?.task_ids).toMatchObject({
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: { type: "string" },
      })
      expect(schema.properties?.timeout_ms).toMatchObject({ type: "integer", minimum: 0, maximum: 80 })
      expect(schema.properties).not.toHaveProperty("task_id")
      expect(tool.description).toContain("80ms")
      const finished: boolean[] = []
      const execution = yield* tool
        .execute({ task_ids: ["pending"], mode: "wait_all", timeout_ms: 10_000 }, context)
        .pipe(
          Effect.tap(() => Effect.sync(() => finished.push(true))),
          Effect.forkChild,
        )
      yield* TestClock.adjust(79)
      expect(finished).toEqual([])
      yield* TestClock.adjust(1)
      expect((yield* Fiber.join(execution)).output).toContain('status="running"')
      expect((yield* jobs.get("pending"))?.status).toBe("running")
      const immediate = GrokBuildTools.adaptTools([], { background: jobs, maxWaitMs: 0 }).find(
        (item) => item.id === name,
      )!
      expect(
        (yield* immediate.execute({ task_ids: ["pending"], mode: "wait_all", timeout_ms: 1_000 }, context)).output,
      ).toContain('status="running"')
    }),
  )
})
