import { expect } from "bun:test"
import { rename, symlink, unlink } from "node:fs/promises"
import path from "node:path"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionGoalCleanupOwner } from "@apexo/core/session/goal-cleanup-owner"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { Database } from "@apexo/core/database/database"
import { GoalCleanupTable, GoalTable } from "@apexo/core/goal/sql"
import { ProjectTable } from "@apexo/core/project/sql"
import { ProjectV2 } from "@apexo/core/project"
import { SessionTable, SessionMessageTable } from "@apexo/core/session/sql"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalFiles } from "@apexo/core/session/goal-files"
import { SessionGoalReports } from "@apexo/core/session/goal-reports"
import { SessionGoalCleanup } from "@apexo/core/session/goal-cleanup"
import { Goal } from "@apexo/schema/goal"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionID } from "@apexo/schema/session-id"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live("terminal cleanup preserves paused scratch and completed reports, including interrupted scratch removal", () =>
  Effect.gen(function* () {
    const data = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const f = yield* fixture(data)
      const work = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.pause(f.target, "user_paused")
      yield* f.cleanup.terminal(f.target.sessionID)
      expect(yield* Effect.promise(() => awaitExists(path.join(f.files.workerScratch, "keep.txt")))).toBe(true)
      yield* f.goals.resume(f.target)
      const next = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.usage(next, "budget", 10)
      expect((yield* f.goals.get(f.target.sessionID))?.status).toBe("budget_limited")
      yield* Effect.promise(() => rename(f.files.workerScratch, path.join(f.files.directory, ".deleting-worker-1234")))
      yield* f.cleanup.terminal(f.target.sessionID)
      expect(
        yield* Effect.promise(() => awaitExists(path.join(f.files.directory, ".deleting-worker-1234", "keep.txt"))),
      ).toBe(false)
      const downloaded = yield* Effect.promise(() => f.reports.read(path.basename(f.files.directory), "plan"))
      expect(downloaded.text).toBe("Preserved plan")
      expect(yield* f.database.db.select().from(GoalCleanupTable).all()).toHaveLength(0)
      expect(yield* f.goals.finish(work, {}).pipe(Effect.flip)).toMatchObject({ code: "inactive" })
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

it.live("terminal state and frozen cleanup ownership commit together before executor teardown", () =>
  Effect.gen(function* () {
    const data = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const f = yield* fixture(data)
      const attempt = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.usage(attempt, "budget", 10)
      const pending = yield* f.database.db.select().from(GoalCleanupTable).all()
      expect(pending).toHaveLength(1)
      expect(pending[0]?.data).toMatchObject({ ids: [path.basename(f.files.directory)], owner: { pid: process.pid } })
      yield* f.cleanup.drain()
      expect(yield* Effect.promise(() => awaitExists(path.join(f.files.workerScratch, "keep.txt")))).toBe(true)
      yield* f.cleanup.terminal(f.target.sessionID)
      expect(yield* f.database.db.select().from(GoalCleanupTable).all()).toHaveLength(0)
      expect(yield* Effect.promise(() => awaitExists(path.join(f.files.workerScratch, "keep.txt")))).toBe(false)
      expect(yield* Effect.promise(() => awaitExists(f.files.plan.path))).toBe(true)
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

it.live("clear and Session deletion cannot bypass a live terminal teardown barrier", () =>
  Effect.gen(function* () {
    const data = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      for (const reason of ["goal_cleared", "session_deleted"] as const) {
        const f = yield* fixture(data)
        const attempt = yield* f.goals.begin(f.target, "executing")
        yield* f.goals.usage(attempt, "budget", 10)
        yield* f.cleanup.prepare(f.target, reason, yield* f.goals.get(f.target.sessionID))
        if (reason === "goal_cleared") yield* f.goals.clear(f.target)
        if (reason === "session_deleted")
          yield* f.database.db.delete(SessionTable).where(eq(SessionTable.id, f.target.sessionID)).run()
        yield* f.cleanup.drain()
        expect(yield* Effect.promise(() => awaitExists(path.join(f.files.workerScratch, "keep.txt")))).toBe(true)
        expect(yield* f.database.db.select().from(GoalCleanupTable).all()).toHaveLength(2)
        yield* f.cleanup.terminal(f.target.sessionID)
        expect(yield* Effect.promise(() => awaitExists(f.files.plan.path))).toBe(false)
        expect(yield* f.database.db.select().from(GoalCleanupTable).all()).toHaveLength(0)
      }
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

it.live("explicit retention removes only superseded reports after its deadline and defaults to indefinite", () =>
  Effect.gen(function* () {
    const data = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      for (const days of [undefined, 0, 1]) {
        const f = yield* fixture(data)
        const attempt = yield* f.goals.begin(f.target, "executing")
        const reportID = yield* f.goals.reserveReport(attempt)
        const historical = yield* Effect.promise(() =>
          SessionGoalFiles.create({
            data,
            owner: f.target,
            reportID,
            kind: "planning",
            objective: "Superseded report",
            evidence: "{}",
          }),
        )
        yield* Effect.promise(() => historical.write(historical.paths.plan, "Historical plan"))
        const archived = yield* Effect.promise(() => historical.finish())
        yield* f.cleanup.backfill(f.target, days)
        yield* f.goals.usage(attempt, "budget", 10)
        yield* f.cleanup.terminal(f.target.sessionID)
        expect(yield* Effect.promise(() => awaitExists(f.files.plan.path))).toBe(true)
        expect(yield* Effect.promise(() => awaitExists(archived.files.plan.path))).toBe(days !== 0)
        const pending = yield* f.database.db
          .select()
          .from(GoalCleanupTable)
          .where(eq(GoalCleanupTable.session_id, f.target.sessionID))
          .all()
        expect(pending.map((job) => job.reason)).toEqual(days === 1 ? ["retention"] : [])
        if (days === 1) {
          yield* f.database.db
            .update(GoalCleanupTable)
            .set({
              data: {
                ids: [reportID],
                info: yield* f.goals.get(f.target.sessionID),
                after: Date.now() - 1,
              },
            })
            .where(eq(GoalCleanupTable.id, pending[0]!.id))
            .run()
          yield* f.cleanup.drain()
          expect(yield* Effect.promise(() => awaitExists(archived.files.plan.path))).toBe(false)
          expect(yield* Effect.promise(() => awaitExists(f.files.plan.path))).toBe(true)
        }
      }
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

it.live("cleanup intent survives Session cascade and database reopen without touching another database's files", () =>
  Effect.gen(function* () {
    const data = yield* tmpdirScoped()
    const filename = path.join(data, "cleanup.sqlite")
    const other = yield* fixture(data).pipe(Effect.provide(Database.layerFromPath(path.join(data, "other.sqlite"))))
    const f = yield* Effect.gen(function* () {
      const f = yield* fixture(data)
      yield* f.cleanup.prepareSession(f.target.sessionID)
      yield* f.cleanup.drain()
      expect(yield* Effect.promise(() => awaitExists(f.files.plan.path))).toBe(true)
      yield* f.database.db.delete(SessionTable).where(eq(SessionTable.id, f.target.sessionID)).run()
      expect(yield* f.database.db.select().from(GoalCleanupTable).all()).toHaveLength(1)
      return f
    }).pipe(Effect.provide(Database.layerFromPath(filename)))
    yield* Effect.gen(function* () {
      const database = yield* Database.Service
      yield* SessionGoalCleanup.make(database.db, data).drain()
      expect(yield* database.db.select().from(GoalCleanupTable).all()).toHaveLength(0)
      expect(yield* Effect.promise(() => awaitExists(f.files.plan.path))).toBe(false)
      expect(yield* Effect.promise(() => awaitExists(other.files.plan.path))).toBe(true)
    }).pipe(Effect.provide(Database.layerFromPath(filename)))
  }),
)

it.live("failed cleanup retries the frozen report IDs and leaves replacement Goal reports intact", () =>
  Effect.gen(function* () {
    const data = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const f = yield* fixture(data)
      yield* f.goals.pause(f.target, "user_paused")
      const info = yield* f.goals.get(f.target.sessionID)
      yield* f.cleanup.prepare(f.target, "goal_cleared", info)
      yield* f.goals.clear(f.target)
      const saved = `${f.files.directory}-saved`
      yield* Effect.promise(() => rename(f.files.directory, saved))
      if (process.platform !== "win32") {
        yield* Effect.promise(() => symlink(saved, f.files.directory))
        yield* f.cleanup.drain()
        expect(yield* f.database.db.select().from(GoalCleanupTable).all()).toHaveLength(1)
        expect(yield* Effect.promise(() => awaitExists(path.join(saved, "plan.md")))).toBe(true)
        yield* Effect.promise(() => unlink(f.files.directory))
      }
      yield* Effect.promise(() => rename(saved, f.files.directory))
      yield* f.goals.create(f.target.sessionID, {
        id: f.target.goalID,
        objective: "Replacement lifetime",
        tokenBudget: 10,
      })
      const replacement = yield* Effect.promise(() =>
        SessionGoalFiles.create({
          data,
          owner: f.target,
          kind: "planning",
          objective: "New lifetime",
          evidence: "{}",
        }),
      )
      yield* Effect.promise(() => replacement.write(replacement.paths.plan, "New plan"))
      const next = yield* Effect.promise(() => replacement.finish())
      yield* f.cleanup.drain()
      expect(yield* Effect.promise(() => awaitExists(f.files.plan.path))).toBe(true)
      expect(yield* Effect.promise(() => awaitExists(next.files.plan.path))).toBe(true)
      const work = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.usage(work, "replacement-budget", 10)
      yield* f.cleanup.drain()
      expect(yield* Effect.promise(() => awaitExists(f.files.plan.path))).toBe(true)
      yield* f.cleanup.terminal(f.target.sessionID)
      expect(yield* Effect.promise(() => awaitExists(f.files.plan.path))).toBe(false)
      expect(yield* Effect.promise(() => awaitExists(next.files.plan.path))).toBe(true)
      expect(yield* f.database.db.select().from(GoalCleanupTable).all()).toHaveLength(0)
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

const awaitExists = (file: string) => Bun.file(file).exists()

it.live("existing databases gain the cleanup queue without losing Goal state or reports", () =>
  Effect.gen(function* () {
    const data = yield* tmpdirScoped()
    const filename = path.join(data, "upgrade.sqlite")
    const previous = yield* Effect.gen(function* () {
      const f = yield* fixture(data)
      // Recreate the schema/journal immediately before this migration, retaining real persisted Goal data.
      yield* f.database.db.run("DROP TABLE session_goal_cleanup")
      yield* f.database.db.run("DELETE FROM migration WHERE id = '20261014074632_goal-cleanup'")
      return { target: f.target, info: yield* f.goals.get(f.target.sessionID), files: f.files }
    }).pipe(Effect.provide(Database.layerFromPath(filename)))
    yield* Effect.gen(function* () {
      const database = yield* Database.Service
      expect(yield* SessionGoal.make(database.db).get(previous.target.sessionID)).toEqual(previous.info)
      expect(yield* database.db.select().from(GoalCleanupTable).all()).toEqual([])
      expect(yield* Effect.promise(() => awaitExists(previous.files.plan.path))).toBe(true)
      const cleanup = SessionGoalCleanup.make(database.db, data)
      yield* cleanup.prepareSession(previous.target.sessionID)
      yield* database.db.delete(SessionTable).where(eq(SessionTable.id, previous.target.sessionID)).run()
      yield* cleanup.drain()
      expect(yield* Effect.promise(() => awaitExists(previous.files.plan.path))).toBe(false)
    }).pipe(Effect.provide(Database.layerFromPath(filename)))
  }),
)

it.live("terminal scratch cleanup refuses symlinks and retries after the owned directory is restored", () =>
  Effect.gen(function* () {
    if (process.platform === "win32") return
    const data = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const f = yield* fixture(data)
      const work = yield* f.goals.begin(f.target, "executing")
      yield* f.goals.usage(work, "budget", 10)
      const saved = `${f.files.workerScratch}-saved`
      yield* Effect.promise(() => rename(f.files.workerScratch, saved))
      yield* Effect.promise(() => symlink(saved, f.files.workerScratch))
      yield* f.cleanup.terminal(f.target.sessionID)
      expect(yield* f.database.db.select().from(GoalCleanupTable).all()).toHaveLength(1)
      expect(yield* Effect.promise(() => awaitExists(path.join(saved, "keep.txt")))).toBe(true)
      yield* Effect.promise(() => unlink(f.files.workerScratch))
      yield* Effect.promise(() => rename(saved, f.files.workerScratch))
      yield* f.cleanup.drain()
      expect(yield* f.database.db.select().from(GoalCleanupTable).all()).toHaveLength(0)
      expect(yield* Effect.promise(() => awaitExists(path.join(f.files.workerScratch, "keep.txt")))).toBe(false)
      expect(yield* Effect.promise(() => awaitExists(f.files.plan.path))).toBe(true)
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

const fixture = Effect.fnUntraced(function* (data: string, legacy = false, goalID = Goal.ID.create()) {
  const database = yield* Database.Service
  const projectID = ProjectV2.ID.make("cleanup-project")
  const sessionID = SessionID.create()
  yield* database.db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make(data), sandboxes: [] })
    .onConflictDoNothing()
    .run()
  yield* database.db
    .insert(SessionTable)
    .values({ id: sessionID, project_id: projectID, slug: "cleanup", directory: data, title: "Cleanup", version: "1" })
    .run()
  const goals = SessionGoal.make(database.db)
  const info = yield* goals.create(sessionID, { id: goalID, objective: "Cleanup", tokenBudget: 10 })
  const target = { sessionID, goalID: info.id }
  const attempt = yield* goals.begin(target, "planning")
  const report = yield* Effect.promise(() =>
    SessionGoalFiles.create({
      data,
      ...(!legacy ? { owner: target } : {}),
      kind: "planning",
      objective: "Cleanup",
      evidence: "{}",
    }),
  )
  yield* Effect.promise(() => report.write(report.paths.plan, "Preserved plan"))
  const finished = yield* Effect.promise(() => report.finish())
  yield* Effect.promise(() => Bun.write(path.join(finished.files.workerScratch, "keep.txt"), "Private scratch"))
  yield* goals.finish(attempt, { plan: finished.text, plannerFiles: finished.files })
  yield* SessionGoalCleanup.make(database.db, data).backfill(target)
  return {
    database,
    goals,
    target,
    files: finished.files,
    reports: SessionGoalReports.make({ data, ...target, info: yield* goals.get(sessionID) }),
    cleanup: SessionGoalCleanup.make(database.db, data),
  }
})

// Synthetic compatibility states use the supported flat report writer and real persisted file hashes.
// They model missing terminal intents; they are not captured historical database artifacts.
const legacyTerminal = Effect.fnUntraced(function* (data: string, goalID = Goal.ID.create()) {
  const f = yield* fixture(data, true, goalID)
  const attempt = yield* f.goals.begin(f.target, "executing")
  yield* f.goals.usage(attempt, "legacy-budget", 10)
  const terminal = (yield* f.database.db
    .select()
    .from(GoalCleanupTable)
    .where(eq(GoalCleanupTable.goal_id, f.target.goalID))
    .all())[0]!
  yield* f.database.db.delete(GoalCleanupTable).where(eq(GoalCleanupTable.goal_id, f.target.goalID)).run()
  const row = yield* f.database.db.select().from(GoalTable).where(eq(GoalTable.id, f.target.goalID)).get()
  yield* f.database.db
    .update(GoalTable)
    .set({
      data: Object.fromEntries(
        Object.entries(row!.data as Record<string, unknown>).filter(
          ([key]) => !["reportIDs", "reportRetentionDays"].includes(key),
        ),
      ),
    })
    .where(eq(GoalTable.id, f.target.goalID))
    .run()
  return { ...f, terminal, info: (yield* f.goals.get(f.target.sessionID))! }
})

it.live(
  "legacy terminal discovery is non-destructive, idempotent and preserves unknown teardown across Goal writes",
  () =>
    Effect.gen(function* () {
      const data = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const f = yield* legacyTerminal(data)
        const scratch = path.join(f.files.workerScratch, "keep.txt")
        expect(yield* f.cleanup.discover()).toEqual({ discovered: 1, unverified: 1, scheduled: 0 })
        expect(yield* f.goals.get(f.target.sessionID)).toEqual(f.info)
        expect(yield* f.goals.terminalReportRecovery(f.target)).toEqual({
          ids: [path.basename(f.files.directory)],
          status: "unverified",
        })
        expect(yield* f.cleanup.discover()).toEqual({ discovered: 0, unverified: 1, scheduled: 0 })
        yield* f.cleanup.drain()
        yield* f.cleanup.terminal(f.target.sessionID)
        expect(yield* f.database.db.select().from(GoalCleanupTable).all()).toEqual([])
        expect(yield* Effect.promise(() => awaitExists(scratch))).toBe(true)
        expect((yield* Effect.promise(() => f.reports.read(path.basename(f.files.directory), "plan"))).sha256).toBe(
          f.files.plan.sha256,
        )
        yield* f.goals.registerReports(f.target, [path.basename(f.files.directory)], 0)
        expect((yield* f.goals.terminalReportRecovery(f.target))?.status).toBe("unverified")
        yield* SessionGoalCleanup.make(f.database.db, data).drain()
        expect(yield* Effect.promise(() => awaitExists(scratch))).toBe(true)
        expect(yield* f.database.db.select().from(GoalCleanupTable).all()).toEqual([])
        expect((yield* f.goals.get(f.target.sessionID))?.plan).toBe(f.info.plan)
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
    }),
)

it.live(
  "legacy recovery reuses an independently persisted live owner barrier and prunes only after its finalizer",
  () =>
    Effect.gen(function* () {
      const data = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const f = yield* legacyTerminal(data)
        yield* f.database.db
          .insert(GoalCleanupTable)
          .values({
            ...f.terminal,
            id: "legacy-retention-proof",
            reason: "retention",
            data: { ...(f.terminal.data as Record<string, unknown>), ids: [], after: Date.now() + 86_400_000 },
          })
          .run()
        expect(yield* f.cleanup.discover()).toEqual({ discovered: 1, unverified: 0, scheduled: 1 })
        expect(yield* f.goals.get(f.target.sessionID)).toEqual(f.info)
        yield* f.cleanup.drain()
        expect(yield* Effect.promise(() => awaitExists(path.join(f.files.workerScratch, "keep.txt")))).toBe(true)
        expect(yield* f.database.db.select().from(GoalCleanupTable).all()).toHaveLength(2)
        yield* f.cleanup.terminal(f.target.sessionID)
        expect(yield* Effect.promise(() => awaitExists(path.join(f.files.workerScratch, "keep.txt")))).toBe(false)
        expect((yield* Effect.promise(() => f.reports.read(path.basename(f.files.directory), "plan"))).sha256).toBe(
          f.files.plan.sha256,
        )
        expect(yield* f.goals.get(f.target.sessionID)).toEqual(f.info)
        expect((yield* f.database.db.select().from(GoalCleanupTable).all()).map((job) => job.reason)).toEqual([
          "retention",
        ])
        expect(yield* f.cleanup.discover()).toEqual({ discovered: 0, unverified: 0, scheduled: 1 })
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
    }),
)

it.live("legacy recovery rejects stale discovery and cannot adopt another Goal lifetime's owner", () =>
  Effect.gen(function* () {
    const data = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const f = yield* legacyTerminal(data)
      yield* f.cleanup.discover()
      yield* f.goals.registerReports(f.target, [])
      expect(
        yield* f.goals
          .discoverTerminalReports({ ...f.target, revision: f.info.revision }, [path.basename(f.files.directory)])
          .pipe(Effect.flip),
      ).toMatchObject({ code: "stale" })
      yield* f.database.db
        .insert(GoalCleanupTable)
        .values({
          ...f.terminal,
          id: "foreign-retention-proof",
          reason: "retention",
          data: {
            ...(f.terminal.data as Record<string, unknown>),
            info: { ...f.info, createdAt: f.info.createdAt - 1 },
            after: Date.now() + 86_400_000,
          },
        })
        .run()
      expect(yield* f.cleanup.discover()).toEqual({ discovered: 0, unverified: 1, scheduled: 0 })
      expect(yield* Effect.promise(() => awaitExists(path.join(f.files.workerScratch, "keep.txt")))).toBe(true)
      const active = yield* fixture(data)
      const info = (yield* active.goals.get(active.target.sessionID))!
      expect(
        yield* active.goals
          .discoverTerminalReports({ ...active.target, revision: info.revision }, [
            path.basename(active.files.directory),
          ])
          .pipe(Effect.flip),
      ).toMatchObject({ code: "inactive" })
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

it.live(
  "legacy unverified manifests survive database reopening without authorizing cleanup or changing public state",
  () =>
    Effect.gen(function* () {
      const data = yield* tmpdirScoped()
      const filename = path.join(data, "legacy-recovery.sqlite")
      const saved = yield* Effect.gen(function* () {
        const f = yield* legacyTerminal(data)
        yield* f.cleanup.discover()
        return {
          target: f.target,
          info: f.info,
          files: f.files,
          recovery: yield* f.goals.terminalReportRecovery(f.target),
        }
      }).pipe(Effect.provide(Database.layerFromPath(filename)))
      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const goals = SessionGoal.make(database.db)
        const cleanup = SessionGoalCleanup.make(database.db, data)
        expect(yield* goals.get(saved.target.sessionID)).toEqual(saved.info)
        expect(yield* goals.terminalReportRecovery(saved.target)).toEqual(saved.recovery)
        yield* cleanup.drain()
        yield* cleanup.terminal(saved.target.sessionID)
        expect(yield* database.db.select().from(GoalCleanupTable).all()).toEqual([])
        expect(yield* Effect.promise(() => awaitExists(path.join(saved.files.workerScratch, "keep.txt")))).toBe(true)
        expect(
          (yield* Effect.promise(() =>
            SessionGoalReports.make({ data, ...saved.target, info: saved.info }).read(
              path.basename(saved.files.directory),
              "plan",
            ),
          )).sha256,
        ).toBe(saved.files.plan.sha256)
      }).pipe(Effect.provide(Database.layerFromPath(filename)))
    }),
)

it.live("legacy discovery scans bounded pages without active Goals starving later terminal ownership gaps", () =>
  Effect.gen(function* () {
    const data = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const f = yield* legacyTerminal(data, Goal.ID.make("goal_zzzzzzzzzz"))
      for (let index = 0; index < 101; index++) {
        const sessionID = SessionID.create()
        yield* f.database.db
          .insert(SessionTable)
          .values({
            id: sessionID,
            project_id: ProjectV2.ID.make("cleanup-project"),
            slug: "active",
            directory: data,
            title: "Active",
            version: "1",
          })
          .run()
        yield* f.goals.create(sessionID, {
          id: Goal.ID.make(`goal_page${index.toString().padStart(3, "0")}`),
          objective: "Active",
        })
      }
      expect(yield* f.cleanup.discover()).toEqual({ discovered: 0, unverified: 0, scheduled: 0 })
      expect(yield* f.goals.terminalReportRecovery(f.target)).toBeUndefined()
      expect(yield* f.cleanup.discover()).toEqual({ discovered: 1, unverified: 1, scheduled: 0 })
      expect(yield* f.cleanup.discover()).toEqual({ discovered: 0, unverified: 0, scheduled: 0 })
      expect(yield* Effect.promise(() => awaitExists(path.join(f.files.workerScratch, "keep.txt")))).toBe(true)
    }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
  }),
)

it.live(
  "legacy scratch recovery requires a verified dead owner, survives reopen and preserves transcript and other databases",
  () =>
    Effect.gen(function* () {
      const data = yield* tmpdirScoped()
      const filename = path.join(data, "dead-owner.sqlite")
      const other = yield* legacyTerminal(data).pipe(
        Effect.provide(Database.layerFromPath(path.join(data, "other-owner.sqlite"))),
      )
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const child = yield* spawner.spawn(ChildProcess.make(process.execPath, ["-e", "process.exit(0)"]))
      expect(Number(yield* child.exitCode)).toBe(0)
      expect(SessionGoalCleanupOwner.alive(Number(child.pid))).toBe(false)
      const saved = yield* Effect.gen(function* () {
        const f = yield* legacyTerminal(data)
        const message = {
          text: "Keep the original transcript",
          time: { created: Date.now() },
        } satisfies Omit<(typeof SessionMessage.User)["Encoded"], "type" | "id">
        yield* f.database.db
          .insert(SessionMessageTable)
          .values({
            id: SessionMessage.ID.create(),
            session_id: f.target.sessionID,
            seq: 1,
            type: "user",
            data: message,
          })
          .run()
        const transcript = yield* f.database.db.select().from(SessionMessageTable).all()
        yield* f.database.db
          .insert(GoalCleanupTable)
          .values({
            ...f.terminal,
            id: "verified-dead-retention-proof",
            reason: "retention",
            data: {
              ...(f.terminal.data as Record<string, unknown>),
              ids: [],
              owner: { pid: Number(child.pid), token: "synthetic-exited-owner" },
              after: Date.now() + 86_400_000,
            },
          })
          .run()
        expect(yield* f.cleanup.discover()).toEqual({ discovered: 1, unverified: 0, scheduled: 1 })
        yield* Effect.promise(() =>
          rename(f.files.workerScratch, path.join(f.files.directory, ".deleting-worker-1234")),
        )
        return { target: f.target, info: f.info, files: f.files, transcript }
      }).pipe(Effect.provide(Database.layerFromPath(filename)))
      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const goals = SessionGoal.make(database.db)
        yield* SessionGoalCleanup.make(database.db, data).drain()
        expect(
          yield* Effect.promise(() =>
            awaitExists(path.join(saved.files.directory, ".deleting-worker-1234", "keep.txt")),
          ),
        ).toBe(false)
        expect(yield* Effect.promise(() => awaitExists(path.join(other.files.workerScratch, "keep.txt")))).toBe(true)
        expect(yield* database.db.select().from(SessionMessageTable).all()).toEqual(saved.transcript)
        expect(yield* goals.get(saved.target.sessionID)).toEqual(saved.info)
        expect(
          (yield* Effect.promise(() =>
            SessionGoalReports.make({ data, ...saved.target, info: saved.info }).read(
              path.basename(saved.files.directory),
              "plan",
            ),
          )).sha256,
        ).toBe(saved.files.plan.sha256)
        expect((yield* database.db.select().from(GoalCleanupTable).all()).map((job) => job.reason)).toEqual([
          "retention",
        ])
      }).pipe(Effect.provide(Database.layerFromPath(filename)))
    }),
)
