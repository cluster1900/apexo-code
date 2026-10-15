import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Schema, Stream } from "effect"
import { ContentBlockID, type LLMEvent, Usage } from "@apexo/llm"
import { eq } from "drizzle-orm"
import { Goal } from "@apexo/schema/goal"
import { SessionID } from "@apexo/schema/session-id"
import { AbsolutePath } from "@apexo/schema/schema"
import { Database } from "@apexo/core/database/database"
import { BackgroundJob } from "@apexo/core/background-job"
import { SessionGoalProgress } from "@apexo/core/session/goal-progress"
import { GrokBuildTools } from "@/tool/grok-build"
import { MessageID } from "@/session/schema"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalReview } from "@apexo/core/session/goal-review"
import { SessionGoalEvaluation } from "@apexo/core/session/goal-evaluation"
import { SessionGoalUsage } from "@apexo/core/session/goal-usage"
import { SessionTable } from "@apexo/core/session/sql"
import { ProjectV2 } from "@apexo/core/project"
import { ProjectTable } from "@apexo/core/project/sql"
import { GoalAttemptTable, GoalTable, GoalUsageTable } from "@apexo/core/goal/sql"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/fixture"

const it = testEffect(Database.layerFromPath(":memory:"))
const isolated = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live("skeptic model assignments survive resume and only append new round-robin slots", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const pool = [
      { model: "provider/a", agent_type: "inspect" },
      { model: "provider/b", agent_type: "build" },
    ]
    const work = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.finish(work, { verify: true })
    const first = yield* f.goals.begin(f.target, "verifying")
    expect((yield* f.goals.prepareVerification(first, 3, "a".repeat(64), pool)).skepticModels).toEqual([
      pool[0],
      pool[1],
      pool[0],
    ])
    yield* f.goals.pause(f.target, "user_paused")
    yield* f.goals.resume(f.target)
    yield* f.goals.finish(yield* f.goals.begin(f.target, "executing"), { verify: true })
    const resumed = yield* f.goals.begin(f.target, "verifying")
    const added = { model: "provider/c", agent_type: "other" }
    expect((yield* f.goals.prepareVerification(resumed, 5, "b".repeat(64), [added])).skepticModels).toEqual([
      pool[0],
      pool[1],
      pool[0],
      added,
      added,
    ])
    yield* f.goals.pause(f.target, "user_paused")
    yield* f.goals.resume(f.target)
    yield* f.goals.finish(yield* f.goals.begin(f.target, "executing"), { verify: true })
    const bypass = yield* f.goals.begin(f.target, "verifying")
    expect((yield* f.goals.prepareVerification(bypass, 1, "c".repeat(64), [])).skepticModels).toHaveLength(5)
  }),
)

it.live("panel reports reject conflicting slots and late attempts without rewriting durable evidence", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const work = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.finish(work, { verify: true })
    const verifier = yield* f.goals.begin(f.target, "verifying")
    const digest = "a".repeat(64)
    yield* f.goals.prepareVerification(verifier, 3, digest)
    const result: Goal.Reviewer = {
      index: 0,
      callID: "call0",
      tokensUsed: 30,
      elapsedMs: 1,
      achieved: true,
      evidence: "Verified artifact",
      unmet: [],
      confidence: "high",
      blocking: "none",
    }
    const recorded = yield* f.goals.recordVerification(verifier, result)
    expect(yield* f.goals.recordVerification(verifier, result)).toEqual(recorded)
    expect(yield* failure(f.goals.recordVerification(verifier, { ...result, callID: "another" }))).toMatchObject({
      code: "exists",
    })
    expect(yield* failure(f.goals.recordVerification(verifier, { ...result, index: 1 }))).toMatchObject({
      code: "exists",
    })
    expect(
      yield* failure(f.goals.verify(verifier, { achieved: true, evidence: "Bypass peers", unmet: [] })),
    ).toMatchObject({ code: "busy" })
    yield* f.goals.pause(f.target, "user_paused")
    yield* f.goals.resume(f.target)
    expect(yield* failure(f.goals.recordVerification(verifier, { ...result, index: 1, callID: "late" }))).toMatchObject(
      { code: "stale" },
    )
    expect((yield* f.goals.get(f.target.sessionID))?.verification?.results).toEqual([result])
  }),
)

for (const budget of [undefined, 50]) {
  it.live(`parallel verifier ${budget ? "budget exhaustion" : "malformed response"} promptly cancels a held peer`, () =>
    Effect.gen(function* () {
      const f = yield* fixture(budget)
      const work = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.finish(work, { verify: true })
      const ready = yield* Deferred.make<void>()
      const result = yield* SessionGoalReview.make(f.goals)
        .run({
          target: f.target,
          kind: "verifying",
          evidence: "Full evidence",
          stream: (request) => {
            const index = JSON.parse(request.content).verifierIndex as number
            if (index === 1) return Stream.unwrap(Deferred.succeed(ready, undefined).pipe(Effect.as(Stream.never)))
            const valid = JSON.stringify({
              achieved: true,
              evidence: "Verified",
              unmet: [],
              confidence: "high",
              blocking: "none",
            })
            return index === 0
              ? reviewEvents(valid)
              : Stream.unwrap(Deferred.await(ready).pipe(Effect.as(reviewEvents(budget ? valid : "not json"))))
          },
        })
        .pipe(Effect.timeout("3 seconds"))
      expect(result.info?.status).toBe(budget ? "budget_limited" : "infra_paused")
      expect(result.info?.tokensUsed).toBe(60)
      expect(result.info?.usageIncomplete).toBe(true)
      expect(result.info?.verification?.results).toHaveLength(1)
    }),
  )
}

for (const scenario of [
  {
    name: "default three approve",
    votes: [true, true, true],
    confidence: "high",
    blocking: "none",
    status: "complete",
    calls: 3,
  },
  {
    name: "cold tie rejects even if gatekeeper approves",
    votes: [true, true, false],
    confidence: "medium",
    blocking: "none",
    status: "active",
    calls: 3,
  },
  {
    name: "high gatekeeper refute skips cold reviewers",
    votes: [false, true, true],
    confidence: "high",
    blocking: "none",
    status: "active",
    calls: 1,
  },
  {
    name: "low gatekeeper cannot veto cold majority",
    votes: [false, true, true],
    confidence: "low",
    blocking: "none",
    status: "complete",
    calls: 3,
  },
  {
    name: "high external blocker fans out and remains binding",
    votes: [false, true, true],
    confidence: "high",
    blocking: "unverifiable",
    status: "blocked",
    calls: 3,
  },
  {
    name: "single reviewer stays decisive",
    votes: [false],
    confidence: "medium",
    blocking: "none",
    status: "active",
    calls: 1,
  },
  {
    name: "two reviewers use the cold vote",
    votes: [false, true],
    confidence: "medium",
    blocking: "none",
    status: "complete",
    calls: 2,
  },
  {
    name: "five reviewers require three cold approvals",
    votes: [true, true, true, false, false],
    confidence: "medium",
    blocking: "none",
    status: "active",
    calls: 5,
  },
  {
    name: "five reviewers accept cold majority",
    votes: [true, true, true, true, false],
    confidence: "medium",
    blocking: "none",
    status: "complete",
    calls: 5,
  },
] as const) {
  it.live(`independent verification panel: ${scenario.name}`, () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const work = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.finish(work, { verify: true })
      const calls: SessionGoalReview.Request[] = []
      const result = yield* SessionGoalReview.make(f.goals).run({
        target: f.target,
        kind: "verifying",
        ...(scenario.votes.length !== 3 ? { verifierCount: scenario.votes.length } : {}),
        evidence: "Original requirements and checked artifacts",
        stream: (request) => {
          calls.push(request)
          const index = JSON.parse(request.content).verifierIndex as number
          expect(request.outputSchema).toBeDefined()
          return reviewEvents(
            JSON.stringify({
              achieved: scenario.votes[index],
              evidence: `Artifact finding ${index}`,
              unmet: scenario.votes[index] ? [] : [`Requirement ${index}`],
              confidence: scenario.confidence,
              blocking: scenario.votes[index] ? "none" : scenario.blocking,
            }),
          )
        },
      })
      expect(result.info?.status).toBe(scenario.status)
      expect(calls).toHaveLength(scenario.calls)
      expect(new Set(calls.map((call) => call.callID)).size).toBe(scenario.calls)
      expect(result.info?.tokensUsed).toBe(30 * scenario.calls)
      expect(result.info?.verification?.results).toHaveLength(scenario.calls)
      expect(result.info?.verification?.count).toBe(scenario.votes.length)
      expect(result.info?.verification?.results.every((item) => item.tokensUsed === 30)).toBe(true)
      expect((yield* f.goals.get(f.target.sessionID))?.verification).toEqual(result.info?.verification)
      if (scenario.status !== "complete") expect(result.info?.unmet.length).toBeGreaterThan(0)
    }),
  )
}

it.live("cold reviewers run concurrently; interrupted panels retain results and cannot complete", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const work = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.finish(work, { verify: true })
    const ready = yield* Deferred.make<void>()
    const started: number[] = []
    const running = yield* SessionGoalReview.make(f.goals)
      .run({
        target: f.target,
        kind: "verifying",
        evidence: "Test evidence",
        stream: (request) => {
          const index = JSON.parse(request.content).verifierIndex as number
          if (index === 0)
            return reviewEvents(
              JSON.stringify({
                achieved: true,
                evidence: "Ready for peers",
                unmet: [],
                confidence: "high",
                blocking: "none",
              }),
            )
          return Stream.unwrap(
            Effect.gen(function* () {
              started.push(index)
              if (started.length === 2) yield* Deferred.succeed(ready, undefined)
              return Stream.never
            }),
          )
        },
      })
      .pipe(Effect.forkChild)
    yield* Deferred.await(ready).pipe(Effect.timeout("3 seconds"))
    expect(started.toSorted()).toEqual([1, 2])
    const current = yield* f.goals.get(f.target.sessionID)
    expect(current?.verification?.results).toHaveLength(1)
    expect(current?.status).toBe("active")
    yield* Fiber.interrupt(running)
    expect(yield* f.goals.get(f.target.sessionID)).toMatchObject({
      status: "user_paused",
      tokensUsed: 30,
      usageIncomplete: true,
    })
    yield* f.goals.resume(f.target)
    const nextWork = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.finish(nextWork, { verify: true })
    const resumed = yield* SessionGoalReview.make(f.goals).run({
      target: f.target,
      kind: "verifying",
      evidence: "New work evidence",
      stream: (request) => {
        const content = JSON.parse(request.content)
        expect(content.previousOwnVerdict?.evidence).toBe(content.verifierIndex === 0 ? "Ready for peers" : undefined)
        return reviewEvents(
          JSON.stringify({
            achieved: true,
            evidence: "All checked again",
            unmet: [],
            confidence: "high",
            blocking: "none",
          }),
        )
      },
    })
    expect(resumed.info?.status).toBe("complete")
    expect(resumed.info?.tokensUsed).toBe(120)
    expect(resumed.info?.verification?.round).toBe(2)
  }),
)

it.live("cancelled worker requests mark incomplete usage while keeping confirmed billing", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const attempt = yield* f.goals.begin(f.target, "executing")
    yield* SessionGoalUsage.track(f.goals, attempt, () => reviewEvents("confirmed work")).pipe(Stream.runDrain)
    expect(yield* f.goals.get(f.target.sessionID)).toMatchObject({ tokensUsed: 30 })
    expect((yield* f.goals.get(f.target.sessionID))?.usageIncomplete).toBeUndefined()
    const ready = yield* Deferred.make<void>()
    const worker = yield* SessionGoalUsage.track(f.goals, attempt, () =>
      Stream.fromEffect(Deferred.succeed(ready, undefined)).pipe(Stream.flatMap(() => Stream.never)),
    ).pipe(Stream.runDrain, Effect.forkChild)
    yield* Deferred.await(ready)
    yield* f.goals.pause(f.target, "user_paused")
    yield* Fiber.interrupt(worker)
    expect(yield* f.goals.get(f.target.sessionID)).toMatchObject({
      status: "user_paused",
      tokensUsed: 30,
      usageIncomplete: true,
    })
    expect(yield* f.goals.resume(f.target)).toMatchObject({ tokensUsed: 30, usageIncomplete: true })
  }),
)

it.live("goal start selection and prompt identity survive retries without resuming paused work", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const selection = Schema.decodeUnknownSync(Goal.Start)({
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
    expect(yield* failure(f.goals.prepareStart(f.target, { ...selection, agent: "" }))).toMatchObject({
      code: "invalid",
    })
    const started = yield* f.goals.prepareStart(f.target, selection)
    expect(started.launch).toMatchObject(selection)
    expect(started.launch?.messageID).toStartWith("msg_")
    expect(yield* f.goals.prepareStart(f.target, selection)).toEqual(started)
    expect(yield* failure(f.goals.prepareStart(f.target, { ...selection, agent: "plan" }))).toMatchObject({
      code: "exists",
    })
    yield* f.goals.pause(f.target, "user_paused")
    expect(yield* f.goals.prepareStart(f.target, selection)).toMatchObject({
      status: "user_paused",
      launch: started.launch,
    })
    yield* f.goals.clear(f.target)
    expect(yield* failure(f.goals.prepareStart(f.target, selection))).toMatchObject({ code: "missing" })
  }),
)

function reviewEvents(text: string, usage = new Usage({ inputTokens: 20, outputTokens: 10 })) {
  return Stream.fromIterable<LLMEvent>([
    { type: "text-delta", id: ContentBlockID.make("review"), text },
    { type: "step-finish", index: 0, reason: "stop", usage },
    { type: "finish", reason: "stop", usage },
  ])
}

it.live("evaluation gates self-reported completion and permits sustained concrete work", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    for (const round of [1, 2, 3, 4]) {
      const worker = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.update(worker, { completed: true, message: "The worker claims done" })
      yield* f.goals.finish(worker, { evaluate: true })
      expect(yield* f.goals.next(f.target)).toBe("evaluating")
      expect(yield* failure(f.goals.begin(f.target, "verifying"))).toMatchObject({ code: "busy" })
      const evaluation = yield* f.goals.begin(f.target, "evaluating")
      const verdict = {
        decision: "continue" as const,
        evidence: `Test ${round} is missing`,
        next_step: `Run test ${round}`,
        blocker_key: "",
      }
      yield* f.goals.evaluate(evaluation, verdict)
      expect(yield* failure(f.goals.evaluate(evaluation, verdict))).toMatchObject({ code: "stale" })
      expect(yield* f.goals.get(f.target.sessionID)).toMatchObject({
        status: "active",
        evaluation: verdict,
        workerRounds: round,
        verificationRounds: 0,
      })
    }
    const worker = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.finish(worker, { evaluate: true })
    const evaluating = yield* f.goals.begin(f.target, "evaluating")
    yield* f.goals.evaluate(evaluating, {
      decision: "candidate_complete",
      evidence: "All tests passed",
      next_step: "Independently verify all requirements",
      blocker_key: "",
    })
    expect((yield* f.goals.get(f.target.sessionID))?.status).toBe("active")
    expect(yield* f.goals.next(f.target)).toBe("verifying")
    const verifier = yield* f.goals.begin(f.target, "verifying")
    expect(
      (yield* f.goals.verify(verifier, { achieved: true, evidence: "All requirements checked", unmet: [] })).status,
    ).toBe("complete")
  }),
)

it.live("evaluation blocker streaks reset on changed prerequisites, progress and explicit resume", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    for (const [index, key] of [
      "service_a",
      "service_a",
      "service_b",
      "",
      "service_b",
      "service_b",
      "service_b",
    ].entries()) {
      const worker = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.update(worker, { blocked_reason: "The worker's unstable prose is not the evaluator key" })
      yield* f.goals.finish(worker, { evaluate: true })
      const attempt = yield* f.goals.begin(f.target, "evaluating")
      const info = yield* f.goals.evaluate(attempt, {
        decision: key ? "blocked" : "continue",
        evidence: `Observation ${index}`,
        next_step: "Check the actual prerequisite",
        blocker_key: key,
      })
      expect(info.status).toBe(index === 6 ? "blocked" : "active")
    }
    yield* f.goals.resume(f.target)
    const worker = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.finish(worker, { evaluate: true })
    const attempt = yield* f.goals.begin(f.target, "evaluating")
    expect(
      (yield* f.goals.evaluate(attempt, {
        decision: "blocked",
        evidence: "Still unavailable",
        next_step: "Restore service B",
        blocker_key: "service_b",
      })).status,
    ).toBe("active")
  }),
)

it.live("invalid evaluator verdicts retry once, charge each request and pause without verification", () =>
  Effect.gen(function* () {
    for (const value of [
      "not json",
      JSON.stringify({
        decision: "candidate_complete",
        evidence: "done",
        next_step: "verify",
        blocker_key: "",
        extra: true,
      }),
      JSON.stringify({ decision: "continue", evidence: " ", next_step: "work", blocker_key: "" }),
      JSON.stringify({ decision: "blocked", evidence: "missing", next_step: "restore", blocker_key: "" }),
      JSON.stringify({ decision: "blocked", evidence: "missing", next_step: "restore", blocker_key: "Upper Case" }),
      JSON.stringify({ decision: "continue", evidence: "progress", next_step: "work", blocker_key: "service_a" }),
    ]) {
      const f = yield* fixture()
      const worker = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.finish(worker, { evaluate: true })
      const calls: string[] = []
      const result = yield* SessionGoalReview.make(f.goals).run({
        target: f.target,
        kind: "evaluating",
        evidence: "Test output",
        stream: (request) => {
          calls.push(request.callID)
          expect(request.outputSchema).toMatchObject({ type: "object", additionalProperties: false })
          return reviewEvents(value)
        },
      })
      expect(new Set(calls).size).toBe(2)
      expect(result.info).toMatchObject({ status: "infra_paused", tokensUsed: 60, verificationRounds: 0 })
      expect(result.info?.evaluation).toBeUndefined()
    }
  }),
)

it.live("evaluator retry can recover missing usage while retaining an explicit incomplete accounting flag", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const worker = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.finish(worker, { evaluate: true })
    const calls: string[] = []
    const result = yield* SessionGoalReview.make(f.goals).run({
      target: f.target,
      kind: "evaluating",
      evidence: "Source evidence",
      stream: (request) => {
        calls.push(request.callID)
        return calls.length === 1
          ? Stream.fromIterable<LLMEvent>([{ type: "finish", reason: "stop" }])
          : reviewEvents(
              JSON.stringify({
                decision: "continue",
                evidence: "One test remains",
                next_step: "Run the last test",
                blocker_key: "",
              }),
            )
      },
    })
    expect(calls).toHaveLength(2)
    expect(result.info).toMatchObject({
      status: "active",
      tokensUsed: 30,
      usageIncomplete: true,
      evaluation: { decision: "continue" },
    })
    expect(result.info?.history.some((entry) => entry.event === "usage_incomplete")).toBe(true)
  }),
)

it.live("budget exhaustion forbids evaluator retry and acceptance of its candidate verdict", () =>
  Effect.gen(function* () {
    const f = yield* fixture(20)
    const worker = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.finish(worker, { evaluate: true })
    const calls: string[] = []
    const result = yield* SessionGoalReview.make(f.goals).run({
      target: f.target,
      kind: "evaluating",
      evidence: "Full test evidence",
      stream: (request) => {
        calls.push(request.callID)
        return reviewEvents(
          JSON.stringify({
            decision: "candidate_complete",
            evidence: "All tests passed",
            next_step: "Verify",
            blocker_key: "",
          }),
        )
      },
    })
    expect(calls).toHaveLength(1)
    expect(result.info).toMatchObject({ status: "budget_limited", tokensUsed: 30, verificationRounds: 0 })
    expect(result.info?.evaluation).toBeUndefined()
  }),
)

it.live("evaluator deadlines retry once and retain incomplete accounting without declaring completion", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const worker = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.finish(worker, { evaluate: true })
    const calls: string[] = []
    const result = yield* SessionGoalReview.make(f.goals).run({
      target: f.target,
      kind: "evaluating",
      evidence: "Current work evidence",
      timeoutMs: 10,
      stream: (request) => {
        calls.push(request.callID)
        return Stream.fromEffect(Effect.never)
      },
    })
    expect(new Set(calls).size).toBe(2)
    expect(result.info).toMatchObject({
      status: "infra_paused",
      usageIncomplete: true,
      tokensUsed: 0,
      verificationRounds: 0,
    })
    expect(result.info?.evaluation).toBeUndefined()
  }),
)

it.live("late evaluator results cannot finish a resumed goal and retain actual usage", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const worker = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.finish(worker, { evaluate: true })
    const entered = yield* Deferred.make<void>()
    const released = yield* Deferred.make<void>()
    const running = yield* SessionGoalReview.make(f.goals)
      .run({
        target: f.target,
        kind: "evaluating",
        evidence: "Old evidence",
        stream: () =>
          Stream.unwrap(
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(released)),
              Effect.as(
                reviewEvents(
                  JSON.stringify({
                    decision: "candidate_complete",
                    evidence: "Old evidence",
                    next_step: "Verify",
                    blocker_key: "",
                  }),
                ),
              ),
            ),
          ),
      })
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* f.goals.pause(f.target, "user_paused")
    yield* f.goals.resume(f.target)
    const replacement = yield* f.goals.begin(f.target, "executing")
    yield* Deferred.succeed(released, undefined)
    const result = yield* Fiber.join(running)
    expect(result.applied).toBe(false)
    expect(result.info).toMatchObject({ status: "active", phase: "executing", tokensUsed: 30 })
    expect(result.info?.evaluation).toBeUndefined()
    yield* f.goals.finish(replacement, { evaluate: true })
  }),
)

it.live("evaluator transcript bounds preserve UTF-8 and include recent tool evidence", () =>
  Effect.gen(function* () {
    const text = SessionGoalEvaluation.transcript(
      Array.from({ length: 20 }, (_, index) => ({ role: "tool", text: `${index}: ${"结果🙂".repeat(3000)}` })),
    )
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32768)
    expect(text).toContain("19:")
    expect(text).not.toContain("[tool] 0:")
    expect(text).not.toContain("�")
    expect(SessionGoalEvaluation.bounded("你好🙂", 8)).toBe("你好")
  }),
)

it.live("independent planning and verification preserve the objective and account inclusive usage once", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const reviews = SessionGoalReview.make(f.goals)
    const planned = yield* reviews.run({
      target: f.target,
      kind: "planning",
      evidence: "Current repository evidence",
      stream: (request) => {
        expect(JSON.parse(request.content).objective).toBe(f.info.objective)
        expect(request.system).toContain("independent goal planner")
        return reviewEvents(
          JSON.stringify({ plan: "1. Implement all requirements. 2. Test each requirement." }),
          new Usage({
            inputTokens: 20,
            outputTokens: 10,
            reasoningTokens: 4,
            cacheReadInputTokens: 5,
            totalTokens: 30,
          }),
        )
      },
    })
    expect(planned.applied).toBe(true)
    expect(planned.info?.tokensUsed).toBe(30)
    const worker = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.update(worker, { completed: true })
    yield* f.goals.finish(worker, {})
    const verified = yield* reviews.run({
      target: f.target,
      kind: "verifying",
      evidence: "Test run A passed; every named requirement has a checked result",
      stream: (request) => {
        expect(request.attempt.attemptID).not.toBe(worker.attemptID)
        expect(request.system).toContain("independent skeptical goal verifier")
        expect(JSON.parse(request.content).plan).toBe(planned.info?.plan)
        return reviewEvents(
          JSON.stringify({
            achieved: true,
            evidence: "Test run A covers each requirement",
            unmet: [],
            confidence: "high",
            blocking: "none",
          }),
        )
      },
    })
    expect(verified.info?.status).toBe("complete")
    expect(verified.info?.tokensUsed).toBe(120)
    expect(verified.info?.verification?.evidenceSha256).toMatch(/^[a-f0-9]{64}$/)
  }),
)

it.live("rejected independent reviews retain unmet requirements for the next worker", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const work = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.update(work, { completed: true })
    yield* f.goals.finish(work, {})
    const result = yield* SessionGoalReview.make(f.goals).run({
      target: f.target,
      kind: "verifying",
      evidence: "The worker says done without any test output",
      stream: () =>
        reviewEvents(
          JSON.stringify({
            achieved: false,
            evidence: "No test evidence",
            unmet: ["Run required tests"],
            confidence: "high",
            blocking: "none",
          }),
        ),
    })
    expect(result.info?.status).toBe("active")
    expect(result.info?.unmet).toEqual(["Run required tests"])
    expect(yield* f.goals.next(f.target, false)).toBe("executing")
  }),
)

for (const response of [
  "not json",
  '{"achieved":true,"evidence":" ","unmet":[]}',
  '{"achieved":true,"evidence":"missing tests","unmet":["Tests"]}',
  '{"achieved":false,"evidence":"unknown","unmet":[]}',
]) {
  it.live(`invalid verifier response pauses without certifying completion: ${response}`, () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const work = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.update(work, { completed: true })
      yield* f.goals.finish(work, {})
      const result = yield* SessionGoalReview.make(f.goals).run({
        target: f.target,
        kind: "verifying",
        evidence: "source evidence",
        stream: () => reviewEvents(response),
      })
      expect(result.info?.status).toBe("infra_paused")
      expect(result.info?.tokensUsed).toBe(30)
      expect(result.info?.history.some((item) => item.event === "completed")).toBe(false)
    }),
  )
}

it.live("provider errors, missing usage, truncated responses and invalid usage pause planning", () =>
  Effect.gen(function* () {
    const streams = [
      Stream.fromIterable<LLMEvent>([{ type: "provider-error", message: "unavailable" }]),
      Stream.fromIterable<LLMEvent>([{ type: "finish", reason: "stop" }]),
      Stream.fromIterable<LLMEvent>([
        { type: "step-finish", index: 0, reason: "length", usage: new Usage({ totalTokens: 12 }) },
      ]),
      reviewEvents('{"plan":"work"}', new Usage({ totalTokens: -1 })),
      reviewEvents('{"plan":" "}'),
    ]
    for (const stream of streams) {
      const f = yield* fixture()
      const result = yield* SessionGoalReview.make(f.goals).run({
        target: f.target,
        kind: "planning",
        evidence: "source evidence",
        stream: () => stream,
      })
      expect(result.info?.status).toBe("infra_paused")
      expect(result.info?.plan).toBeUndefined()
    }
  }),
)

it.live("budget exhaustion during review preserves usage and refuses the verdict", () =>
  Effect.gen(function* () {
    const f = yield* fixture(20)
    const result = yield* SessionGoalReview.make(f.goals).run({
      target: f.target,
      kind: "planning",
      evidence: "source evidence",
      stream: () => reviewEvents('{"plan":"work"}'),
    })
    expect(result.applied).toBe(false)
    expect(result.info?.status).toBe("budget_limited")
    expect(result.info?.tokensUsed).toBe(30)
    expect(result.info?.plan).toBeUndefined()
  }),
)

it.live("review deadlines pause the goal rather than marking it complete", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const result = yield* SessionGoalReview.make(f.goals).run({
      target: f.target,
      kind: "planning",
      evidence: "source evidence",
      timeoutMs: 10,
      stream: () => Stream.fromEffect(Effect.never),
    })
    expect(result.info?.status).toBe("infra_paused")
  }),
)

it.live("late review output cannot overwrite a resumed worker but its actual usage is retained", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const entered = yield* Deferred.make<void>()
    const released = yield* Deferred.make<void>()
    const running = yield* SessionGoalReview.make(f.goals)
      .run({
        target: f.target,
        kind: "planning",
        evidence: "source evidence",
        stream: () =>
          Stream.unwrap(
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(released)),
              Effect.as(reviewEvents('{"plan":"stale plan"}')),
            ),
          ),
      })
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* f.goals.pause(f.target, "user_paused")
    yield* f.goals.resume(f.target)
    const replacement = yield* f.goals.begin(f.target, "executing")
    yield* Deferred.succeed(released, undefined)
    const result = yield* Fiber.join(running)
    expect(result.applied).toBe(false)
    expect(result.info?.status).toBe("active")
    expect(result.info?.tokensUsed).toBe(30)
    expect(result.info?.plan).toBeUndefined()
    expect((yield* f.goals.finish(replacement, {})).status).toBe("active")
  }),
)

it.live("transport defects pause the owned attempt without leaking an active phase", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const result = yield* SessionGoalReview.make(f.goals).run({
      target: f.target,
      kind: "planning",
      evidence: "source evidence",
      stream: () => {
        throw new Error("transport initialization failed")
      },
    })
    expect(result.info?.status).toBe("infra_paused")
    expect(result.info?.phase).toBe("idle")
  }),
)

it.live("cancelled review finalizers cannot pause a resumed attempt", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const entered = yield* Deferred.make<void>()
    const review = yield* SessionGoalReview.make(f.goals)
      .run({
        target: f.target,
        kind: "planning",
        evidence: "source evidence",
        stream: () => Stream.fromEffect(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))),
      })
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* f.goals.pause(f.target, "user_paused")
    yield* f.goals.resume(f.target)
    const replacement = yield* f.goals.begin(f.target, "executing")
    yield* Fiber.interrupt(review)
    expect((yield* f.goals.get(f.target.sessionID))?.status).toBe("active")
    expect((yield* f.goals.finish(replacement, {})).status).toBe("active")
  }),
)

it.live("interruption pauses its own active review and oversize evidence never starts an attempt", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const entered = yield* Deferred.make<void>()
    const reviews = SessionGoalReview.make(f.goals)
    expect(
      yield* failure(
        reviews.run({
          target: f.target,
          kind: "planning",
          evidence: "x".repeat(256001),
          stream: () => Stream.empty,
        }),
      ),
    ).toMatchObject({ code: "invalid" })
    expect((yield* f.goals.get(f.target.sessionID))?.phase).toBe("idle")
    const review = yield* reviews
      .run({
        target: f.target,
        kind: "planning",
        evidence: "source evidence",
        stream: () => Stream.fromEffect(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))),
      })
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* Fiber.interrupt(review)
    expect((yield* f.goals.get(f.target.sessionID))?.status).toBe("user_paused")
  }),
)

const fixture = Effect.fnUntraced(function* (budget?: number) {
  const database = yield* Database.Service
  const goals = SessionGoal.make(database.db)
  const sessionID = SessionID.create()
  const projectID = ProjectV2.ID.make("goal-test-project")
  yield* database.db
    .insert(ProjectTable)
    .values({
      id: projectID,
      worktree: AbsolutePath.make("/tmp"),
      sandboxes: [],
    })
    .onConflictDoNothing()
    .run()
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: projectID,
      slug: "goal-test",
      directory: "/tmp",
      title: "Goal",
      version: "1",
    })
    .run()
  const info = yield* goals.create(sessionID, {
    id: Goal.ID.create(),
    objective: "Implement and verify all requirements",
    tokenBudget: budget,
  })
  return { goals, database, target: { sessionID, goalID: info.id }, info }
})

const failure = <A>(effect: Effect.Effect<A, SessionGoal.Error>) => effect.pipe(Effect.flip)

it.live("Goal contracts preserve exact ID prefix, safe integer budgets and omit absent fields", () =>
  Effect.gen(function* () {
    expect(Goal.ID.create()).toMatch(/^goal_/)
    expect(Schema.is(Goal.ID)("goalbad")).toBe(false)
    const encode = Schema.encodeSync(Goal.Create)
    expect(encode({ id: Goal.ID.create(), objective: "test", tokenBudget: undefined })).not.toHaveProperty(
      "tokenBudget",
    )
    for (const tokenBudget of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(Schema.is(Goal.Create)({ id: Goal.ID.create(), objective: "test", tokenBudget })).toBe(false)
    expect(Schema.is(Goal.Info)({})).toBe(false)
  }),
)

it.live("creation is explicit, durable, idempotent and cannot overwrite an unfinished goal", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    expect(yield* f.goals.get(f.target.sessionID)).toEqual(f.info)
    expect(f.info.tokenBudget).toBeUndefined()
    const retry = yield* f.goals.create(f.target.sessionID, { id: f.info.id, objective: f.info.objective })
    expect(retry.revision).toBe(0)
    expect(yield* failure(f.goals.create(f.target.sessionID, { id: f.info.id, objective: "changed" }))).toMatchObject({
      code: "exists",
    })
    expect(
      yield* failure(f.goals.create(f.target.sessionID, { id: Goal.ID.create(), objective: "replacement" })),
    ).toMatchObject({ code: "exists" })
    expect(
      yield* failure(f.goals.create(SessionID.create(), { id: Goal.ID.create(), objective: "missing" })),
    ).toMatchObject({ code: "missing" })
  }),
)

it.live("concurrent attempts have one owner and stale workers cannot settle after pause/resume", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const results = yield* Effect.all(
      [f.goals.begin(f.target, "executing"), f.goals.begin(f.target, "executing")].map((effect) =>
        Effect.result(effect),
      ),
      { concurrency: "unbounded" },
    )
    expect(results.filter((result) => result._tag === "Success")).toHaveLength(1)
    expect(results.filter((result) => result._tag === "Failure")).toHaveLength(1)
    const work = results.find((result) => result._tag === "Success")!
    if (work._tag !== "Success") throw new Error("No worker")
    yield* f.goals.pause(f.target, "user_paused")
    expect(yield* failure(f.goals.finish(work.success, {}))).toMatchObject({ code: "inactive" })
    yield* f.goals.resume(f.target)
    expect(yield* failure(f.goals.finish(work.success, {}))).toMatchObject({ code: "stale" })
    const next = yield* f.goals.begin(f.target, "executing")
    expect(next.attemptID).not.toBe(work.success.attemptID)
  }),
)

it.live(
  "usage is cumulative per call, concurrent duplicate reports count once and survives new service instances",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const work = yield* f.goals.begin(f.target, "executing")
      yield* Effect.all(
        Array.from({ length: 20 }, () => f.goals.usage(work, "call-1", 100)),
        { concurrency: "unbounded" },
      )
      yield* f.goals.usage(work, "call-1", 75)
      yield* f.goals.usage(work, "call-1", 125)
      yield* f.goals.usage(work, "call-2", 25)
      const reopened = SessionGoal.make(f.database.db)
      expect((yield* reopened.get(f.target.sessionID))?.tokensUsed).toBe(150)
      const before = yield* reopened.get(f.target.sessionID)
      yield* reopened.usage(work, "call-1", 125)
      expect((yield* reopened.get(f.target.sessionID))?.revision).toBe(before?.revision)
      expect(yield* failure(reopened.usage(work, "", 10))).toMatchObject({ code: "invalid" })
      expect(yield* failure(reopened.usage(work, "negative", -1))).toMatchObject({ code: "invalid" })
    }),
)

it.live("budget exhaustion fences workers, counts late real usage and cannot be bypassed by resume", () =>
  Effect.gen(function* () {
    const f = yield* fixture(100)
    const work = yield* f.goals.begin(f.target, "executing")
    expect((yield* f.goals.usage(work, "call", 99)).status).toBe("active")
    expect((yield* f.goals.usage(work, "call", 100)).status).toBe("budget_limited")
    expect(yield* failure(f.goals.resume(f.target))).toMatchObject({ code: "budget" })
    expect(yield* failure(f.goals.update(work, { completed: true }))).toMatchObject({ code: "inactive" })
    expect((yield* f.goals.usage(work, "call", 130)).tokensUsed).toBe(130)
    expect((yield* f.goals.pause(f.target, "user_paused")).status).toBe("budget_limited")
  }),
)

it.live("paused goals retain late usage and unknown or foreign attempts cannot charge a goal", () =>
  Effect.gen(function* () {
    const f = yield* fixture(1000)
    const other = yield* fixture()
    const work = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.pause(f.target, "user_paused")
    expect((yield* f.goals.usage(work, "late", 25)).status).toBe("user_paused")
    expect(
      yield* failure(other.goals.usage({ ...other.target, attemptID: work.attemptID }, "foreign", 100)),
    ).toMatchObject({ code: "stale" })
    expect((yield* f.goals.get(f.target.sessionID))?.tokensUsed).toBe(25)
  }),
)

it.live("completion requests require a separate verifier and cannot self-certify", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    expect(yield* failure(f.goals.begin(f.target, "verifying"))).toMatchObject({ code: "invalid" })
    const work = yield* f.goals.begin(f.target, "executing")
    const pending = yield* f.goals.update(work, { completed: true, message: "All checks passed" })
    expect(pending.status).toBe("active")
    expect((yield* f.goals.update(work, { completed: true })).revision).toBe(pending.revision)
    expect(yield* failure(f.goals.verify(work, { achieved: true, evidence: "self", unmet: [] }))).toMatchObject({
      code: "stale",
    })
    yield* f.goals.finish(work, {})
    expect(yield* failure(f.goals.begin(f.target, "executing"))).toMatchObject({ code: "busy" })
    const verifier = yield* f.goals.begin(f.target, "verifying")
    const done = yield* f.goals.verify(verifier, {
      achieved: true,
      evidence: "Independent checks cover every requirement",
      unmet: [],
    })
    expect(done.status).toBe("complete")
    expect(done.verificationRounds).toBe(1)
    expect(yield* failure(f.goals.resume(f.target))).toMatchObject({ code: "inactive" })
  }),
)

it.live("pausing a verifier wins over its delayed completion verdict", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const work = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.update(work, { completed: true })
    yield* f.goals.finish(work, {})
    const verifier = yield* f.goals.begin(f.target, "verifying")
    yield* f.goals.pause(f.target, "user_paused")
    expect(yield* failure(f.goals.verify(verifier, { achieved: true, evidence: "late", unmet: [] }))).toMatchObject({
      code: "inactive",
    })
    yield* f.goals.resume(f.target)
    expect(yield* failure(f.goals.verify(verifier, { achieved: true, evidence: "late", unmet: [] }))).toMatchObject({
      code: "stale",
    })
    expect((yield* f.goals.get(f.target.sessionID))?.status).toBe("active")
  }),
)

it.live("malformed verification never completes; repeated unmet requirements pause and resume resets the streak", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    for (const round of [1, 2]) {
      const work = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.update(work, { completed: true })
      yield* f.goals.finish(work, {})
      const verifier = yield* f.goals.begin(f.target, "verifying")
      expect(
        yield* failure(f.goals.verify(verifier, { achieved: true, evidence: "claim", unmet: ["tests missing"] })),
      ).toMatchObject({ code: "invalid" })
      expect(yield* failure(f.goals.verify(verifier, { achieved: false, evidence: "", unmet: [] }))).toMatchObject({
        code: "invalid",
      })
      const rejected = yield* f.goals.verify(verifier, {
        achieved: false,
        evidence: "No evidence of CLI validation",
        unmet: [round === 1 ? "CLI tests missing" : " CLI  tests missing "],
      })
      expect(rejected.status).toBe(round === 1 ? "active" : "no_progress_paused")
    }
    yield* f.goals.resume(f.target)
    const work = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.update(work, { completed: true })
    yield* f.goals.finish(work, {})
    const verifier = yield* f.goals.begin(f.target, "verifying")
    expect(
      (yield* f.goals.verify(verifier, { achieved: false, evidence: "Still missing", unmet: ["CLI tests missing"] }))
        .status,
    ).toBe("active")
  }),
)

it.live("different gaps reach the verification cap; infrastructure errors remain paused rather than complete", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    for (const round of [1, 2]) {
      const work = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.update(work, { completed: true })
      yield* f.goals.finish(work, {})
      const verifier = yield* f.goals.begin(f.target, "verifying")
      expect(
        (yield* f.goals.verify(
          verifier,
          { achieved: false, evidence: "Missing checks", unmet: [`requirement ${round}`] },
          2,
        )).status,
      ).toBe(round === 1 ? "active" : "back_off_paused")
    }
    yield* f.goals.resume(f.target)
    const work = yield* f.goals.begin(f.target, "executing")
    expect((yield* f.goals.finish(work, { failure: "Provider unavailable" })).status).toBe("infra_paused")
  }),
)

it.live("blocking needs three distinct worker attempts; repeated update calls in one turn count once", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    for (const round of [1, 2, 3]) {
      const work = yield* f.goals.begin(f.target, "executing")
      for (const _ of [1, 2, 3]) yield* f.goals.update(work, { blocked_reason: "Required credential unavailable" })
      expect((yield* f.goals.get(f.target.sessionID))?.status).toBe("active")
      expect((yield* f.goals.finish(work, {})).status).toBe(round < 3 ? "active" : "blocked")
      expect((yield* failure(f.goals.finish(work, {})))._tag).toBe("GoalConflict")
    }
    yield* f.goals.resume(f.target)
    const work = yield* f.goals.begin(f.target, "executing")
    expect((yield* f.goals.finish(work, { blocker: "Required credential unavailable" })).status).toBe("active")
  }),
)

it.live("three worker rounds without completion back off and unrelated blockers do not become blocked", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    for (const round of [1, 2, 3]) {
      const work = yield* f.goals.begin(f.target, "executing")
      expect((yield* f.goals.finish(work, { blocker: `different failure ${round}` })).status).toBe(
        round < 3 ? "active" : "back_off_paused",
      )
    }
  }),
)

it.live("planning persists its result, does not count as worker round and rejects an empty plan", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const planner = yield* f.goals.begin(f.target, "planning")
    expect(yield* failure(f.goals.finish(planner, {}))).toMatchObject({ code: "invalid" })
    yield* f.goals.usage(planner, "plan-call", 40)
    const result = yield* f.goals.finish(planner, { plan: "1. Implement\n2. Run CLI, Desktop and official comparison" })
    expect(result.plan).toContain("official comparison")
    expect(result.workerRounds).toBe(0)
    expect(result.tokensUsed).toBe(40)
  }),
)

it.live("next phase selects planning, work and pending verification without changing persisted state", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    expect(yield* f.goals.next(f.target)).toBe("planning")
    expect(yield* f.goals.next(f.target, false)).toBe("executing")
    expect((yield* f.goals.get(f.target.sessionID))?.revision).toBe(0)
    const planner = yield* f.goals.begin(f.target, "planning")
    expect(yield* f.goals.next(f.target)).toBeUndefined()
    yield* f.goals.finish(planner, { plan: "Implement and verify" })
    expect(yield* f.goals.next(f.target)).toBe("executing")
    const work = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.update(work, { completed: true })
    expect(yield* f.goals.next(f.target)).toBeUndefined()
    yield* f.goals.finish(work, {})
    expect(yield* f.goals.next(f.target)).toBe("verifying")
    yield* f.goals.pause(f.target, "user_paused")
    expect(yield* f.goals.next(f.target)).toBeUndefined()
  }),
)

it.live("a blocker found at the worker boundary revokes its earlier completion claim", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const work = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.update(work, { completed: true })
    expect(yield* failure(f.goals.update(work, { blocked_reason: "Cannot validate" }))).toMatchObject({
      code: "invalid",
    })
    yield* f.goals.finish(work, { blocker: "Validation failed after the completion request" })
    expect(yield* f.goals.next(f.target, false)).toBe("executing")
    expect(yield* failure(f.goals.begin(f.target, "verifying"))).toMatchObject({ code: "invalid" })
  }),
)

it.live("clearing or replacing a goal fences late workers and cascades the usage ledger", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const work = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.usage(work, "call", 70)
    yield* f.goals.clear(f.target)
    expect(yield* f.goals.get(f.target.sessionID)).toBeUndefined()
    expect(yield* f.database.db.select().from(GoalAttemptTable).all()).toHaveLength(0)
    expect(yield* f.database.db.select().from(GoalUsageTable).all()).toHaveLength(0)
    const next = yield* f.goals.create(f.target.sessionID, { id: Goal.ID.create(), objective: "new goal" })
    expect(next.tokensUsed).toBe(0)
    expect(yield* failure(f.goals.usage(work, "call", 80))).toMatchObject({ code: "stale" })
    expect(yield* failure(f.goals.clear(f.target))).toMatchObject({ code: "stale" })
  }),
)

it.live("deleting the parent session removes goal, attempts and usage", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const work = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.usage(work, "call", 70)
    yield* f.database.db.delete(SessionTable).where(eq(SessionTable.id, f.target.sessionID)).run()
    expect(yield* f.goals.get(f.target.sessionID)).toBeUndefined()
    expect(yield* f.database.db.select().from(GoalAttemptTable).all()).toHaveLength(0)
    expect(yield* f.database.db.select().from(GoalUsageTable).all()).toHaveLength(0)
  }),
)

it.live("unknown persisted status is paused while corrupted ownership and content produce storage errors", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const work = yield* f.goals.begin(f.target, "executing")
    const row = yield* f.database.db.select().from(GoalTable).where(eq(GoalTable.id, f.info.id)).get()
    const state = Schema.decodeUnknownSync(Schema.Struct({ info: Goal.Info }))(row!.data)
    const raw = { ...(row!.data as object), info: { ...state.info, status: "future_autorunning" } }
    yield* f.database.db.update(GoalTable).set({ data: raw }).where(eq(GoalTable.id, f.info.id)).run()
    expect((yield* f.goals.get(f.target.sessionID))?.status).toBe("user_paused")
    expect(yield* failure(f.goals.finish(work, {}))).toMatchObject({ code: "inactive" })
    yield* f.goals.resume(f.target)
    expect(yield* failure(f.goals.finish(work, {}))).toMatchObject({ code: "stale" })
    yield* f.database.db
      .update(GoalTable)
      .set({ data: { ...raw, info: { ...raw.info, sessionID: SessionID.create() } } })
      .run()
    expect((yield* failure(f.goals.get(f.target.sessionID)))._tag).toBe("GoalStorageError")
    yield* f.database.db
      .update(GoalTable)
      .set({ data: { broken: true } })
      .run()
    expect((yield* failure(f.goals.get(f.target.sessionID)))._tag).toBe("GoalStorageError")
  }),
)

it.live("history remains bounded and status reads are side-effect free", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const work = yield* f.goals.begin(f.target, "executing")
    for (const i of Array.from({ length: 100 }, (_, i) => i)) yield* f.goals.update(work, { message: `progress ${i}` })
    const info = yield* f.goals.get(f.target.sessionID)
    expect(info?.history).toHaveLength(64)
    expect(info?.history.at(-1)?.message).toBe("progress 99")
    for (const _ of [1, 2, 3]) expect(yield* f.goals.get(f.target.sessionID)).toEqual(info)
    expect(yield* failure(f.goals.recover(f.target, 0))).toMatchObject({ code: "stale" })
  }),
)

isolated.live("file-backed reopen preserves pending verification and budget, recovery requires explicit resume", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    const f = yield* fixture(1000).pipe(Effect.provide(Database.layerFromPath(`${temp}/goals.sqlite`)))
    const work = yield* Effect.gen(function* () {
      const database = yield* Database.Service
      const goals = SessionGoal.make(database.db)
      const work = yield* goals.begin(f.target, "executing")
      yield* goals.usage(work, "call", 125)
      yield* goals.update(work, { completed: true, message: "Please verify" })
      yield* goals.finish(work, {})
      return yield* goals.begin(f.target, "verifying")
    }).pipe(Effect.provide(Database.layerFromPath(`${temp}/goals.sqlite`)))
    yield* Effect.gen(function* () {
      const database = yield* Database.Service
      const goals = SessionGoal.make(database.db)
      const restored = (yield* goals.get(f.target.sessionID))!
      expect(restored.phase).toBe("verifying")
      expect(restored.tokensUsed).toBe(125)
      const recovered = yield* goals.recover(f.target, restored.revision)
      expect(recovered.status).toBe("user_paused")
      expect(recovered.phase).toBe("idle")
      expect(recovered.elapsedMs).toBe(restored.elapsedMs)
      expect(yield* failure(goals.verify(work, { achieved: true, evidence: "old verifier", unmet: [] }))).toMatchObject(
        { code: "inactive" },
      )
      expect((yield* goals.resume(f.target)).status).toBe("active")
      expect((yield* goals.get(f.target.sessionID))?.tokensUsed).toBe(125)
    }).pipe(Effect.provide(Database.layerFromPath(`${temp}/goals.sqlite`)))
  }),
)

it.live("strategy claims survive pause and reload without weakening the original plan", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* f.goals.finish(yield* f.goals.begin(f.target, "planning"), { plan: "Immutable full contract" })
    for (const round of [1, 2]) {
      yield* f.goals.finish(yield* f.goals.begin(f.target, "executing"), { verify: true })
      yield* f.goals.verify(yield* f.goals.begin(f.target, "verifying"), {
        achieved: false,
        evidence: "Different unmet requirement",
        unmet: [`Requirement ${round}`],
      })
    }
    const attempt = yield* f.goals.begin(f.target, "executing")
    expect((yield* f.goals.claimStrategy(attempt, 3)).claimed).toBe(false)
    const claim = yield* f.goals.claimStrategy(attempt, 2)
    expect(claim.claimed).toBe(true)
    expect((yield* f.goals.claimStrategy(attempt, 2)).claimed).toBe(false)
    yield* f.goals.pause(f.target, "user_paused")
    yield* f.goals.resume(f.target)
    const reloaded = SessionGoal.make(f.database.db)
    const resumed = yield* reloaded.begin(f.target, "executing")
    expect((yield* reloaded.claimStrategy(resumed, 2)).claimed).toBe(false)
    expect(
      yield* failure(
        reloaded.recordStrategy(attempt, {
          ...claim.info.strategy!,
          status: "advised",
          recommendation: "Late advice",
        }),
      ),
    ).toMatchObject({ code: "stale" })
    expect((yield* reloaded.get(f.target.sessionID))?.plan).toBe("Immutable full contract")
  }),
)

for (const mode of ["advised", "empty", "missing-usage", "budget"] as const) {
  it.live(`strategy ${mode} preserves durable usage and owner safety`, () =>
    Effect.gen(function* () {
      const f = yield* fixture(mode === "budget" ? 5 : undefined)
      yield* f.goals.finish(yield* f.goals.begin(f.target, "planning"), { plan: "Immutable criteria" })
      yield* f.goals.finish(yield* f.goals.begin(f.target, "executing"), { verify: true })
      yield* f.goals.verify(yield* f.goals.begin(f.target, "verifying"), {
        achieved: false,
        evidence: "Missing proof",
        unmet: ["Evidence"],
      })
      const attempt = yield* f.goals.begin(f.target, "executing")
      const claim = yield* f.goals.claimStrategy(attempt, 1)
      const result = yield* SessionGoalReview.make(f.goals)
        .strategize({
          attempt: { ...attempt, info: claim.info },
          evidence: "Worker evidence",
          execute: () =>
            Effect.gen(function* () {
              const observer = yield* SessionGoalUsage.Observer
              if (mode === "missing-usage") {
                yield* f.goals.usageMissing(attempt)
                observer?.({ callID: "strategy-call" })
              } else {
                yield* f.goals.usage(attempt, "strategy-call", 7)
                observer?.({ callID: "strategy-call", tokens: 7 })
              }
              return { text: mode === "empty" ? " " : "Inspect a different subsystem", sessionID: SessionID.create() }
            }),
        })
        .pipe(Effect.result)
      const info = (yield* f.goals.get(f.target.sessionID))!
      expect(info.plan).toBe("Immutable criteria")
      expect(info.tokensUsed).toBe(mode === "missing-usage" ? 0 : 7)
      expect(info.status).toBe(
        mode === "budget" ? "budget_limited" : mode === "missing-usage" ? "infra_paused" : "active",
      )
      if (mode === "budget") expect(result._tag).toBe("Failure")
      if (mode === "advised") expect(info.strategy?.recommendation).toBe("Inspect a different subsystem")
      if (mode === "empty") expect(info.strategy?.status).toBe("failed")
      if (mode === "missing-usage") expect(info.usageIncomplete).toBe(true)
    }),
  )
}

const completeForSummary = Effect.fnUntraced(function* (f: Effect.Success<ReturnType<typeof fixture>>) {
  yield* f.goals.finish(yield* f.goals.begin(f.target, "executing"), { verify: true })
  yield* f.goals.verify(yield* f.goals.begin(f.target, "verifying"), {
    achieved: true,
    evidence: "Independent verification passed",
    unmet: [],
  })
})

it.live("terminal summary claims are once-only and cannot authorize ordinary Goal work", () =>
  Effect.gen(function* () {
    const f = yield* fixture(10)
    expect(yield* f.goals.claimSummary(f.target, SessionID.create(), true)).toBeUndefined()
    yield* completeForSummary(f)
    const claim = (yield* f.goals.claimSummary(f.target, SessionID.create(), true))!
    expect(claim.info.status).toBe("complete")
    expect(claim.info.summary?.status).toBe("running")
    expect(yield* f.goals.claimSummary(f.target, SessionID.create(), true)).toBeUndefined()
    expect(yield* failure(f.goals.check(claim))).toMatchObject({ code: "inactive" })
    expect((yield* f.goals.checkSummary(claim, true)).status).toBe("complete")
    yield* SessionGoalUsage.trackTerminal(f.goals, claim, () =>
      Stream.fromIterable([
        { type: "step-finish", index: 0, reason: "stop", usage: new Usage({ totalTokens: 12 }) },
        { type: "finish", reason: "stop", usage: new Usage({ totalTokens: 12 }) },
      ] satisfies LLMEvent[]),
    ).pipe(Stream.runDrain)
    const done = yield* f.goals.finishSummary(claim, { text: "Verified result " + "😀".repeat(1300) })
    expect(done.status).toBe("complete")
    expect(done.tokensUsed).toBe(12)
    expect(done.summary?.tokensUsed).toBe(12)
    expect([...done.summary!.text!]).toHaveLength(1200)
    expect(yield* failure(f.goals.checkSummary(claim))).toMatchObject({ code: "stale" })
    expect(yield* failure(f.goals.finishSummary(claim, { text: "Duplicate" }))).toMatchObject({ code: "stale" })
    yield* f.goals.usage(claim, "late receipt", 3)
    expect((yield* f.goals.get(f.target.sessionID))?.tokensUsed).toBe(15)
    expect((yield* f.goals.get(f.target.sessionID))?.summary?.text).toBe(done.summary?.text)
    expect(yield* SessionGoal.make(f.database.db).claimSummary(f.target, SessionID.create(), true)).toBeUndefined()
  }),
)

for (const mode of ["disabled", "budget", "missing", "cancel", "clear"] as const) {
  it.live(`terminal summary ${mode} preserves completed verification`, () =>
    Effect.gen(function* () {
      const f = yield* fixture(mode === "budget" ? 1 : undefined)
      yield* f.goals.finish(yield* f.goals.begin(f.target, "executing"), { verify: true })
      const verifier = yield* f.goals.begin(f.target, "verifying")
      yield* f.goals.verify(verifier, { achieved: true, evidence: "Verified", unmet: [] })
      if (mode === "budget") yield* f.goals.usage(verifier, "late verifier receipt", 1)
      const claim = yield* f.goals.claimSummary(f.target, SessionID.create(), mode !== "disabled")
      if (mode === "disabled" || mode === "budget") {
        expect(claim).toBeUndefined()
        expect((yield* f.goals.get(f.target.sessionID))?.summary).toMatchObject({ status: "skipped", reason: mode })
      } else {
        expect(claim).toBeDefined()
        if (mode === "clear") {
          yield* f.goals.clear(f.target)
          const replacement = yield* f.goals.create(f.target.sessionID, {
            id: Goal.ID.create(),
            objective: "Replacement",
          })
          expect(yield* failure(f.goals.finishSummary(claim!, { text: "Late" }))).toMatchObject({ code: "stale" })
          expect(yield* failure(f.goals.usage(claim!, "late", 10))).toMatchObject({ code: "stale" })
          expect((yield* f.goals.get(f.target.sessionID))?.id).toBe(replacement.id)
          expect((yield* f.goals.get(f.target.sessionID))?.summary).toBeUndefined()
          return
        }
        if (mode === "missing") {
          yield* SessionGoalUsage.trackTerminal(f.goals, claim!, () => Stream.empty).pipe(Stream.runDrain)
          expect((yield* f.goals.get(f.target.sessionID))?.usageIncomplete).toBe(true)
        }
        yield* f.goals.finishSummary(claim!, { reason: mode === "cancel" ? "interrupted" : "usage" })
        expect((yield* f.goals.get(f.target.sessionID))?.summary?.status).toBe("failed")
      }
      expect((yield* f.goals.get(f.target.sessionID))?.status).toBe("complete")
      expect(yield* f.goals.claimSummary(f.target, SessionID.create(), true)).toBeUndefined()
    }),
  )
}

it.live("summary recovery requires a verified dead owner and never grants another attempt", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* completeForSummary(f)
    const claim = (yield* f.goals.claimSummary(f.target, SessionID.create(), true))!
    yield* f.goals.reconcileSummary(claim)
    expect((yield* f.goals.get(f.target.sessionID))?.summary?.status).toBe("running")
    const child = Bun.spawn([process.execPath, "-e", "process.exit(0)"], { stdout: "ignore", stderr: "ignore" })
    yield* Effect.promise(() => child.exited)
    const row = (yield* f.database.db.select().from(GoalTable).where(eq(GoalTable.id, f.target.goalID)).get())!
    yield* f.database.db
      .update(GoalTable)
      .set({
        data: {
          ...Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(row.data),
          summaryOwner: { pid: child.pid, token: "exited owner" },
        },
      })
      .where(eq(GoalTable.id, f.target.goalID))
      .run()
    const reopened = SessionGoal.make(f.database.db)
    expect((yield* reopened.get(f.target.sessionID))?.summary?.status).toBe("running")
    yield* reopened.reconcileSummary(claim)
    const result = (yield* reopened.get(f.target.sessionID))!
    expect(result.status).toBe("complete")
    expect(result.summary).toMatchObject({ status: "failed", reason: "interrupted" })
    expect(result.usageIncomplete).toBe(true)
    expect(yield* reopened.claimSummary(f.target, SessionID.create(), true)).toBeUndefined()
  }),
)

for (const unknown of [false, true]) {
  it.live(`summary rejects ${unknown ? "unknown usage" : "budget exhaustion"} arriving after its claim`, () =>
    Effect.gen(function* () {
      const f = yield* fixture(5)
      yield* f.goals.finish(yield* f.goals.begin(f.target, "executing"), { verify: true })
      const verifier = yield* f.goals.begin(f.target, "verifying")
      yield* f.goals.verify(verifier, { achieved: true, evidence: "Verified", unmet: [] })
      const claim = (yield* f.goals.claimSummary(f.target, SessionID.create(), true))!
      if (unknown) yield* f.goals.usageMissing(verifier)
      else yield* f.goals.usage(verifier, "late correction", 5)
      const requests = { count: 0 }
      const error = yield* SessionGoalUsage.trackTerminal(f.goals, claim, () => {
        requests.count++
        return Stream.empty
      }).pipe(Stream.runDrain, Effect.flip)
      expect(error).toMatchObject({ code: unknown ? "invalid" : "budget" })
      expect(requests.count).toBe(0)
      expect((yield* f.goals.get(f.target.sessionID))?.status).toBe("complete")
      yield* f.goals.finishSummary(claim, { reason: unknown ? "usage" : "budget" })
      expect((yield* f.goals.get(f.target.sessionID))?.summary?.status).toBe(unknown ? "failed" : "skipped")
    }),
  )
}

const progressPlan =
  "# Plan\n## Acceptance criteria\nKeep the original requirement.\n## Task checklist\n- [ ] First task\n- [ ] Second task\n## Non-goals\n- [ ] Not a task\n"

it.live("plan progress is atomic, monotone, replay-safe and never completes or rewrites the Goal", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* f.goals.finish(yield* f.goals.begin(f.target, "planning"), {
      plan: progressPlan,
    })
    const worker = yield* f.goals.begin(f.target, "executing")
    const input = {
      plan_progress: {
        complete: [1, 0, 1],
        deviation: "  Used a local fixture for unavailable remote data.  ",
      },
    }
    const saved = yield* f.goals.update(worker, input)
    expect(saved.planProgress).toEqual({
      completed: [0, 1],
      deviations: ["Used a local fixture for unavailable remote data."],
    })
    expect(saved.status).toBe("active")
    expect(saved.plan).toBe(progressPlan)
    expect(SessionGoalProgress.next(saved)).toBeUndefined()
    expect(yield* f.goals.update(worker, input)).toEqual(saved)
    expect(yield* f.goals.update(worker, { plan_progress: { complete: [] } })).toEqual(saved)
    expect(
      yield* failure(
        f.goals.update(worker, {
          plan_progress: { complete: [2], deviation: "Must not persist" },
        }),
      ),
    ).toMatchObject({ code: "invalid" })
    expect(yield* f.goals.get(f.target.sessionID)).toEqual(saved)
    expect(yield* failure(f.goals.finish(worker, { plan: "Weakened plan" }))).toMatchObject({ code: "invalid" })
    expect((yield* f.goals.get(f.target.sessionID))?.plan).toBe(progressPlan)
    yield* f.goals.pause(f.target, "user_paused")
    yield* f.goals.resume(f.target)
    expect((yield* f.goals.get(f.target.sessionID))?.planProgress).toEqual(saved.planProgress)
    expect(yield* failure(f.goals.update(worker, input))).toMatchObject({
      code: "stale",
    })
  }),
)

it.live("plan progress requires actual checklist ordinals and cumulatively bounded UTF-8 deviations", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const workerWithoutPlan = yield* f.goals.begin(f.target, "executing")
    expect(
      yield* failure(
        f.goals.update(workerWithoutPlan, {
          plan_progress: { deviation: "No plan yet" },
        }),
      ),
    ).toMatchObject({ code: "invalid" })
    yield* f.goals.finish(workerWithoutPlan, {})
    yield* f.goals.finish(yield* f.goals.begin(f.target, "planning"), {
      plan: progressPlan,
    })
    const worker = yield* f.goals.begin(f.target, "executing")
    const before = yield* f.goals.get(f.target.sessionID)
    for (const patch of [
      { complete: [-1] },
      { complete: [0.5] },
      { complete: [128] },
      { deviation: " " },
      { deviation: "界".repeat(171) },
    ])
      expect(yield* failure(f.goals.update(worker, { plan_progress: patch }))).toMatchObject({ code: "invalid" })
    expect(yield* f.goals.get(f.target.sessionID)).toEqual(before)
    for (let index = 0; index < 16; index++)
      yield* f.goals.update(worker, {
        plan_progress: {
          deviation: `Deviation ${index}: ${"a".repeat(490)}`,
        },
      })
    const full = yield* f.goals.get(f.target.sessionID)
    expect(full?.planProgress?.deviations).toHaveLength(16)
    expect(
      yield* failure(
        f.goals.update(worker, {
          plan_progress: {
            complete: [0],
            deviation: "Seventeenth deviation",
          },
        }),
      ),
    ).toMatchObject({ code: "invalid" })
    expect(yield* f.goals.get(f.target.sessionID)).toEqual(full)
  }),
)

it.live("reviewers and completed or replaced attempts cannot mutate plan progress", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const planner = yield* f.goals.begin(f.target, "planning")
    const patch = { plan_progress: { complete: [0] } }
    expect(yield* failure(f.goals.update(planner, patch))).toMatchObject({
      code: "stale",
    })
    yield* f.goals.finish(planner, { plan: progressPlan })
    const worker = yield* f.goals.begin(f.target, "executing")
    yield* f.goals.update(worker, patch)
    yield* f.goals.finish(worker, { verify: true })
    const verifier = yield* f.goals.begin(f.target, "verifying")
    expect(yield* failure(f.goals.update(verifier, patch))).toMatchObject({
      code: "stale",
    })
    yield* f.goals.verify(verifier, {
      achieved: true,
      evidence: "Verified",
      unmet: [],
    })
    expect(yield* failure(f.goals.update(worker, patch))).toMatchObject({
      code: "inactive",
    })
    const original = yield* f.goals.get(f.target.sessionID)
    yield* f.goals.create(f.target.sessionID, {
      id: Goal.ID.create(),
      objective: "Replacement",
    })
    expect(yield* failure(f.goals.update(worker, patch))).toMatchObject({
      code: "stale",
    })
    expect((yield* f.goals.get(f.target.sessionID))?.planProgress).toBeUndefined()
    expect(original?.plan).toBe(progressPlan)
  }),
)

it.live("compatibility update_goal uses real progress state and permission checks before mutation", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* f.goals.finish(yield* f.goals.begin(f.target, "planning"), {
      plan: progressPlan,
    })
    const worker = yield* f.goals.begin(f.target, "executing")
    const background = yield* BackgroundJob.make
    const tool = GrokBuildTools.adaptTools([], { goals: f.goals, background, profileExtensions: true }).find(
      (tool) => tool.id === "update_goal",
    )!
    const permission: string[] = []
    const context = {
      sessionID: f.target.sessionID,
      messageID: MessageID.ascending("msg_progress"),
      agent: "build",
      abort: new AbortController().signal,
      metadata: () => Effect.void,
      ask: (request: { permission: string }) =>
        Effect.sync(() => {
          permission.push(request.permission)
        }),
      messages: [],
    }
    const invoke = (value: Parameters<typeof tool.execute>[0]) =>
      tool.execute(value, context).pipe(Effect.provideService(SessionGoalUsage.Current, worker))
    const result = yield* invoke({
      plan_progress: { complete: [0], deviation: "Verified first item" },
    })
    expect(permission).toEqual(["update_goal"])
    expect(JSON.parse(result.output).plan_progress.completed).toEqual([0])
    const before = yield* f.goals.get(f.target.sessionID)
    const denied = yield* tool
      .execute({ plan_progress: { complete: [1] } }, { ...context, ask: () => Effect.die("denied") })
      .pipe(Effect.provideService(SessionGoalUsage.Current, worker), Effect.exit)
    expect(denied._tag).toBe("Failure")
    const child = yield* tool
      .execute({ plan_progress: { complete: [1] } }, { ...context, sessionID: SessionID.create() })
      .pipe(Effect.provideService(SessionGoalUsage.Current, worker), Effect.exit)
    expect(child._tag).toBe("Failure")
    expect(yield* f.goals.get(f.target.sessionID)).toEqual(before)
  }),
)
