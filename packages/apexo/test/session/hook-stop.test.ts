import { emptyHookSelection } from "../fixture/hook-preferences"
import { HostHooks } from "@apexo/core/hooks"
import { expect } from "bun:test"
import path from "node:path"
import { Effect, Fiber, Layer, DateTime, Schema } from "effect"
import { eq } from "drizzle-orm"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { Database } from "@apexo/core/database/database"
import { SessionContextEpoch } from "@apexo/core/session/context-epoch"
import { SessionHookStop } from "@apexo/core/session/hook-stop"
import { SessionHookStopTable } from "@apexo/core/session/hook-stop.sql"
import { SessionTable, SessionMessageTable } from "@apexo/core/session/sql"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionMessage } from "@apexo/core/session/message"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { ProjectTable } from "@apexo/core/project/sql"
import { ProjectV2 } from "@apexo/core/project"
import { SystemContext } from "@apexo/core/system-context"
import { AbsolutePath } from "@apexo/schema/schema"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/fixture"

const it = testEffect(Layer.merge(Database.layerFromPath(":memory:"), AppNodeBuilder.build(CrossSpawnSpawner.node)))

it.live("Stop completion claim persists once and context acknowledges only its captured completion", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const db = fixture.database.db
    const first = yield* SessionHookStop.evaluate(db, { ...fixture.input, selection: emptyHookSelection })
    expect(first).toMatchObject({ continue: true, reason: "durable verification" })
    expect(yield* SessionHookStop.evaluate(db, { ...fixture.input, selection: emptyHookSelection })).toEqual({
      continue: false,
      forceStop: false,
    })
    const captured = yield* SessionHookStop.load(db, fixture.input.sessionID)
    expect(captured.messageID).toBe(fixture.input.messageID)
    const epoch = yield* SystemContext.initialize(captured.context)
    expect(epoch.baseline).toContain("durable verification")
    expect((yield* SessionHookStop.pending(db, fixture.input.sessionID))?.state).toBe("ready")
    yield* SessionHookStop.consume(db, fixture.input.sessionID, "unrelated-completion", "v2")
    expect(yield* SessionHookStop.pending(db, fixture.input.sessionID)).toBeDefined()
    yield* SessionHookStop.consume(db, fixture.input.sessionID, captured.messageID!, captured.engine!)
    expect(yield* SessionHookStop.pending(db, fixture.input.sessionID)).toBeDefined()
    yield* SessionContextEpoch.initialize(db, Effect.succeed(captured.context), fixture.input.sessionID)
    yield* SessionHookStop.consume(db, fixture.input.sessionID, captured.messageID!, captured.engine!)
    expect(yield* SessionHookStop.pending(db, fixture.input.sessionID)).toBeUndefined()
    expect((yield* db.select().from(SessionHookStopTable).get())?.reason).toBe("durable verification")
    yield* db.delete(SessionTable).where(eq(SessionTable.id, fixture.input.sessionID)).run()
    expect(yield* db.select().from(SessionHookStopTable).get()).toBeUndefined()
  }),
)

it.live("Stop cannot claim foreign messages, exceed continuation cap, or replay interrupted claims", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const db = fixture.database.db
    expect(
      yield* SessionHookStop.evaluate(db, { ...{ ...fixture.input, enabled: false }, selection: emptyHookSelection }),
    ).toEqual({
      continue: false,
      forceStop: false,
    })
    expect(
      yield* SessionHookStop.evaluate(db, { ...{ ...fixture.input, continuations: 8 }, selection: emptyHookSelection }),
    ).toEqual({
      continue: false,
      forceStop: false,
    })
    expect(
      yield* SessionHookStop.evaluate(db, {
        ...{ ...fixture.input, sessionID: SessionSchema.ID.create() },
        selection: emptyHookSelection,
      }),
    ).toEqual({
      continue: false,
      forceStop: false,
    })
    expect(yield* db.select().from(SessionHookStopTable).get()).toBeUndefined()
    const empty = yield* SessionHookStop.load(db, fixture.input.sessionID)
    expect((yield* SystemContext.initialize(empty.context)).baseline).toContain("No pending Stop hook continuation")
    yield* db
      .insert(SessionHookStopTable)
      .values({
        engine: "v2",
        message_id: fixture.input.messageID,
        session_id: fixture.input.sessionID,
        state: "evaluating",
        time_created: 1,
      })
      .run()
    expect(yield* SessionHookStop.evaluate(db, { ...fixture.input, selection: emptyHookSelection })).toEqual({
      continue: false,
      forceStop: false,
    })
    expect(yield* SessionHookStop.pending(db, fixture.input.sessionID)).toBeUndefined()
  }),
)

const setup = Effect.fnUntraced(function* () {
  const tmp = yield* tmpdirScoped()
  const database = yield* Database.Service
  const sessionID = SessionSchema.ID.create()
  const messageID = SessionMessage.ID.create()
  const projectID = ProjectV2.ID.make(`hooks-${sessionID}`)
  yield* database.db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make(tmp), sandboxes: [] })
    .run()
  yield* database.db
    .insert(SessionTable)
    .values({ id: sessionID, project_id: projectID, slug: "stop", directory: tmp, title: "Stop", version: "1" })
    .run()
  yield* database.db
    .insert(SessionMessageTable)
    .values({
      id: messageID,
      session_id: sessionID,
      type: "assistant",
      seq: 1,
      data: Schema.encodeSync(SessionMessage.Assistant)({
        id: messageID,
        type: "assistant",
        agent: "build",
        model: {
          id: ModelV2.ID.make("model"),
          providerID: ProviderV2.ID.make("provider"),
          variant: ModelV2.VariantID.make("default"),
        },
        content: [],
        finish: "stop",
        time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
      }),
    })
    .run()
  const home = path.join(tmp, "home")
  yield* Effect.promise(() =>
    Bun.write(
      path.join(home, "hooks/stop.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: 'printf \'%s\' \'{"decision":"block","reason":"durable verification"}\'' },
              ],
            },
          ],
        },
      }),
    ),
  )
  return {
    database,
    input: {
      registry: yield* Effect.promise(() => HostHooks.discover(tmp, home)),
      engine: "v2" as const,
      sessionID,
      messageID,
      directory: tmp,
      home,
      enabled: true,
      continuations: 0,
    },
  }
})

it.live("Stop interruption joins a held hook command before returning", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const pidfile = path.join(fixture.input.directory, "hook.pid")
    const script = path.join(fixture.input.directory, "held-hook.mjs")
    yield* Effect.promise(() =>
      Bun.write(
        script,
        `process.on("SIGTERM", () => {}); await Bun.write(${JSON.stringify(pidfile)}, String(process.pid)); setInterval(() => {}, 1000);`,
      ),
    )
    const registry: HostHooks.Inspection = {
      projectTrusted: false,
      diagnostics: [],
      sources: [
        {
          name: "held",
          root: fixture.input.directory,
          host: true,
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command: `exec '${process.execPath.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}'`,
                  },
                ],
              },
            ],
          },
        },
      ],
    }
    const running = yield* SessionHookStop.evaluate(fixture.database.db, {
      ...fixture.input,
      registry,
      selection: emptyHookSelection,
    }).pipe(Effect.forkChild)
    const pid = yield* Effect.promise(async () => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        if (await Bun.file(pidfile).exists()) return Number(await Bun.file(pidfile).text())
        await Bun.sleep(10)
      }
      throw new Error("Hook did not reach its owned readiness file")
    })
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        try {
          process.kill(pid, "SIGKILL")
        } catch {}
        await Bun.sleep(250)
      }),
    )
    yield* Fiber.interrupt(running)
    expect(() => process.kill(pid, 0)).toThrow()
    expect((yield* fixture.database.db.select().from(SessionHookStopTable).get())?.state).toBe("evaluating")
  }),
)
