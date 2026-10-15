import { expect } from "bun:test"
import path from "node:path"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { SessionV2 } from "@apexo/core/session"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionCompactionEvent } from "@apexo/schema/session-compaction-event"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Plugin } from "@/plugin"
import { CompatHookSnapshotLocation } from "@/plugin/hook-snapshot-location"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Session } from "@/session/session"
import { TestInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect, pollWithTimeout } from "../lib/effect"

const test = testEffect(
  Layer.merge(
    testInstanceStoreLayer,
    AppNodeBuilderV1.build(
      LayerNode.group([
        Session.node,
        SessionV2.node,
        SessionLifecycle.node,
        SessionHookSnapshot.node,
        CompatHookSnapshotLocation.node,
        EventV2Bridge.node,
        Plugin.node,
        CrossSpawnSpawner.node,
      ]),
      [
        [SessionExecution.node, SessionExecutionLocal.node],
        [
          RuntimeFlags.node,
          RuntimeFlags.layer({ runtimeProfile: "grok-build", pure: false, disableDefaultPlugins: true }),
        ],
        [InstanceBootstrap.node, Layer.succeed(InstanceBootstrap.Service, { run: Effect.void })],
      ],
    ),
  ),
)

test.instance(
  "real EventV2Bridge listeners preserve publisher ownership and stale Hook events cannot adopt reused Sessions",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const home = path.join(instance.directory, "home")
      const trace = path.join(instance.directory, "events")
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = { home: process.env.GROK_HOME, profile: process.env.APEXO_RUNTIME_PROFILE }
          process.env.GROK_HOME = home
          process.env.APEXO_RUNTIME_PROFILE = "grok-build"
          return previous
        }),
        (previous) =>
          Effect.sync(() => {
            if (previous.home === undefined) delete process.env.GROK_HOME
            else process.env.GROK_HOME = previous.home
            if (previous.profile === undefined) delete process.env.APEXO_RUNTIME_PROFILE
            else process.env.APEXO_RUNTIME_PROFILE = previous.profile
          }),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(home, "hooks/events.json"),
          JSON.stringify({
            hooks: {
              PostCompact: [{ hooks: [{ type: "command", command: `printf P >> '${trace}'` }] }],
              StopFailure: [{ hooks: [{ type: "command", command: `printf F >> '${trace}'` }] }],
            },
          }),
        ),
      )
      const sessions = yield* Session.Service
      const native = yield* SessionV2.Service
      const lifecycle = yield* SessionLifecycle.Service
      const snapshots = yield* CompatHookSnapshotLocation.Service
      const events = yield* EventV2Bridge.Service
      const plugin = yield* Plugin.Service
      const info = yield* sessions.create({})
      yield* snapshots.capture(info.id)
      const original = yield* lifecycle.capture(info.id)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const state = { delayed: false, seen: [] as (SessionLifecycle.Claim | undefined)[] }
      const before = yield* events.listen((event) => {
        if (event.type !== "session.compacted") return Effect.void
        return Effect.gen(function* () {
          state.seen.push(yield* SessionLifecycle.current(info.id))
          if (!state.delayed) return
          state.delayed = false
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
        })
      })
      yield* Effect.addFinalizer(() => before)
      yield* plugin.init()
      const after = yield* events.listen((event) => {
        if (event.type !== "session.compacted") return Effect.void
        return Effect.gen(function* () {
          state.seen.push(yield* SessionLifecycle.current(info.id))
        })
      })
      yield* Effect.addFinalizer(() => after)
      yield* lifecycle.owned(original, events.publish(SessionCompactionEvent.Compacted, { sessionID: info.id }))
      yield* pollWithTimeout(
        Effect.promise(() =>
          Bun.file(trace)
            .text()
            .catch(() => ""),
        ).pipe(Effect.map((text) => (text === "P" ? true : undefined))),
        "legitimate PostCompact did not dispatch",
      )
      yield* lifecycle.owned(original, events.publish(Session.Event.Error, { sessionID: info.id }))
      yield* pollWithTimeout(
        Effect.promise(() =>
          Bun.file(trace)
            .text()
            .catch(() => ""),
        ).pipe(Effect.map((text) => (text === "PF" ? true : undefined))),
        "legitimate StopFailure did not dispatch",
      )
      expect(state.seen).toEqual([original, original])
      state.delayed = true
      const pending = yield* lifecycle
        .owned(original, events.publish(SessionCompactionEvent.Compacted, { sessionID: info.id }))
        .pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      yield* native.remove(info.id)
      yield* native.create({ id: info.id, location: { directory: AbsolutePath.make(instance.directory) } })
      const replacement = yield* snapshots.capture(info.id)
      const fresh = yield* lifecycle.capture(info.id)
      expect(fresh).not.toBe(original)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(pending)
      expect(state.seen.slice(-2)).toEqual([original, original])
      // Await a real subsequent valid observer. The old event has already traversed
      // the same listener and its rejected async callback has settled in microtasks.
      yield* lifecycle.owned(fresh, events.publish(SessionCompactionEvent.Compacted, { sessionID: info.id }))
      yield* pollWithTimeout(
        Effect.promise(() => Bun.file(trace).text()).pipe(Effect.map((text) => (text.length >= 3 ? text : undefined))),
        "replacement PostCompact did not dispatch",
      )
      expect(yield* Effect.promise(() => Bun.file(trace).text())).toBe("PFP")
      expect(replacement.selection()).not.toHaveProperty("code")
    }),
)
