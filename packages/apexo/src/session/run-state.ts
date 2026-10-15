import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionV1 } from "@apexo/core/v1/session"
import { Goal } from "@apexo/schema/goal"
import { Runner } from "@/effect/runner"
import { BackgroundJob } from "@/background/job"
import { Effect, Latch, Layer, Scope, Context } from "effect"
import { BusyError } from "./errors"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"

export interface Interface {
  readonly control: <A, E>(sessionID: SessionID, action: Effect.Effect<A, E>) => Effect.Effect<A, E | Runner.Cancelled>
  readonly controls: (sessionID: SessionID) => Effect.Effect<void>
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void, BusyError>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly ensureRunning: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts>,
  ) => Effect.Effect<SessionV1.WithParts>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts>,
    ready?: Latch.Latch,
  ) => Effect.Effect<SessionV1.WithParts, BusyError>
  readonly startGoal: (
    sessionID: SessionID,
    goalID: Goal.ID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts>,
  ) => Effect.Effect<SessionV1.WithParts, BusyError>
  readonly cancelGoal: (sessionID: SessionID, goalID: Goal.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/SessionRunState") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.Service
    const background = yield* BackgroundJob.Service
    const status = yield* SessionStatus.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const registrations = new Map<SessionID, { claim: SessionLifecycle.Claim; release: () => void }>()
        const runners = new Map<SessionID, Runner.Runner<SessionV1.WithParts>>()
        const interrupts = new Map<SessionID, { current: Effect.Effect<SessionV1.WithParts> }>()
        const goals = new Map<SessionID, { goalID: Goal.ID; runner: Runner.Runner<SessionV1.WithParts> }>()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            yield* Effect.forEach(runners.values(), (runner) => runner.cancel, {
              concurrency: "unbounded",
              discard: true,
            })
            for (const registration of registrations.values()) registration.release()
            registrations.clear()
            runners.clear()
            interrupts.clear()
            goals.clear()
          }),
        )
        return { runners, interrupts, goals, registrations, scope }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const claim = yield* lifecycle.capture(sessionID).pipe(Effect.orDie)
      const context = yield* Effect.context()
      const registration = data.registrations.get(sessionID)
      if (registration?.claim !== claim) {
        const owner = {}
        const release = yield* lifecycle
          .register(
            claim,
            owner,
            Effect.suspend(() =>
              data.registrations.get(sessionID)?.claim === claim
                ? (data.runners.get(sessionID)?.cancel ?? Effect.void)
                : Effect.void,
            ).pipe(Effect.provide(context)),
          )
          .pipe(Effect.orDie)
        registration?.release()
        data.registrations.set(sessionID, { claim, release })
      }
      const interrupt = data.interrupts.get(sessionID) ?? { current: onInterrupt }
      interrupt.current = onInterrupt
      data.interrupts.set(sessionID, interrupt)
      const existing = data.runners.get(sessionID)
      if (existing) return existing
      const next = Runner.make<SessionV1.WithParts>(data.scope, {
        available: () => lifecycle.available(claim),
        onIdle: Effect.gen(function* () {
          data.runners.delete(sessionID)
          data.interrupts.delete(sessionID)
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy" }),
        onInterrupt: Effect.suspend(() => interrupt.current),
      })
      data.runners.set(sessionID, next)
      return next
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing?.busy) yield* busyError(sessionID)
    })

    const cancel = Effect.fn("SessionRunState.cancel")(function* (sessionID: SessionID) {
      const claim = yield* lifecycle.find(sessionID)
      if (claim && !lifecycle.available(claim)) return
      yield* cancelBackgroundJobs(background, sessionID)
      const data = yield* InstanceState.get(state)
      if (claim && (data.registrations.get(sessionID)?.claim !== claim || !lifecycle.available(claim))) return
      const existing = data.runners.get(sessionID)
      if (!existing) {
        yield* status.set(sessionID, { type: "idle" })
        return
      }
      yield* existing.cancel
    })

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
    ) {
      const bound = yield* lifecycle.bind(sessionID, work).pipe(Effect.orDie)
      return yield* (yield* runner(sessionID, onInterrupt)).ensureRunning(bound.pipe(Effect.orDie))
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
      ready?: Latch.Latch,
    ) {
      const bound = yield* lifecycle.bind(sessionID, work).pipe(Effect.orDie)
      return yield* (yield* runner(sessionID, onInterrupt))
        .startShell(bound.pipe(Effect.orDie), ready)
        .pipe(Effect.catchTag("RunnerBusy", () => Effect.fail(busyError(sessionID))))
    })

    const startGoal = Effect.fn("SessionRunState.startGoal")(function* (
      sessionID: SessionID,
      goalID: Goal.ID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
    ) {
      const bound = yield* lifecycle.bind(sessionID, work).pipe(Effect.orDie)
      const owned = yield* runner(sessionID, onInterrupt)
      const data = yield* InstanceState.get(state)
      const goal = { goalID, runner: owned }
      return yield* owned
        .startExclusive(
          Effect.acquireUseRelease(
            Effect.sync(() => data.goals.set(sessionID, goal)),
            () => bound.pipe(Effect.orDie),
            () =>
              Effect.sync(() => {
                if (data.goals.get(sessionID) === goal) data.goals.delete(sessionID)
              }),
          ),
          goal,
        )
        .pipe(Effect.catchTag("RunnerBusy", () => Effect.fail(busyError(sessionID))))
    })
    const cancelGoal = Effect.fn("SessionRunState.cancelGoal")(function* (sessionID: SessionID, goalID: Goal.ID) {
      const data = yield* InstanceState.get(state)
      const goal = data.goals.get(sessionID)
      // Keep the actual runner reference: a later ordinary prompt may already own this Session ID.
      if (goal?.goalID === goalID) yield* goal.runner.cancelOwned(goal)
      yield* Effect.forEach(
        (yield* background.list()).filter((job) => job.status === "running" && job.metadata?.goalID === goalID),
        (job) => background.cancel(job.id),
        { concurrency: "unbounded", discard: true },
      )
    })
    return Service.of({
      control: (id, action) =>
        Effect.gen(function* () {
          const data = yield* InstanceState.get(state)
          const owned = data.runners.get(id) ?? (yield* runner(id, Effect.die(new Runner.Cancelled())))
          return yield* owned.control(action)
        }).pipe(
          (effect) => lifecycle.read(id, effect),
          Effect.catchTag("SessionLifecycle.Closed", () => Effect.fail(new Runner.Cancelled())),
        ),
      controls: (id) =>
        Effect.gen(function* () {
          const data = yield* InstanceState.get(state)
          yield* data.runners.get(id)?.controls ?? Effect.void
        }),
      assertNotBusy,
      cancel,
      ensureRunning,
      startShell,
      startGoal,
      cancelGoal,
    })
  }),
)

const cancelBackgroundJobs = Effect.fn("SessionRunState.cancelBackgroundJobs")(function* (
  background: BackgroundJob.Interface,
  sessionID: SessionID,
) {
  const jobs = yield* background.list()
  const pending = new Set<string>([sessionID])
  const cancelled = new Set<string>()
  const matches = (job: BackgroundJob.Info) => {
    if (job.status !== "running") return false
    if (cancelled.has(job.id)) return false
    if (pending.has(job.id)) return true
    if (typeof job.metadata?.sessionId === "string" && pending.has(job.metadata.sessionId)) return true
    return typeof job.metadata?.parentSessionId === "string" && pending.has(job.metadata.parentSessionId)
  }
  let batch = jobs.filter(matches)
  while (batch.length > 0) {
    yield* Effect.forEach(
      batch,
      (job) =>
        background.cancel(job.id).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              cancelled.add(job.id)
              pending.add(job.id)
              if (typeof job.metadata?.sessionId === "string") pending.add(job.metadata.sessionId)
            }),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    )
    batch = jobs.filter(matches)
  }
})

function busyError(sessionID: SessionID) {
  return new BusyError({ sessionID })
}

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [SessionLifecycle.node, BackgroundJob.node, SessionStatus.node],
})

export * as SessionRunState from "./run-state"
