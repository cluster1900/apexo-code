import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { randomUUID } from "node:crypto"
import { Cause, Clock, Context, Effect, Exit, Fiber, Layer, Scope, Semaphore } from "effect"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { EventV2 } from "@apexo/core/event"
import { MemoryCatalog } from "@apexo/core/memory-catalog"
import { MemoryWork } from "@apexo/schema/memory-work"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { MemoryManagement } from "./memory-management"
import { SessionMemoryFlush } from "./memory-flush"
import { SessionMemoryDream } from "./memory-dream"
import { Session } from "./session"
import { SessionID } from "./schema"

export interface Interface {
  readonly get: (id: SessionID) => Effect.Effect<MemoryWork.Info | null, MemoryCatalog.Error>
  readonly start: (id: SessionID, kind: MemoryWork.Kind) => Effect.Effect<MemoryWork.Info, MemoryCatalog.Error>
  readonly cancel: (id: SessionID, operationID: string) => Effect.Effect<MemoryWork.Info, MemoryCatalog.Error>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMemoryWork") {}
type Entry = { info: MemoryWork.Info; fiber?: Fiber.Fiber<void> }

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.Service
    const management = yield* MemoryManagement.Service
    const flush = yield* SessionMemoryFlush.Service
    const dream = yield* SessionMemoryDream.Service
    const events = yield* EventV2Bridge.Service
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        const entries = new Map<SessionID, Entry>()
        const scope = yield* Scope.Scope
        const lock = yield* Semaphore.make(1)
        const unsubscribe = yield* events.listen((event) =>
          Effect.gen(function* () {
            if (event.type !== Session.Event.Deleted.type) return
            const id = (event.data as EventV2.Data<typeof Session.Event.Deleted>).sessionID
            const current = entries.get(id)
            entries.delete(id)
            if (current?.fiber) yield* Fiber.interrupt(current.fiber)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        return { entries, scope, lock }
      }),
    )
    return Service.of({
      get: Effect.fn("SessionMemoryWork.get")(
        function* (id) {
          yield* management.status(id)
          const data = yield* InstanceState.get(state)
          return data.entries.get(id)?.info ?? null
        },
        (effect, id) =>
          lifecycle
            .read(id, effect)
            .pipe(
              Effect.catchTag("SessionLifecycle.Closed", () =>
                Effect.fail(new MemoryCatalog.Error({ reason: "not_found", message: "Session no longer exists" })),
              ),
            ),
      ),
      start: Effect.fn("SessionMemoryWork.start")(
        function* (id, kind) {
          const mode = yield* management.status(id)
          const data = yield* InstanceState.get(state)
          return yield* data.lock.withPermit(
            Effect.gen(function* () {
              const previous = data.entries.get(id)
              if (previous?.info.state === "running") {
                if (previous.info.kind !== kind)
                  return yield* new MemoryCatalog.Error({
                    reason: "changed",
                    message: "Another memory operation is running",
                  })
                return previous.info
              }
              const entry: Entry = {
                info: { id: randomUUID(), kind, state: "running", startedAt: yield* Clock.currentTimeMillis },
              }
              data.entries.set(id, entry)
              const work = !mode.enabled
                ? Effect.succeed({ status: "disabled" } as const)
                : mode.busy
                  ? Effect.succeed({ status: "busy" } as const)
                  : kind === "flush"
                    ? flush.manual(id)
                    : dream.run(id, { manual: true })
              entry.fiber = yield* work.pipe(
                Effect.interruptible,
                Effect.onExit((exit) =>
                  Effect.gen(function* () {
                    entry.info = {
                      ...entry.info,
                      state: "finished",
                      finishedAt: yield* Clock.currentTimeMillis,
                      result: Exit.isSuccess(exit)
                        ? exit.value
                        : { status: Cause.hasInterrupts(exit.cause) ? "cancelled" : "failed" },
                    }
                  }),
                ),
                Effect.asVoid,
                Effect.forkIn(data.scope),
              )
              return entry.info
            }).pipe(Effect.uninterruptible),
          )
        },
        (effect, id, _kind) =>
          lifecycle
            .use(id, effect)
            .pipe(
              Effect.catchTag("SessionLifecycle.Closed", () =>
                Effect.fail(new MemoryCatalog.Error({ reason: "not_found", message: "Session no longer exists" })),
              ),
            ),
      ),
      cancel: Effect.fn("SessionMemoryWork.cancel")(
        function* (id, operationID) {
          yield* management.status(id)
          const data = yield* InstanceState.get(state)
          const entry = data.entries.get(id)
          if (!entry || entry.info.id !== operationID)
            return yield* new MemoryCatalog.Error({ reason: "not_found", message: "Memory operation not found" })
          if (entry.info.state === "running" && entry.fiber) yield* Fiber.interrupt(entry.fiber)
          return entry.info
        },
        (effect, id, _operationID) =>
          lifecycle
            .read(id, effect)
            .pipe(
              Effect.catchTag("SessionLifecycle.Closed", () =>
                Effect.fail(new MemoryCatalog.Error({ reason: "not_found", message: "Session no longer exists" })),
              ),
            ),
      ),
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    SessionLifecycle.node,
    MemoryManagement.node,
    SessionMemoryFlush.node,
    SessionMemoryDream.node,
    EventV2Bridge.node,
  ],
})
export * as SessionMemoryWork from "./memory-work"
