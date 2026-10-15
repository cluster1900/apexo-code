import { expect, test } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Project } from "@apexo/schema/project"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap-service"
import { registerDisposer } from "@/effect/instance-registry"

for (const phase of ["load", "reload-wait", "reload-cleanup"] as const) {
  test(`InstanceStore shutdown settles ${phase} ownership`, async () => {
    const ready = Deferred.makeUnsafe<void>()
    const directory = `/instance-shutdown-${phase}`
    const input = {
      directory,
      worktree: directory,
      project: { id: Project.ID.make("global"), worktree: directory, sandboxes: [], time: { created: 0, updated: 0 } },
    }
    const off =
      phase === "reload-cleanup"
        ? registerDisposer((path) => {
            if (path !== directory) return Promise.resolve()
            Deferred.doneUnsafe(ready, Exit.void)
            return new Promise<void>(() => {})
          })
        : () => {}
    const program = Effect.gen(function* () {
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(
        LayerNode.compile(InstanceStore.node, [
          [
            InstanceStore.bootstrapNode,
            Layer.succeed(InstanceBootstrap.Service, {
              run:
                phase === "reload-cleanup"
                  ? Effect.void
                  : Deferred.succeed(ready, undefined).pipe(Effect.andThen(Effect.never)),
            }),
          ],
        ]),
        scope,
      )
      const store = Context.get(context, InstanceStore.Service)
      if (phase === "reload-cleanup") yield* store.load(input)
      const first = yield* (phase === "reload-cleanup" ? store.reload(input) : store.load(input)).pipe(Effect.forkChild)
      yield* Deferred.await(ready)
      const second = phase === "reload-wait" ? yield* store.reload(input).pipe(Effect.forkChild) : undefined
      yield* Effect.yieldNow
      yield* Scope.close(scope, Exit.void)
      expect(Exit.isFailure(yield* Fiber.await(first))).toBe(true)
      if (second) expect(Exit.isFailure(yield* Fiber.await(second))).toBe(true)
      return true
    })
    try {
      expect(await Promise.race([Effect.runPromise(program), Bun.sleep(1_000).then(() => false)])).toBe(true)
    } finally {
      off()
    }
  })
}
