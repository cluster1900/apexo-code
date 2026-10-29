import { SessionChildPlacementAccess } from "../child-placement-access"
import { SessionScheduleOwner } from "../schedule-owner"
import { SessionMemoryObserver } from "../memory-observer"
import { SessionMemoryOperation } from "../memory-operation"
import { SessionPlanReceipt } from "../plan-receipt"
import { SessionManagedChild } from "../managed-child"
import { SessionLifecycle } from "../lifecycle"
import { SessionProcessCompletion } from "../process-completion"
import { SessionTaskCompletion } from "../task-completion"
import { SessionHookSnapshot } from "../hook-snapshot"
import { HookObserver } from "../../hook-observer"
import { Cause, Effect, Layer } from "effect"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"
import { LocationRuntimeGuard } from "../../location-runtime-guard"
import { SessionExecutionStore } from "../execution-store"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const memory = yield* SessionMemoryOperation.Service
    const managed = yield* SessionManagedChild.Service
    const lifecycle = yield* SessionLifecycle.Service
    const scheduleOwners = yield* SessionScheduleOwner.Service
    const completions = yield* SessionTaskCompletion.Service
    const planReceipts = yield* SessionPlanReceipt.Service
    const processCompletions = yield* SessionProcessCompletion.Service
    const store = yield* SessionStore.Service
    const snapshots = yield* SessionHookSnapshot.Service
    const locations = yield* LocationServiceMap.Service
    const guard = yield* LocationRuntimeGuard.Service
    const executionStore = yield* SessionExecutionStore.Service
    const memoryObserver = (claim: SessionLifecycle.Claim, epoch: SessionMemoryOperation.AutomaticEpoch) => ({
      sessionID: claim.sessionID,
      capture: (stopped?: import("../message").SessionMessage.ID, launch = true) =>
        lifecycle.owned(claim, memory.capture(claim.sessionID, stopped, launch)).pipe(
          Effect.catch(() => Effect.void),
          Effect.asVoid,
        ),
      beforeCompaction: (boundary: import("../compaction").SessionCompaction.MemoryBoundary) =>
        memory.prepareAutomaticCompaction(epoch, boundary),
      checkpoint: lifecycle.owned(claim, memory.checkpoint(claim.sessionID)).pipe(Effect.catch(() => Effect.void)),
    })
    const placementAccess = (claim: SessionLifecycle.Claim): SessionChildPlacementAccess.Capability => ({
      parentID: claim.sessionID,
      inspect: (location, effect) =>
        lifecycle.owned(
          claim,
          guard.use(
            location,
            Effect.scoped(
              effect.pipe(
                Effect.provide(locations.get({ directory: location.directory, workspaceID: location.workspaceID })),
              ),
            ),
          ),
        ),
    })
    const cancelling = new Set<SessionSchema.ID>()
    const coordinator: SessionRunCoordinator.Coordinator<SessionLifecycle.Claim, SessionRunner.RunError> =
      yield* SessionRunCoordinator.make<SessionLifecycle.Claim, SessionRunner.RunError>({
        available: lifecycle.available,
        drain: Effect.fnUntraced(function* (claim: SessionLifecycle.Claim, force, controls) {
          const epoch = yield* memory.beginAutomaticActivity(claim)
          const sessionID = claim.sessionID
          const session = yield* store.get(sessionID)
          if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
          let lease: SessionExecutionStore.Lease | undefined
          const assertOwner = Effect.uninterruptible(
            Effect.gen(function* () {
              if (!lease) {
                lease = yield* executionStore.claim(sessionID)
                return
              }
              yield* executionStore.assert(lease)
            }),
          )
          return yield* SessionRunner.Service.use((runner) =>
            runner.run({
              sessionID,
              force,
              controls,
              children: children(claim),
            }),
          ).pipe(
            Effect.provideService(SessionExecutionStore.Current, assertOwner),
            Effect.onExit((exit) =>
              lease
                ? executionStore.finish(
                    lease,
                    exit._tag === "Success" ? "completed" : Cause.hasInterrupts(exit.cause) ? "interrupted" : "failed",
                    exit._tag === "Failure" ? String(Cause.squash(exit.cause)) : undefined,
                  )
                : Effect.void,
            ),
            Effect.provideService(SessionMemoryObserver.Current, memoryObserver(claim, epoch)),
            Effect.provideService(SessionChildPlacementAccess.Current, placementAccess(claim)),
            Effect.provide(locations.get(session.location)),
            (effect) => lifecycle.owned(claim, effect),
            (effect) => guard.use(session.location, effect),
            Effect.onInterrupt(() =>
              !session.parentID && cancelling.has(sessionID)
                ? Effect.gen(function* () {
                    const hook = yield* snapshots.get(sessionID)
                    return yield* HookObserver.observe({
                      registry: hook?.registry,
                      selection: hook?.selection,
                      directory: session.location.directory,
                      sessionID,
                      event: "StopCancelled",
                      matcher: "user_interrupt",
                      payload: { reason: "user_interrupt", cancelledBy: "user", cancelTrigger: "stop_gesture" },
                    })
                  })
                : Effect.void,
            ),
            Effect.tap(() =>
              memory.armAutomaticIdle(epoch, {
                settled: coordinator.wait(claim).pipe(Effect.catchCause(() => Effect.interrupt)),
                idle: coordinator.active.pipe(Effect.map((claims) => !claims.has(claim))),
              }),
            ),
            Effect.tapCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
            ),
          )
        }),
      })

    const owner = {}
    const prepare = (sessionID: SessionSchema.ID) =>
      Effect.gen(function* () {
        const claim = yield* lifecycle.capture(sessionID)
        yield* lifecycle.register(claim, owner, coordinator.interrupt(claim))
        return claim
      })
    const resume = (sessionID: SessionSchema.ID) =>
      prepare(sessionID).pipe(
        Effect.flatMap(coordinator.run),
        Effect.catchTag("SessionLifecycle.Closed", () => Effect.interrupt),
      )
    // Public callers may join ordinary Sessions. Managed children enter only through CurrentChildren.run.
    const publicClaim = (sessionID: SessionSchema.ID) =>
      lifecycle.read(
        sessionID,
        Effect.gen(function* () {
          const claim = yield* lifecycle.capture(sessionID)
          if (yield* managed.managed(sessionID))
            return yield* new SessionManagedChild.Failure({
              code: "invalid",
              message: "Managed children require their owning Task, Workflow run or Goal attempt",
            })
          return claim
        }),
      )
    const interrupt = (sessionID: SessionSchema.ID) =>
      lifecycle.find(sessionID).pipe(Effect.flatMap((claim) => (claim ? coordinator.interrupt(claim) : Effect.void)))
    const children = (claim: SessionLifecycle.Claim): SessionRunner.Children => ({
      active: Effect.map(coordinator.active, (claims) => new Set([...claims].map((claim) => claim.sessionID))),
      run: resume,
      interrupt,
      notify: (parentID) =>
        parentID === claim.sessionID ? lifecycle.owned(claim, coordinator.wake(claim)) : Effect.void,
    })
    yield* executionStore.recoverable.pipe(
      Effect.flatMap((sessions) =>
        Effect.forEach(sessions, (sessionID) =>
          Effect.gen(function* () {
            if (yield* managed.managed(sessionID)) {
              yield* executionStore.interruptStale(sessionID)
              return
            }
            const claim = yield* publicClaim(sessionID)
            yield* lifecycle.owned(
              claim,
              Effect.gen(function* () {
                if (!(yield* memory.pendingInput(claim))) {
                  yield* executionStore.interruptStale(sessionID)
                  return
                }
                yield* prepare(sessionID).pipe(Effect.flatMap(coordinator.wake))
              }),
            )
          }).pipe(Effect.catch(() => Effect.void)),
        ),
      ),
      Effect.catch(() => Effect.void),
      Effect.forkScoped,
    )
    const control: SessionExecution.Interface["control"] = (sessionID, action) =>
      prepare(sessionID).pipe(
        Effect.flatMap((claim) =>
          coordinator.control(
            claim,
            lifecycle.owned(
              claim,
              memory
                .beginAutomaticActivity(claim)
                .pipe(
                  Effect.andThen(action),
                  Effect.provideService(SessionRunner.CurrentChildren, children(claim)),
                  Effect.provideService(SessionChildPlacementAccess.Current, placementAccess(claim)),
                ),
            ),
          ),
        ),
        Effect.catchTag("SessionLifecycle.Closed", () => Effect.fail(new SessionRunCoordinator.ControlCancelled())),
      )
    return SessionExecution.Service.of({
      active: Effect.map(coordinator.active, (claims) => new Set([...claims].map((claim) => claim.sessionID))),
      wait: (sessionID) =>
        lifecycle.find(sessionID).pipe(Effect.flatMap((claim) => (claim ? coordinator.wait(claim) : Effect.void))),
      control: (sessionID, operation) =>
        control(
          sessionID,
          Effect.gen(function* () {
            const session = yield* store.get(sessionID)
            if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
            return yield* guard.use(session.location, operation)
          }),
        ),
      compact: (sessionID) =>
        control(
          sessionID,
          Effect.gen(function* () {
            const session = yield* store.get(sessionID)
            if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
            const claim = yield* lifecycle
              .capture(sessionID)
              .pipe(
                Effect.catchTag("SessionLifecycle.Closed", () =>
                  Effect.fail(new SessionRunCoordinator.ControlCancelled()),
                ),
              )
            const epoch = yield* memory.beginAutomaticActivity(claim)
            return yield* SessionRunner.Service.use((runner) => runner.compact(sessionID)).pipe(
              Effect.provideService(SessionMemoryObserver.Current, memoryObserver(claim, epoch)),
              Effect.provide(locations.get(session.location)),
              (effect) => guard.use(session.location, effect),
            )
          }),
        ),
      interrupt: Effect.fn("SessionExecution.interruptWithHooks")(function* (sessionID, when) {
        const claim = yield* lifecycle.find(sessionID)
        if (!claim) return
        const capture = { accepted: false, scheduleStopped: false }
        if (!when && scheduleOwners.checkpoint(claim)()) {
          scheduleOwners.stop(claim)
          capture.scheduleStopped = true
        }
        yield* coordinator
          .interrupt(claim, () => {
            if (when && !when()) return false
            completions.stop(claim)
            planReceipts.stop(claim)
            processCompletions.stop(claim)
            scheduleOwners.stop(claim)
            memory.stopAutomatic(claim)
            capture.accepted = true
            capture.scheduleStopped = true
            cancelling.add(sessionID)
            return true
          })
          .pipe(
            Effect.ensuring(
              Effect.suspend(() => (capture.scheduleStopped ? scheduleOwners.joinStop(claim) : Effect.void)),
            ),
            Effect.ensuring(Effect.suspend(() => (capture.accepted ? memory.joinAutomaticStop(claim) : Effect.void))),
            Effect.ensuring(
              Effect.sync(() => {
                if (capture.accepted) cancelling.delete(sessionID)
              }),
            ),
          )
      }),
      resume: (sessionID) =>
        publicClaim(sessionID).pipe(
          Effect.flatMap((claim) => lifecycle.owned(claim, resume(sessionID))),
          Effect.catchTag("SessionLifecycle.Closed", () => Effect.interrupt),
        ),
      wake: (sessionID) =>
        publicClaim(sessionID).pipe(
          Effect.flatMap((claim) =>
            lifecycle.owned(
              claim,
              Effect.gen(function* () {
                if (!(yield* memory.pendingInput(claim))) return
                yield* prepare(sessionID).pipe(Effect.flatMap(coordinator.wake))
              }),
            ),
          ),
          Effect.catchTag("SessionManagedChildFailure", () => Effect.void),
          Effect.catchTag("SessionLifecycle.Closed", () => Effect.void),
        ),
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [
    SessionScheduleOwner.node,
    SessionMemoryOperation.node,
    SessionManagedChild.node,
    SessionLifecycle.node,
    SessionTaskCompletion.node,
    SessionPlanReceipt.node,
    SessionProcessCompletion.node,
    SessionStore.node,
    LocationServiceMap.node,
    SessionHookSnapshot.node,
    LocationRuntimeGuard.node,
    SessionExecutionStore.node,
  ],
})

export * as SessionExecutionLocal from "./local"
