import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { eq } from "drizzle-orm"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Database } from "@apexo/core/database/database"
import { SessionMemoryModeTable } from "@apexo/core/session/sql"
import { SessionProjector } from "@apexo/core/session/projector"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionMemoryMode } from "@/session/memory-mode"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

function fixture(environment?: boolean, configured?: boolean, profile: "apexo" | "grok-build" = "grok-build") {
  return testEffect(
    AppNodeBuilder.build(
      LayerNode.group([SessionMemoryMode.node, Session.node, SessionProjector.node, SessionStatus.node, Database.node]),
      [
        [Config.node, TestConfig.layer({ get: () => Effect.succeed({ memory: { enabled: configured } }) })],
        [RuntimeFlags.node, RuntimeFlags.layer({ runtimeProfile: profile, grokMemory: environment })],
        [InstanceBootstrap.node, Layer.succeed(InstanceBootstrap.Service, { run: Effect.void })],
      ],
    ),
  )
}

for (const value of [
  { name: "defaults off", env: undefined, config: undefined, enabled: false, source: "default" },
  { name: "environment opts in", env: true, config: undefined, enabled: true, source: "environment" },
  { name: "config opts in", env: undefined, config: true, enabled: true, source: "config" },
  {
    name: "explicit environment opt-in wins over config opt-out",
    env: true,
    config: false,
    enabled: true,
    source: "environment",
  },
  { name: "process disable wins over config", env: false, config: true, enabled: false, source: "process" },
] as const) {
  fixture(value.env, value.config).instance(value.name, () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const mode = yield* SessionMemoryMode.Service
      const session = yield* sessions.create()
      expect(yield* mode.get(session.id)).toEqual({
        enabled: value.enabled,
        source: value.source,
        busy: false,
        canToggle: value.env !== false,
      })
      if (value.env === false) {
        const result = yield* mode.set(session.id, true).pipe(Effect.result)
        expect(result._tag).toBe("Failure")
        expect((yield* mode.get(session.id)).enabled).toBe(false)
        return
      }
      expect((yield* mode.set(session.id, !value.enabled)).enabled).toBe(!value.enabled)
      expect((yield* mode.get((yield* sessions.create()).id)).enabled).toBe(value.enabled)
      expect((yield* mode.get(session.id)).source).toBe("session")
    }),
  )
}

const it = fixture()
it.instance("enabling during a turn is refused until the user retries after idle", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const mode = yield* SessionMemoryMode.Service
    const status = yield* SessionStatus.Service
    const session = yield* sessions.create()
    yield* status.set(session.id, { type: "busy" })
    expect((yield* mode.set(session.id, true).pipe(Effect.result))._tag).toBe("Failure")
    expect(yield* mode.get(session.id)).toMatchObject({ enabled: false, busy: true })
    yield* status.set(session.id, { type: "idle" })
    expect(yield* mode.get(session.id)).toMatchObject({ enabled: false, busy: false })
    yield* mode.set(session.id, true)
    expect(yield* mode.get(session.id)).toMatchObject({ enabled: true, busy: false })
    yield* status.set(session.id, { type: "busy" })
    expect((yield* mode.set(session.id, false)).enabled).toBe(false)
  }),
)

it.instance("disabling interrupts memory work and rejects an old commit after re-enable", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const mode = yield* SessionMemoryMode.Service
    const session = yield* sessions.create()
    const other = yield* sessions.create()
    yield* mode.set(session.id, true)
    yield* mode.set(other.id, true)
    const started = yield* Deferred.make<string>()
    const finished = yield* Deferred.make<void>()
    const worker = yield* mode
      .run(session.id, (revision) =>
        Deferred.succeed(started, revision).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(finished, undefined)),
        ),
      )
      .pipe(Effect.result, Effect.forkScoped)
    const revision = yield* Deferred.await(started)
    yield* mode.set(session.id, false)
    yield* Deferred.await(finished)
    expect((yield* Fiber.join(worker))._tag).toBe("Failure")
    expect((yield* mode.get(other.id)).enabled).toBe(true)
    yield* mode.set(session.id, true)
    const writes: string[] = []
    expect(
      (yield* mode
        .commit(
          session.id,
          revision,
          Effect.sync(() => writes.push("stale")),
        )
        .pipe(Effect.result))._tag,
    ).toBe("Failure")
    yield* mode.run(session.id, (current) =>
      mode.commit(
        session.id,
        current,
        Effect.sync(() => writes.push("fresh")),
      ),
    )
    expect(writes).toEqual(["fresh"])
  }),
)

it.instance("disable waits for an admitted commit, and deleting a session removes its override", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const mode = yield* SessionMemoryMode.Service
    const database = yield* Database.Service
    const session = yield* sessions.create()
    yield* mode.set(session.id, true)
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const completed = yield* Deferred.make<void>()
    const writer = yield* mode
      .run(session.id, (revision) =>
        mode.commit(
          session.id,
          revision,
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(Deferred.succeed(completed, undefined)),
          ),
        ),
      )
      .pipe(Effect.result, Effect.forkScoped)
    yield* Deferred.await(started)
    const disabled = yield* mode.set(session.id, false).pipe(Effect.forkScoped)
    expect(yield* Deferred.isDone(completed)).toBe(false)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(disabled)
    yield* Fiber.join(writer)
    expect(yield* Deferred.isDone(completed)).toBe(true)
    yield* sessions.remove(session.id)
    expect(
      yield* database.db
        .select()
        .from(SessionMemoryModeTable)
        .where(eq(SessionMemoryModeTable.session_id, session.id))
        .get(),
    ).toBeUndefined()
  }),
)

fixture(undefined, true, "apexo").instance("ordinary profile does not expose or enable Grok memory", () =>
  Effect.gen(function* () {
    const mode = yield* SessionMemoryMode.Service
    expect(yield* mode.get()).toEqual({ enabled: false, busy: false, canToggle: false, source: "profile" })
  }),
)
