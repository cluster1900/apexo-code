/**
 * Native `shell.env` hook: plugins add environment variables to shell commands
 * the agent runs (bash tool foreground commands and owned shell/monitor
 * processes). Mirrors the compatibility runtime's `shell.env` plugin trigger:
 * hooks run in registration order and mutate one shared `env` record.
 *
 * Commands confined by a native command sandbox keep their fixed sandbox
 * environment; plugin variables are not forwarded into the sandbox.
 */
export * as ShellEnvironment from "./shell-environment"

import { Context, Effect, Layer, Scope } from "effect"
import { makeLocationNode } from "./effect/app-node"

export interface Event {
  readonly cwd: string
  readonly sessionID?: string
  readonly callID?: string
  env: Record<string, string>
}

export type Input = Omit<Event, "env">
type Hook = (event: Event) => Effect.Effect<void> | void

export interface Interface {
  readonly hook: {
    readonly env: (callback: Hook) => Effect.Effect<{ readonly dispose: Effect.Effect<void> }, never, Scope.Scope>
  }
  /** Runs every registered hook and returns the variables they added (empty when no hook is registered). */
  readonly resolve: (input: Input) => Effect.Effect<Record<string, string>>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/v2/ShellEnvironment") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.sync(() => {
    let hooks: Hook[] = []
    return Service.of({
      hook: {
        env: Effect.fn("ShellEnvironment.hook")(function* (callback: Hook) {
          const scope = yield* Scope.Scope
          let active = true
          hooks = [...hooks, callback]
          const dispose = Effect.sync(() => {
            if (!active) return
            active = false
            hooks = hooks.filter((item) => item !== callback)
          })
          yield* Scope.addFinalizer(scope, dispose)
          return { dispose }
        }),
      },
      resolve: Effect.fn("ShellEnvironment.resolve")(function* (input: Input) {
        const event: Event = { ...input, env: {} }
        for (const hook of hooks) {
          const result = hook(event)
          if (Effect.isEffect(result)) yield* result
        }
        return Object.fromEntries(
          Object.entries(event.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer: locationLayer, deps: [] })
