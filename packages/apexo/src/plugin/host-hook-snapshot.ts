export * as HostHookSnapshot from "./host-hook-snapshot"

import { Context, Effect, Layer } from "effect"
import { SessionV1 } from "@apexo/core/v1/session"
import type { Hooks } from "@apexo/plugin"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { SessionSchema } from "@apexo/core/session/schema"
import { KeyedMutex } from "@apexo/core/effect/keyed-mutex"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { hooksFromSources, type HookLifecycle } from "./bundle-hooks"

export class Service extends Context.Service<
  Service,
  {
    readonly release: (id: string) => Effect.Effect<void>
    readonly get: (id: string) => Effect.Effect<Hooks[]>
    readonly prompt: (
      input: Parameters<NonNullable<Hooks["chat.message"]>>[0],
      output: { message: SessionV1.User; parts: SessionV1.Part[] },
    ) => Effect.Effect<void>
  }
>()("@apexo/HostHookSnapshot") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const snapshots = yield* SessionHookSnapshot.Service
    const state = yield* InstanceState.make(
      Effect.fnUntraced(function* () {
        const locks = yield* KeyedMutex.make<string>()
        const entries = new Map<
          string,
          { snapshot: SessionHookSnapshot.Snapshot; hooks: Hooks[]; lifecycle: HookLifecycle }
        >()
        const prompts = new Map<string, Map<string, Promise<Map<string, string[]>>>>()
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const entry of entries.values())
              for (const hook of entry.hooks) yield* Effect.promise(() => Promise.resolve(hook.dispose?.()))
            entries.clear()
            prompts.clear()
          }),
        )
        return { entries, prompts, locks }
      }),
    )
    const get = Effect.fn("HostHookSnapshot.get")(function* (id: string) {
      const current = yield* InstanceState.get(state)
      return yield* current.locks.withLock(id)(
        Effect.gen(function* () {
          const snapshot = yield* snapshots.get(SessionSchema.ID.make(id))
          if (!snapshot) {
            current.entries.delete(id)
            current.prompts.delete(id)
            return []
          }
          const existing = current.entries.get(id)
          if (existing?.snapshot === snapshot) return existing.hooks
          const lifecycle = existing?.lifecycle ?? { started: new Set<string>(), sources: new Map() }
          const hooks = yield* Effect.promise(() =>
            // Compatibility already dispatches installed bundles through Plugin's ordinary
            // loader. Native consumers retain every source in the captured registry.
            hooksFromSources(
              snapshot.location.directory,
              snapshot.registry.sources.filter((source) => source.host),
              lifecycle,
              snapshot.selection,
            ),
          )
          current.entries.set(id, { snapshot, hooks, lifecycle })
          return hooks
        }),
      )
    })
    return Service.of({
      release: (id) =>
        Effect.gen(function* () {
          const current = yield* InstanceState.get(state)
          const entry = current.entries.get(id)
          current.entries.delete(id)
          current.prompts.delete(id)
          for (const hook of entry?.hooks ?? []) yield* Effect.promise(() => Promise.resolve(hook.dispose?.()))
        }),
      get,
      prompt: (input, output) =>
        Effect.gen(function* () {
          const current = yield* InstanceState.get(state)
          const hooks = yield* get(input.sessionID)
          const outcomes = current.prompts.get(input.sessionID) ?? new Map<string, Promise<Map<string, string[]>>>()
          current.prompts.set(input.sessionID, outcomes)
          // Keep receipts for every executed message until Session/Location release.
          // Older exact retries restore their own trusted context without rerunning a gate.
          const result =
            outcomes.get(output.message.id) ??
            (async () => {
              const lifecycle = current.entries.get(input.sessionID)?.lifecycle
              for (const source of lifecycle?.sources.values() ?? []) source.prompts.delete(input.sessionID)
              for (const hook of hooks)
                await hook["chat.message"]?.(
                  input,
                  output as unknown as Parameters<NonNullable<Hooks["chat.message"]>>[1],
                )
              return new Map(
                Array.from(lifecycle?.sources ?? [], ([name, source]) => [
                  name,
                  source.prompts.get(input.sessionID) ?? [],
                ]),
              )
            })().finally(() => current.entries.get(input.sessionID)?.lifecycle.started.add(input.sessionID))
          outcomes.set(output.message.id, result)
          const context = yield* Effect.promise(() => result)
          for (const [name, source] of current.entries.get(input.sessionID)?.lifecycle.sources ?? [])
            source.prompts.set(input.sessionID, context.get(name) ?? [])
        }),
    })
  }),
)
export const node = LayerNode.make({ service: Service, layer, deps: [SessionHookSnapshot.node] })
