export * as SessionProcessControl from "./process-control"

import { Context, Deferred, Effect, Layer, Option } from "effect"
import { SessionProcess } from "@apexo/schema/session-process"
import { BackgroundJob } from "../background-job"
import { makeGlobalNode } from "../effect/app-node"
import { SessionLifecycle } from "./lifecycle"
import { SessionProcessStore } from "./process-store"
import { SessionSchema } from "./schema"

const make = Effect.gen(function* () {
  const processes = yield* SessionProcessStore.Service
  const lifecycle = yield* SessionLifecycle.Service
  const jobs = yield* BackgroundJob.Service
  const workers = new Map<
    SessionProcess.ID,
    {
      readonly started: Deferred.Deferred<void, SessionProcessStore.Failure>
      readonly done: Deferred.Deferred<void, SessionProcessStore.Failure>
    }
  >()
  const output = (sessionID: SessionSchema.ID, id: SessionProcess.ID) =>
    Effect.gen(function* () {
      const record = yield* processes.owned(sessionID, id)
      if (!record.spawned && record.status === "running" && record.owner === processes.owner)
        return yield* new SessionProcessStore.Failure({ code: "busy", message: "Shell process is still starting" })
      return processes.detail(record)
    })
  return {
    // Acquired in the concrete worker's scope before BackgroundJob can fork it.
    // Its finalizer joins terminal storage and releases every admission waiter.
    settlement: (record: SessionProcessStore.Record) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          if (workers.has(record.id)) throw new Error("Shell process already has a settlement owner")
          const worker = {
            started: Deferred.makeUnsafe<void, SessionProcessStore.Failure>(),
            done: Deferred.makeUnsafe<void, SessionProcessStore.Failure>(),
          }
          workers.set(record.id, worker)
          return {
            waitStarted: Deferred.await(worker.started),
            wait: Deferred.await(worker.done),
            started: processes
              .started(record.sessionID, record.id)
              .pipe(Effect.andThen(Deferred.succeed(worker.started, undefined)), Effect.asVoid),
            finish: processes.owned(record.sessionID, record.id).pipe(
              Effect.flatMap((current) =>
                current.status === "running"
                  ? Deferred.fail(
                      worker.done,
                      new SessionProcessStore.Failure({
                        code: "stale",
                        message: "Shell terminal receipt is unavailable",
                      }),
                    )
                  : Deferred.succeed(worker.done, undefined),
              ),
              Effect.catch((error) => Deferred.fail(worker.done, error)),
              Effect.andThen(
                Deferred.fail(
                  worker.started,
                  new SessionProcessStore.Failure({ code: "invalid", message: "Shell process did not start" }),
                ),
              ),
              Effect.asVoid,
            ),
            worker,
          }
        }),
        (value) =>
          Effect.gen(function* () {
            const failure = new SessionProcessStore.Failure({
              code: "stale",
              message: "Shell process owner closed before settlement",
            })
            yield* Deferred.fail(value.worker.started, failure)
            yield* Deferred.fail(value.worker.done, failure)
            if (workers.get(record.id) === value.worker) workers.delete(record.id)
          }),
      ),
    list: (sessionID: SessionSchema.ID, limit = 50) => lifecycle.read(sessionID, processes.list(sessionID, limit)),
    output: (sessionID: SessionSchema.ID, id: SessionProcess.ID) => lifecycle.read(sessionID, output(sessionID, id)),
    wait: (sessionID: SessionSchema.ID, id: SessionProcess.ID, timeout: number) =>
      lifecycle.read(
        sessionID,
        Effect.gen(function* () {
          const record = yield* processes.owned(sessionID, id)
          const worker = record.owner === processes.owner ? workers.get(id) : undefined
          const settled = worker && (yield* Deferred.isDone(worker.done))
          if (worker && settled) yield* Deferred.await(worker.done)
          const timedOut = worker
            ? !settled &&
              (timeout <= 0 || Option.isNone(yield* Deferred.await(worker.done).pipe(Effect.timeoutOption(timeout))))
            : record.owner === processes.owner && record.status === "running"
          return { process: yield* output(sessionID, id), timedOut: Boolean(timedOut) }
        }),
      ),
    cancel: (sessionID: SessionSchema.ID, id: SessionProcess.ID) =>
      lifecycle.read(
        sessionID,
        Effect.gen(function* () {
          const record = yield* processes.owned(sessionID, id)
          if (record.owner !== processes.owner || record.status !== "running") return processes.detail(record)
          const worker = workers.get(id)
          const cancelled = yield* jobs.cancel(id)
          if (!cancelled && (yield* processes.owned(sessionID, id)).status === "running")
            return yield* new SessionProcessStore.Failure({
              code: "busy",
              message: "Shell process is still starting; retry cancellation",
            })
          if (worker) yield* Deferred.await(worker.done)
          return yield* output(sessionID, id)
        }).pipe(Effect.uninterruptible),
      ),
  }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/SessionProcessControl") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [SessionProcessStore.node, SessionLifecycle.node, BackgroundJob.node],
})
