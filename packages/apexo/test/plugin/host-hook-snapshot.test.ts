import { emptyHookPreferences, emptyHookSelection } from "../fixture/hook-preferences"
import { expect } from "bun:test"
import path from "node:path"
import { Effect, Exit, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { AbsolutePath } from "@apexo/schema/schema"
import { HostHookSnapshot } from "@/plugin/host-hook-snapshot"
import { loadBundleHooks } from "@/plugin/bundle-hooks"
import { PluginStore } from "@apexo/core/plugin-store"
import { PluginBundle } from "@apexo/core/plugin-bundle"
import { MessageID, SessionID } from "@/session/schema"
import { TestInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"

const test = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(LayerNode.group([HostHookSnapshot.node, SessionHookSnapshot.node])),
    testInstanceStoreLayer,
  ),
)

const message = (sessionID: SessionID) => ({
  id: MessageID.ascending(),
  sessionID,
  role: "user" as const,
  agent: "build",
  time: { created: Date.now() },
  model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
})

test.instance("compatibility dispatches installed hooks once while native snapshots retain them", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const snapshots = yield* SessionHookSnapshot.Service
    const hooks = yield* HostHookSnapshot.Service
    const id = SessionID.descending()
    const source = path.join(instance.directory, "catalog")
    const store = path.join(instance.directory, "plugins")
    const trace = path.join(instance.directory, "dispatch")
    yield* Effect.promise(async () => {
      await Bun.write(
        path.join(source, ".grok-plugin/marketplace.json"),
        JSON.stringify({ name: "Test", plugins: [{ name: "example", source: "./example" }] }),
      )
      await Bun.write(path.join(source, "example/plugin.json"), JSON.stringify({ name: "example" }))
      await Bun.write(
        path.join(source, "example/hooks/hooks.json"),
        JSON.stringify({
          hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: `printf P >> '${trace}'` }] }] },
        }),
      )
    })
    const catalog = yield* Effect.promise(() => PluginStore.mutate(store, { action: "add-source", source }))
    yield* Effect.promise(() => PluginStore.mutate(store, { action: "install", id: catalog.items[0]!.id, trust: true }))
    const installed = (yield* Effect.promise(() => PluginStore.active(store)))[0]!
    const bundle = yield* Effect.promise(() => PluginBundle.read(installed.root, installed.item.name))
    const owner = yield* snapshots.registerLocation(
      { directory: AbsolutePath.make(instance.directory) },
      () =>
        Effect.succeed({
          projectTrusted: false,
          diagnostics: [],
          sources: [
            { name: installed.item.name, root: installed.root, host: false, hooks: bundle.hooks },
            {
              name: "host",
              root: instance.directory,
              host: true,
              hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: `printf H >> '${trace}'` }] }] },
            },
          ],
        }),
      emptyHookPreferences,
    )
    const snapshot = yield* snapshots.capture(owner, id)
    expect(snapshot.registry.sources.map((source) => source.host)).toEqual([false, true])
    const ordinary = yield* Effect.promise(() =>
      loadBundleHooks(instance.directory, store, undefined, undefined, emptyHookSelection),
    )
    const prompt = message(id)
    for (const hook of ordinary)
      yield* Effect.promise(async () => hook["chat.message"]?.({ sessionID: id }, { message: prompt, parts: [] }))
    yield* hooks.prompt({ sessionID: id }, { message: prompt, parts: [] })
    expect(yield* Effect.promise(() => Bun.file(trace).text())).toBe("PH")
    expect((yield* hooks.get(id)).length).toBe(1)
    expect((yield* snapshots.get(id))?.registry.sources).toHaveLength(2)
  }),
)

test.instance("reload retains startup context and never repeats startup or an already gated prompt", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const snapshots = yield* SessionHookSnapshot.Service
    const hooks = yield* HostHookSnapshot.Service
    const id = SessionID.descending()
    const trace = path.join(instance.directory, "trace")
    const state = { version: "first" }
    const owner = yield* snapshots.registerLocation(
      { directory: AbsolutePath.make(instance.directory) },
      () =>
        Effect.sync(() => ({
          projectTrusted: false,
          diagnostics: [],
          sources: [
            {
              name: "stable",
              root: instance.directory,
              host: true as const,
              hooks: {
                SessionStart: [
                  {
                    hooks: [
                      {
                        type: "command",
                        command: `printf S >> '${trace}'; printf '%s' '{"hookSpecificOutput":{"additionalContext":"startup"}}'`,
                      },
                    ],
                  },
                ],
                UserPromptSubmit: [
                  {
                    hooks: [
                      {
                        type: "command",
                        command: `printf '${state.version}' >> '${trace}'; printf '%s' '{"hookSpecificOutput":{"additionalContext":"${state.version}"}}'`,
                      },
                    ],
                  },
                ],
              },
            },
            ...(state.version === "second"
              ? [
                  {
                    name: "added",
                    root: instance.directory,
                    host: true as const,
                    hooks: {
                      SessionStart: [{ hooks: [{ type: "command", command: `printf WRONG >> '${trace}'` }] }],
                    },
                  },
                ]
              : []),
          ],
        })),
      emptyHookPreferences,
    )
    yield* snapshots.capture(owner, id)
    const first = message(id)
    yield* hooks.prompt({ sessionID: id }, { message: first, parts: [] })
    yield* hooks.prompt({ sessionID: id }, { message: first, parts: [] })
    state.version = "second"
    yield* snapshots.reload(owner, id)
    yield* hooks.prompt({ sessionID: id }, { message: first, parts: [] })
    const active = yield* hooks.get(id)
    const output = { system: [] as string[] }
    yield* Effect.promise(async () => {
      for (const hook of active)
        await hook["experimental.chat.system.transform"]?.({ sessionID: id, model: ProviderTest.model() }, output)
    })
    expect(output.system).toEqual(["startup", "first"])
    yield* hooks.prompt({ sessionID: id }, { message: message(id), parts: [] })
    yield* snapshots.reload(owner, id)
    yield* hooks.prompt({ sessionID: id }, { message: first, parts: [] })
    const restored = { system: [] as string[] }
    for (const hook of yield* hooks.get(id))
      yield* Effect.promise(async () =>
        hook["experimental.chat.system.transform"]?.({ sessionID: id, model: ProviderTest.model() }, restored),
      )
    expect(restored.system).toEqual(["startup", "first"])
    expect(yield* Effect.promise(() => Bun.file(trace).text())).toBe("Sfirstsecond")
  }),
)

test.instance("a blocked prompt retry remains blocked across reload until a new prompt", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const snapshots = yield* SessionHookSnapshot.Service
    const hooks = yield* HostHookSnapshot.Service
    const id = SessionID.descending()
    const trace = path.join(instance.directory, "denied")
    const state = { deny: true }
    const owner = yield* snapshots.registerLocation(
      { directory: AbsolutePath.make(instance.directory) },
      () =>
        Effect.sync(() => ({
          projectTrusted: false,
          diagnostics: [],
          sources: [
            {
              name: "policy",
              root: instance.directory,
              host: true as const,
              hooks: {
                UserPromptSubmit: [
                  { hooks: [{ type: "command", command: `printf P >> '${trace}'; exit ${state.deny ? 2 : 0}` }] },
                ],
              },
            },
          ],
        })),
      emptyHookPreferences,
    )
    yield* snapshots.capture(owner, id)
    const first = message(id)
    expect(
      Exit.isFailure(yield* hooks.prompt({ sessionID: id }, { message: first, parts: [] }).pipe(Effect.exit)),
    ).toBe(true)
    state.deny = false
    yield* snapshots.reload(owner, id)
    expect(
      Exit.isFailure(yield* hooks.prompt({ sessionID: id }, { message: first, parts: [] }).pipe(Effect.exit)),
    ).toBe(true)
    yield* hooks.prompt({ sessionID: id }, { message: message(id), parts: [] })
    yield* snapshots.reload(owner, id)
    expect(
      Exit.isFailure(yield* hooks.prompt({ sessionID: id }, { message: first, parts: [] }).pipe(Effect.exit)),
    ).toBe(true)
    expect(yield* Effect.promise(() => Bun.file(trace).text())).toBe("PP")
  }),
)
