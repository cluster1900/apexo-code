export * as PluginBundleRuntime from "./plugin-bundle-runtime"

import { Cause, Context, Effect, Layer } from "effect"
import { PluginBundleState } from "./plugin-bundle-state"
import { LocationRuntimeGuard } from "./location-runtime-guard"
import { Location } from "./location"
import { AgentV2 } from "./agent"
import { CommandV2 } from "./command"
import { SkillV2 } from "./skill"
import { MCP } from "./mcp"
import { LSP } from "./lsp"
import { makeLocationNode } from "./effect/app-node"

export { Failure } from "./plugin-bundle-state"
const make = Effect.gen(function* () {
  const bundles = yield* PluginBundleState.Service
  const guard = yield* LocationRuntimeGuard.Service
  const location = yield* Location.Service
  const agents = yield* AgentV2.Service
  const commands = yield* CommandV2.Service
  const skills = yield* SkillV2.Service
  const mcp = yield* MCP.Service
  const lsp = yield* LSP.Service
  const failure = (cause: Cause.Cause<unknown>) => {
    const error = Cause.squash(cause)
    if (error instanceof PluginBundleState.Failure) return error
    return new PluginBundleState.Failure({
      code:
        (error instanceof MCP.Failure || error instanceof LSP.Failure) && error.code === "invalid" ? "invalid" : "load",
      message:
        error instanceof MCP.Failure || error instanceof LSP.Failure
          ? error.message
          : "Could not prepare native plugin state",
    })
  }
  const activate = (candidate: PluginBundleState.Snapshot, initial = false) =>
    Effect.gen(function* () {
      const pending = yield* mcp.prepareReload(initial)
      const language = yield* lsp.prepareReload(initial)
      const agent = yield* agents.prepareReload
      const command = yield* commands.prepareReload
      const skill = yield* skills.prepareReload
      // Every fallible transform has completed. MCP verifies connection liveness before
      // any publication; the remaining synchronous pointer swaps cannot suspend.
      yield* Effect.sync(() => {
        language.verify()
        pending.commit()
        language.commit()
        agent()
        command()
        skill()
        bundles.publish(candidate)
      }).pipe(
        Effect.andThen(pending.retire),
        Effect.andThen(language.retire),
        Effect.andThen(bundles.retire),
        Effect.uninterruptible,
      )
      // Retirement is part of settlement: new work cannot use old connections while
      // the old process groups and registrations are being closed.
    }).pipe(Effect.provideService(PluginBundleState.Candidate, candidate), Effect.scoped)

  const ready = yield* Effect.cached(
    Effect.gen(function* () {
      const status = yield* bundles.status
      const initial = yield* bundles.get
      yield* activate(initial, true).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
          const empty: PluginBundleState.Snapshot = { generation: 0, active: [], config: {}, skills: [], sources: [] }
          return activate(empty, true).pipe(Effect.andThen(Effect.sync(() => bundles.failed(failure(cause)))))
        }),
      )
      // Unsupported file components may have already failed before MCP boot. Base
      // connections can still initialize without erasing that activation failure.
      if (status.failure) bundles.failed(new PluginBundleState.Failure(status.failure))
    }).pipe(Effect.orDie),
  )

  return {
    ready,
    status: bundles.status,
    reload: () =>
      ready.pipe(
        Effect.andThen(
          lsp.suspendRecovery(
            guard.idle(
              location,
              Effect.gen(function* () {
                const candidate = yield* bundles.stage()
                yield* activate(candidate)
              }).pipe(
                Effect.catchCause((cause) => {
                  if (Cause.hasInterruptsOnly(cause)) return bundles.retire.pipe(Effect.andThen(Effect.failCause(cause)))
                  const error = failure(cause)
                  bundles.failed(error)
                  return bundles.retire.pipe(Effect.andThen(Effect.fail(error)))
                }),
              ),
            ),
          ),
        ),
        Effect.catchTag("LocationRuntimeBusy", () =>
          Effect.fail(
            new PluginBundleState.Failure({
              code: "busy",
              message: "Wait for active work in this Location before reloading plugins",
            }),
          ),
        ),
      ),
  }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/PluginBundleRuntime") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    PluginBundleState.node,
    LocationRuntimeGuard.node,
    Location.node,
    AgentV2.node,
    CommandV2.node,
    SkillV2.node,
    MCP.node,
    LSP.node,
  ],
})
