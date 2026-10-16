export * as SessionTaskControl from "./task-control"

import { Context, Deferred, Effect, Layer, Option } from "effect"
import { Task } from "@apexo/schema/task"
import { BackgroundJob } from "../background-job"
import { makeGlobalNode } from "../effect/app-node"
import { SessionLifecycle } from "./lifecycle"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { SessionTaskMessage } from "./task-message"
import { SessionTaskStore } from "./task-store"

const make = Effect.gen(function* () {
  const messages = yield* SessionTaskMessage.Service
  const tasks = yield* SessionTaskStore.Service
  const sessions = yield* SessionStore.Service
  const lifecycle = yield* SessionLifecycle.Service
  const jobs = yield* BackgroundJob.Service
  // BackgroundJob's cancellation notification precedes scope closure. These latches
  // acknowledge the Task worker's joined finalizers and durable terminal receipt.
  const settling = new Map<string, Deferred.Deferred<void, SessionTaskStore.Failure>>()
  const settlement = (id: string) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        if (settling.has(id)) throw new Error("Task launch already has a settlement owner")
        const done = Deferred.makeUnsafe<void, SessionTaskStore.Failure>()
        settling.set(id, done)
        return {
          done,
          wait: Deferred.await(done),
          finish: tasks.launch(id).pipe(
            Effect.flatMap((receipt) =>
              receipt && receipt.status !== "running"
                ? Deferred.succeed(done, undefined)
                : Deferred.fail(
                    done,
                    new SessionTaskStore.Failure({ code: "stale", message: "Task terminal receipt is unavailable" }),
                  ),
            ),
            Effect.catch((error) => Deferred.fail(done, error)),
          ),
        }
      }),
      (value) =>
        Deferred.fail(
          value.done,
          new SessionTaskStore.Failure({ code: "stale", message: "Task settlement owner closed before its receipt" }),
        ).pipe(
          Effect.andThen(
            Effect.sync(() => {
              if (settling.get(id) === value.done) settling.delete(id)
            }),
          ),
        ),
    )
  const summary = (record: SessionTaskStore.Record, launch: SessionTaskStore.Launch): Task.Summary => ({
    id: record.sessionID,
    parentSessionID: record.parentID,
    description: launch.request.description,
    background: launch.request.background || undefined,
    status: launch.status === "running" && launch.owner !== tasks.owner ? "interrupted" : launch.status,
    startedAt: launch.createdAt,
    completedAt: launch.completedAt,
    blockedReason: launch.status === "running" && launch.owner !== tasks.owner ? "process_restart" : undefined,
  })
  const resolveOwned = (callerID: SessionSchema.ID, childID: SessionSchema.ID, launchID?: string) =>
    Effect.gen(function* () {
      const direct = yield* tasks.owned(callerID, childID).pipe(Effect.result)
      const record =
        direct._tag === "Success"
          ? direct.success
          : direct.failure.code === "missing"
            ? yield* tasks.descendant(callerID, childID)
            : yield* Effect.fail(direct.failure)
      const launch = yield* launchID ? tasks.launch(launchID) : tasks.latest(record.parentID, childID)
      if (!launch || launch.parentID !== record.parentID || launch.sessionID !== childID)
        return yield* new SessionTaskStore.Failure({ code: "missing", message: "Task has no launch receipt" })
      if (record.parentID !== callerID && !launch.request.background)
        return yield* new SessionTaskStore.Failure({ code: "missing", message: "Task does not belong to this Session" })
      return { record, launch }
    })
  const output = (callerID: SessionSchema.ID, childID: SessionSchema.ID, launchID?: string) =>
    lifecycle.read(
      callerID,
      Effect.gen(function* () {
        const { record, launch } = yield* resolveOwned(callerID, childID, launchID)
        const reply = launch.replyID ? yield* sessions.message(launch.replyID) : undefined
        const text =
          reply?.sessionID === childID && reply.message.type === "assistant"
            ? reply.message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n")
            : (launch.message ?? "")
        return {
          ...summary(record, launch),
          ...(record.placement?.mode === "worktree" ? { worktreePath: record.placement.directory } : {}),
          output:
            launch.status === "running" && launch.owner !== tasks.owner
              ? "Task execution was interrupted by process restart; start a new Task"
              : text,
        }
      }),
    )
  const list = (parentID: SessionSchema.ID, limit = 50) =>
    lifecycle.read(
      parentID,
      Effect.gen(function* () {
        const records = yield* tasks.list(parentID, limit)
        const values = yield* Effect.forEach(records, (record) =>
          tasks.latest(parentID, record.sessionID).pipe(
            Effect.map((launch) => (launch ? summary(record, launch) : undefined)),
            Effect.catchTag("SessionTaskFailure", (error) =>
              error.code === "missing" ? Effect.succeed(undefined) : Effect.fail(error),
            ),
          ),
        )
        return values.filter((value): value is Task.Summary => value !== undefined)
      }),
    )
  const wait = (callerID: SessionSchema.ID, childID: SessionSchema.ID, timeout: number) =>
    lifecycle.read(
      callerID,
      Effect.gen(function* () {
        const { launch } = yield* resolveOwned(callerID, childID)
        const done = settling.get(launch.id)
        const settled = done && (yield* Deferred.isDone(done))
        if (done && settled) yield* Deferred.await(done)
        const timedOut = done
          ? !settled && (timeout <= 0 || Option.isNone(yield* Deferred.await(done).pipe(Effect.timeoutOption(timeout))))
          : launch.owner === tasks.owner && launch.status === "running"
        return { task: yield* output(callerID, childID), timedOut: Boolean(timedOut) }
      }),
    )
  const cancelSubtree = (
    parentID: SessionSchema.ID,
    childID: SessionSchema.ID,
    strictStarting: boolean,
  ): Effect.Effect<void, SessionTaskStore.Failure> =>
    Effect.gen(function* () {
      const launch = yield* tasks.latest(parentID, childID)
      if (launch?.owner === tasks.owner) {
        const done = settling.get(launch.id)
        if (launch.status === "running") {
          yield* messages.close(launch.id, "cancelled")
          const cancelled = yield* jobs.cancel(launch.id)
          if (!cancelled && (yield* tasks.launch(launch.id))?.status === "running") {
            if (strictStarting)
              return yield* new SessionTaskStore.Failure({
                code: "busy",
                message: "Task worker is still starting; retry cancellation after it is registered",
              })
          }
        }
        if (done) yield* Deferred.await(done)
      }
      const grandchildren = yield* tasks
        .children(childID)
        .pipe(Effect.catchTag("SessionTaskFailure", () => Effect.succeed([])))
      for (const grandchild of grandchildren) {
        yield* cancelSubtree(childID, grandchild.sessionID, false).pipe(
          Effect.catchTag("SessionTaskFailure", () => Effect.void),
        )
      }
    })
  const cancelChildren = (parentID: SessionSchema.ID) =>
    Effect.gen(function* () {
      const children = yield* tasks
        .children(parentID)
        .pipe(Effect.catchTag("SessionTaskFailure", () => Effect.succeed([])))
      for (const child of children) {
        yield* cancelSubtree(parentID, child.sessionID, false).pipe(
          Effect.catchTag("SessionTaskFailure", () => Effect.void),
        )
      }
    })
  const cancel = (callerID: SessionSchema.ID, childID: SessionSchema.ID) =>
    lifecycle.read(
      callerID,
      Effect.gen(function* () {
        const { record } = yield* resolveOwned(callerID, childID)
        yield* cancelSubtree(record.parentID, childID, true)
        return yield* output(callerID, childID)
      }),
    )
  return {
    output: (callerID: SessionSchema.ID, childID: SessionSchema.ID) => output(callerID, childID),
    /** Internal exact-launch projection; public output deliberately selects the latest launch. */
    receipt: (parentID: SessionSchema.ID, childID: SessionSchema.ID, launchID: string) =>
      output(parentID, childID, launchID),
    wait,
    cancel,
    cancelChildren,
    list,
    settlement,
  }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/SessionTaskControl") {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [SessionTaskMessage.node, SessionTaskStore.node, SessionStore.node, SessionLifecycle.node, BackgroundJob.node],
})
