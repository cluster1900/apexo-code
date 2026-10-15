import { expect } from "bun:test"
import path from "node:path"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { HookPreferences } from "@apexo/core/hook-preferences"
import { HostHooks } from "@apexo/core/hooks"
import { HookObserver } from "@apexo/core/hook-observer"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { SessionSchema } from "@apexo/core/session/schema"
import { AbsolutePath } from "@apexo/schema/schema"
import { hooksFromSources, withSelection } from "@/plugin/bundle-hooks"
import { ProviderTest } from "../fake/provider"
import { testEffect, pollWithTimeout } from "../lib/effect"
import { tmpdirScoped } from "../fixture/fixture"

const test = testEffect(Layer.merge(SessionHookSnapshot.layer, AppNodeBuilder.build(CrossSpawnSpawner.node)))
const id = (digit: string) => `hook_${digit.repeat(64)}`
const registry = (directory: string): HostHooks.Inspection => ({
  sources: [
    {
      name: path.join(directory, "hooks.json"),
      root: directory,
      host: true,
      hooks: {
        Notification: [
          {
            hooks: [
              { type: "command", command: "true" },
              { type: "command", command: "true", enabled: false },
            ],
          },
        ],
      },
    },
  ],
  diagnostics: [],
  projectTrusted: false,
})

test.live("real saved choices merge concurrent writers and roll back a rejected publication", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const first = HookPreferences.make(directory)
    const second = HookPreferences.make(directory)
    yield* Effect.all([first.change(id("a"), false, Effect.succeed), second.change(id("b"), false, Effect.succeed)], {
      concurrency: "unbounded",
    })
    expect((yield* HookPreferences.make(directory).read).disabled).toEqual([id("a"), id("b")])
    const before = yield* Effect.promise(() => Bun.file(HookPreferences.file(directory)).text())
    expect(yield* first.change(id("a"), true, () => Effect.fail("publication rejected")).pipe(Effect.flip)).toBe(
      "publication rejected",
    )
    expect(yield* Effect.promise(() => Bun.file(HookPreferences.file(directory)).text())).toBe(before)
    yield* Effect.promise(() => Bun.write(HookPreferences.file(directory), "broken"))
    expect((yield* first.change(id("a"), true, Effect.succeed).pipe(Effect.flip)).code).toBe("invalid")
    expect(yield* Effect.promise(() => Bun.file(HookPreferences.file(directory)).text())).toBe("broken")
    yield* Effect.promise(() => Bun.write(HookPreferences.file(directory), "x".repeat(1024 * 1024 + 1)))
    expect((yield* first.read.pipe(Effect.flip)).code).toBe("invalid")
  }),
)

test.live("Session choices preserve effective and saved distinction without reloading definitions", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const snapshots = yield* SessionHookSnapshot.Service
    const store = HookPreferences.make(directory)
    const state = { loads: 0 }
    const owner = yield* snapshots.registerLocation(
      { directory: AbsolutePath.make(directory) },
      () =>
        Effect.sync(() => {
          state.loads++
          return registry(directory)
        }),
      store,
    )
    const a = SessionSchema.ID.create(),
      b = SessionSchema.ID.create(),
      c = SessionSchema.ID.create()
    const early = yield* snapshots.select(owner, a)
    expect(state.loads).toBe(0)
    expect(yield* snapshots.get(a)).toBeUndefined()
    const first = yield* snapshots.capture(owner, a)
    const other = yield* snapshots.capture(owner, b)
    const hook = HostHooks.inspection(first.registry).hooks[0]!
    const configuredDisabled = HostHooks.inspection(first.registry).hooks[1]!
    yield* snapshots.preference(owner, a, hook.id, false)
    expect(yield* snapshots.get(a)).toBe(first)
    expect(first.generation).toBe(1)
    expect(early()).toEqual(first.selection())
    expect(HostHooks.choices(first.registry, "Notification", first.selection)).toMatchObject({ disabled: [hook.id] })
    expect(HostHooks.choices(other.registry, "Notification", other.selection)).toMatchObject({ disabled: [] })
    const view = SessionHookSnapshot.inspection(other, yield* store.read)
    expect(view.inspection?.hooks[0]).toMatchObject({ effectiveDisabled: false, savedDisabled: true })
    expect(view.inspection?.hooks[1]).toMatchObject({
      configuredEnabled: false,
      effectiveDisabled: true,
      savedDisabled: false,
    })
    expect((yield* snapshots.capture(owner, c)).selection()).toEqual(yield* store.read)
    yield* snapshots.preference(owner, a, configuredDisabled.id, true)
    expect(SessionHookSnapshot.inspection(first, yield* store.read).inspection?.hooks[1]).toMatchObject({
      effectiveDisabled: true,
      savedDisabled: false,
    })
    expect(state.loads).toBe(3)
    yield* Effect.promise(() => Bun.write(HookPreferences.file(directory), "corrupt"))
    expect(
      SessionHookSnapshot.inspection(first, yield* store.read.pipe(Effect.catch(Effect.succeed))).preferenceFailure,
    ).toBe("invalid")
    expect(first.selection()).not.toBeInstanceOf(HookPreferences.Failure)
    expect((yield* snapshots.reload(owner, a).pipe(Effect.flip)).code).toBe("load")
    expect(yield* snapshots.get(a)).toBe(first)
    yield* snapshots.invalidate(a)
    expect(early()).toBeInstanceOf(HookPreferences.Failure)
    expect((yield* snapshots.preference(owner, a, hook.id, true).pipe(Effect.flip)).code).toBe("missing")
  }),
)

test.live("corrupt preferences do not affect empty, disabled or unsupported handlers; managed policy is exempt", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const snapshots = yield* SessionHookSnapshot.Service
    const store = HookPreferences.make(directory)
    yield* Effect.promise(() => Bun.write(HookPreferences.file(directory), "corrupt"))
    const source: HostHooks.Source = {
      name: "empty",
      root: directory,
      host: true,
      hooks: {
        Notification: [
          {
            hooks: [
              { type: "command", command: "false", enabled: false },
              { type: "unsupported" },
              { type: "command" },
            ],
          },
        ],
      },
    }
    const owner = yield* snapshots.registerLocation(
      { directory: AbsolutePath.make(directory) },
      () => Effect.succeed({ sources: [source], diagnostics: [], projectTrusted: false }),
      store,
    )
    const snapshot = yield* snapshots.capture(owner, SessionSchema.ID.create())
    expect(snapshot.selection()).toEqual({ disabled: [] })
    expect(HostHooks.choices(snapshot.registry, "Notification")).toEqual({ disabled: [] })
    expect(HostHooks.choices(registry(directory), "Notification")).toBeInstanceOf(HookPreferences.Failure)
    const managed = { ...registry(directory).sources[0]!, policy: "managed" as const }
    expect(HostHooks.choices({ ...registry(directory), sources: [managed] }, "Notification")).toEqual({ disabled: [] })
    expect(HostHooks.blocked(managed, { enabled: false }, "anything", ["anything"])).toBe(false)
    expect(HostHooks.inspection({ ...registry(directory), sources: [managed] }).hooks[0]).toMatchObject({
      configurable: false,
      readOnlyReason: "managed",
    })
    yield* HookObserver.observe({
      registry: registry(directory),
      selection: () => new HookPreferences.Failure({ code: "invalid", message: "Unavailable" }),
      event: "Notification",
      sessionID: "unavailable",
      directory: directory,
      payload: {},
      enabled: true,
    })
  }),
)

test.live("dispatch freezes choices once while later handlers and later dispatches remain distinct", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const snapshots = yield* SessionHookSnapshot.Service
    const trace = path.join(directory, "trace"),
      ready = path.join(directory, "ready"),
      release = path.join(directory, "release")
    const source: HostHooks.Source = {
      name: "frozen",
      root: directory,
      host: true,
      hooks: {
        Notification: [
          {
            hooks: [
              {
                type: "command",
                command: `touch '${ready}'; while [ ! -f '${release}' ]; do sleep 0.01; done; printf A >> '${trace}'`,
              },
              { type: "command", command: `printf B >> '${trace}'` },
            ],
          },
        ],
      },
    }
    const owner = yield* snapshots.registerLocation(
      { directory: AbsolutePath.make(directory) },
      () => Effect.succeed({ sources: [source], diagnostics: [], projectTrusted: false }),
      HookPreferences.make(directory),
    )
    const sessionID = SessionSchema.ID.create()
    const snapshot = yield* snapshots.capture(owner, sessionID)
    const input = {
      registry: snapshot.registry,
      selection: snapshot.selection,
      event: "Notification" as const,
      sessionID,
      directory: directory,
      payload: {},
      enabled: true,
    }
    const pending = yield* HookObserver.observe(input).pipe(Effect.forkChild)
    yield* pollWithTimeout(
      Effect.promise(() => Bun.file(ready).exists()).pipe(Effect.map((exists) => (exists ? true : undefined))),
      "first handler did not start",
    )
    yield* snapshots.preference(owner, sessionID, HostHooks.inspection(snapshot.registry).hooks[1]!.id, false)
    yield* Effect.promise(() => Bun.write(release, "release"))
    yield* Fiber.join(pending)
    expect(yield* Effect.promise(() => Bun.file(trace).text())).toBe("AB")
    yield* HookObserver.observe(input)
    expect(yield* Effect.promise(() => Bun.file(trace).text())).toBe("ABA")
  }),
)

test.live("compatibility binding retains receipts and rejects an omitted user-handler capability", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const trace = path.join(directory, "trace")
    const source: HostHooks.Source = {
      name: "plugin",
      pluginID: "catalog:plugin",
      root: directory,
      host: false,
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: `printf S >> '${trace}'` }] }],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: `printf P >> '${trace}'` }] }],
      },
    }
    const hooks = yield* Effect.promise(() => hooksFromSources(directory, [source]))
    const hook = hooks[0]!
    const input = { sessionID: "session", model: ProviderTest.model() }
    const output = { system: [] as string[] }
    const absent = yield* Effect.tryPromise({
      try: () => hook["experimental.chat.system.transform"]!(input, output),
      catch: (error) => error,
    }).pipe(Effect.flip)
    expect(absent).toBeInstanceOf(HookPreferences.Failure)
    expect(absent).toMatchObject({ code: "read", message: "Captured Hook choices are unavailable" })
    const fresh = (yield* Effect.promise(() => hooksFromSources(directory, [source])))[0]!
    const enabled = withSelection(fresh, () => ({ disabled: [] }))
    yield* Effect.promise(() => enabled["experimental.chat.system.transform"]!(input, output))
    yield* Effect.promise(() =>
      withSelection(fresh, () => ({ disabled: [] }))["experimental.chat.system.transform"]!(input, output),
    )
    expect(yield* Effect.promise(() => Bun.file(trace).text())).toBe("S")
    const event = HostHooks.inspection({ sources: [source], diagnostics: [], projectTrusted: false }).hooks[0]!.id
    const elsewhere = withSelection(fresh, () => ({ disabled: [event] }))
    yield* Effect.promise(() =>
      elsewhere["experimental.chat.system.transform"]!({ ...input, sessionID: "other" }, output),
    )
    expect(yield* Effect.promise(() => Bun.file(trace).text())).toBe("S")
  }),
)

test.live("cancellation joins admitted durable publication before releasing the writer lock", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const store = HookPreferences.make(directory)
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const committed = { value: false }
    const pending = yield* store
      .change(id("c"), false, () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          committed.value = true
        }),
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const stopping = yield* Fiber.interrupt(pending).pipe(Effect.forkChild)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(stopping)
    expect(committed.value).toBe(true)
    expect((yield* store.read).disabled).toEqual([id("c")])
    yield* store.change(id("d"), false, Effect.succeed)
    expect((yield* store.read).disabled).toEqual([id("c"), id("d")])
  }),
)

test.effect(
  "identity separates host origins and plugin slots while excluding handler secrets",
  Effect.sync(() => {
    const first = registry("/first").sources[0]!
    const second = registry("/second").sources[0]!
    const command = { type: "command", command: "secret command", env: { TOKEN: "secret" } }
    expect(HostHooks.key(first, "Notification", 0, 0, command)).not.toBe(
      HostHooks.key(second, "Notification", 0, 0, command),
    )
    expect(HostHooks.key(first, "Notification", 0, 0, command)).toBe(
      HostHooks.key(first, "Notification", 0, 0, { ...command, command: "changed", env: {} }),
    )
    const plugin = { ...first, host: false, pluginID: "catalog:one" }
    expect(HostHooks.key(plugin, "Notification", 0, 0, command)).toBe(
      HostHooks.key({ ...plugin, root: "/new-version" }, "Notification", 0, 0, command),
    )
    expect(HostHooks.key(plugin, "Notification", 0, 0, command)).not.toBe(
      HostHooks.key({ ...plugin, pluginID: "catalog:two" }, "Notification", 0, 0, command),
    )
    expect(HostHooks.key(plugin, "Notification", 0, 0, command)).not.toBe(
      HostHooks.key(plugin, "Notification", 0, 1, command),
    )
    expect(HostHooks.configurable({ ...plugin, pluginID: undefined })).toBe(false)
  }),
)
