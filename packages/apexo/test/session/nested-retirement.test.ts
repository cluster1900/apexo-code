import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionSchema } from "@apexo/core/session/schema"

test(
  "nested retirement joins a held child finalizer",
  () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* SessionLifecycle.make
          const parent = SessionSchema.ID.create()
          const child = SessionSchema.ID.create()
          const entered = yield* Deferred.make<void>()
          const stopped = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const worker = yield* lifecycle
            .run(
              child,
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(stopped, undefined).pipe(Effect.andThen(Deferred.await(release)))),
              ),
            )
            .pipe(Effect.exit, Effect.forkChild)
          yield* Deferred.await(entered)
          yield* Effect.gen(function* () {
            const deletion = yield* lifecycle
              .retire(parent, lifecycle.retire(child, Effect.void))
              .pipe(Effect.forkChild)
            yield* Deferred.await(stopped).pipe(Effect.timeout("2 seconds"))
            expect(deletion.pollUnsafe()).toBeUndefined()
            yield* Deferred.succeed(release, undefined)
            yield* Fiber.join(worker).pipe(Effect.timeout("2 seconds"))
            yield* Fiber.join(deletion).pipe(Effect.timeout("2 seconds"))
            expect(deletion.pollUnsafe()?._tag).toBe("Success")
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
        }),
      ),
    ),
  10000,
)

test(
  "nested retirement joins a child after independent sibling retirement",
  () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* SessionLifecycle.make
          const parent = SessionSchema.ID.create()
          const children = [SessionSchema.ID.create(), SessionSchema.ID.create()]
          const workers = yield* Effect.forEach(children, (id) =>
            Effect.gen(function* () {
              const entered = yield* Deferred.make<void>()
              const stopped = yield* Deferred.make<void>()
              const release = yield* Deferred.make<void>()
              const worker = yield* lifecycle
                .run(
                  id,
                  Deferred.succeed(entered, undefined).pipe(
                    Effect.andThen(Effect.never),
                    Effect.ensuring(Deferred.succeed(stopped, undefined).pipe(Effect.andThen(Deferred.await(release)))),
                  ),
                )
                .pipe(Effect.exit, Effect.forkChild)
              yield* Deferred.await(entered)
              return { id, stopped, release, worker }
            }),
          )
          yield* Effect.gen(function* () {
            const deletion = yield* lifecycle
              .retire(
                parent,
                Effect.gen(function* () {
                  yield* lifecycle.retire(workers[0]!.id, Effect.void)
                  yield* lifecycle.retire(workers[1]!.id, Effect.void)
                }),
              )
              .pipe(Effect.forkChild)
            yield* Deferred.await(workers[0]!.stopped).pipe(Effect.timeout("2 seconds"))
            expect(deletion.pollUnsafe()).toBeUndefined()
            yield* Deferred.succeed(workers[1]!.release, undefined)
            yield* lifecycle.retire(workers[1]!.id, Effect.void).pipe(Effect.timeout("2 seconds"))
            yield* lifecycle.use(workers[1]!.id, Effect.void)
            yield* Deferred.succeed(workers[0]!.release, undefined)
            yield* Fiber.join(workers[0]!.worker).pipe(Effect.timeout("2 seconds"))
            yield* Fiber.join(deletion).pipe(Effect.timeout("2 seconds"))
            expect(deletion.pollUnsafe()?._tag).toBe("Success")
          }).pipe(
            Effect.ensuring(
              Effect.forEach(workers, (worker) => Deferred.succeed(worker.release, undefined), { discard: true }),
            ),
          )
        }),
      ),
    ),
  10000,
)
