import { expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Exit, Layer } from "effect"
import { Database } from "@apexo/core/database/database"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { EventTable } from "@apexo/core/event/sql"
import { EventV2 } from "@apexo/core/event"
import { ProjectTable } from "@apexo/core/project/sql"
import { ProjectSchema } from "@apexo/core/project/schema"
import { SessionProjector } from "@apexo/core/session/projector"
import { SessionCommandSandbox } from "@apexo/core/session/command-sandbox"
import { SessionCommandSandboxTable } from "@apexo/core/session/command-sandbox.sql"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionTable } from "@apexo/core/session/sql"
import { SessionV1 } from "@apexo/core/v1/session"
import { CommandSandboxPolicy } from "@apexo/core/command-sandbox/policy"
import migration from "@apexo/core/database/migration/20261014185747_native-command-sandbox"
import { AbsolutePath } from "@apexo/schema/schema"

const fromFile = (filename: string) =>
  LayerNode.compile(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionLifecycle.node,
      SessionCommandSandbox.node,
    ]),
    [[Database.node, Database.layerFromPath(filename)]],
  )

const layer = fromFile(":memory:")

const fixture = Effect.gen(function* () {
  const database = yield* Database.Service
  const events = yield* EventV2.Service
  const lifecycle = yield* SessionLifecycle.Service
  const sandbox = yield* SessionCommandSandbox.Service
  const projectID = ProjectSchema.ID.make("global")
  yield* database.db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make("/"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
  const create = (sessionID: SessionSchema.ID, parentID?: SessionSchema.ID, commit?: EventV2.PublishOptions) =>
    events.publish(
      SessionV1.Event.Created,
      {
        sessionID,
        info: SessionV1.SessionInfo.make({
          id: sessionID,
          parentID,
          slug: "sandbox",
          projectID,
          directory: "/",
          title: "Sandbox",
          version: "1",
          time: { created: Date.now(), updated: Date.now() },
        }),
      },
      commit,
    )
  return { db: database.db, events, lifecycle, sandbox, create }
})

test("Created and immutable root policy commit together; failed creation leaves neither row", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const f = yield* fixture
      const id = SessionSchema.ID.create()
      const prepared = yield* f.sandbox.prepareRoot(id, CommandSandboxPolicy.off)
      yield* f.lifecycle.use(
        id,
        f.create(id, undefined, { id: prepared.eventID, commit: () => prepared.commit.pipe(Effect.orDie) }),
      )
      expect((yield* f.sandbox.get(id)).profile).toBe("off")
      expect((yield* f.sandbox.adopt(id)).revision).toBe("off-v1")
      expect((yield* f.sandbox.adopt(id, "workspace").pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
      const failedID = SessionSchema.ID.create()
      const failed = yield* f.sandbox.prepareRoot(failedID, CommandSandboxPolicy.off)
      const result = yield* f.lifecycle
        .use(
          failedID,
          f.create(failedID, undefined, {
            id: failed.eventID,
            commit: () => failed.commit.pipe(Effect.andThen(Effect.die("fixture commit failure")), Effect.orDie),
          }),
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      expect(yield* f.db.select().from(SessionTable).where(eq(SessionTable.id, failedID)).get()).toBeUndefined()
      expect(
        yield* f.db
          .select()
          .from(SessionCommandSandboxTable)
          .where(eq(SessionCommandSandboxTable.session_id, failedID))
          .get(),
      ).toBeUndefined()
      expect((yield* f.sandbox.get(failedID).pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
    }).pipe(Effect.provide(layer)),
  )
})

test("private parent capability inherits only actual child and cannot reach a reused Session", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const f = yield* fixture
      const parent = SessionSchema.ID.create()
      const prepared = yield* f.sandbox.prepareRoot(parent, CommandSandboxPolicy.off)
      yield* f.create(parent, undefined, { id: prepared.eventID, commit: () => prepared.commit.pipe(Effect.orDie) })
      const captured = yield* f.sandbox.capture(parent)
      const child = SessionSchema.ID.create()
      yield* f.lifecycle.child(
        parent,
        child,
        f.create(child, parent).pipe(Effect.andThen(f.sandbox.inherit(captured, child))),
      )
      expect((yield* f.sandbox.get(child)).revision).toBe("off-v1")
      yield* f.sandbox.assertLegacy(child)
      const atomicChild = SessionSchema.ID.create()
      const childCreation = yield* f.sandbox.prepareChild(captured, atomicChild)
      yield* f.lifecycle.child(
        parent,
        atomicChild,
        f.create(atomicChild, parent, {
          id: childCreation.eventID,
          commit: () => childCreation.commit.pipe(Effect.orDie),
        }),
      )
      expect((yield* f.sandbox.inspect(atomicChild)).parent?.createdEventID).toBe(
        (yield* f.sandbox.inspect(parent)).created,
      )
      const wrongChild = SessionSchema.ID.create()
      const wrongCreation = yield* f.sandbox.prepareChild(captured, wrongChild)
      expect(
        Exit.isFailure(
          yield* f
            .create(wrongChild, undefined, {
              id: wrongCreation.eventID,
              commit: () => wrongCreation.commit.pipe(Effect.orDie),
            })
            .pipe(Effect.exit),
        ),
      ).toBe(true)
      expect(yield* f.db.select().from(SessionTable).where(eq(SessionTable.id, wrongChild)).get()).toBeUndefined()

      const stranger = SessionSchema.ID.create()
      yield* f.create(stranger)
      expect((yield* f.sandbox.inherit(captured, stranger).pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
      yield* f.lifecycle.retire(
        parent,
        f.db
          .delete(SessionTable)
          .where(eq(SessionTable.id, parent))
          .run()
          .pipe(Effect.andThen(f.events.remove(parent))),
      )
      expect(
        yield* f.db
          .select()
          .from(SessionCommandSandboxTable)
          .where(eq(SessionCommandSandboxTable.session_id, parent))
          .get(),
      ).toBeUndefined()
      const replacement = yield* f.sandbox.prepareRoot(parent, CommandSandboxPolicy.off)
      yield* f.create(parent, undefined, {
        id: replacement.eventID,
        commit: () => replacement.commit.pipe(Effect.orDie),
      })
      const lateChild = SessionSchema.ID.create()
      yield* f.create(lateChild, parent)
      expect((yield* f.sandbox.inherit(captured, lateChild).pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
      expect((yield* f.sandbox.get(lateChild).pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
    }).pipe(Effect.provide(layer)),
  )
})

test("migration seeds pre-existing valid Created proof, never later missing policy", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const f = yield* fixture
      yield* f.db.run("DROP TABLE session_command_sandbox")
      const before = SessionSchema.ID.create()
      yield* f.create(before)
      const legacyChild = SessionSchema.ID.create()
      yield* f.create(legacyChild, before)
      const missing = SessionSchema.ID.create()
      yield* f.create(missing)
      yield* f.events.remove(missing)
      const malformed = SessionSchema.ID.create()
      yield* f.create(malformed)
      yield* f.db
        .update(EventTable)
        .set({ data: { sessionID: malformed, info: { id: "different" } } })
        .where(eq(EventTable.aggregate_id, malformed))
        .run()
      const ambiguous = SessionSchema.ID.create()
      yield* f.create(ambiguous)
      const first = yield* f.db.select().from(EventTable).where(eq(EventTable.aggregate_id, ambiguous)).get()
      if (!first) throw new Error("Missing fixture event")
      yield* f.db
        .insert(EventTable)
        .values({ ...first, id: EventV2.ID.create(), seq: 99 })
        .run()
      yield* f.db.transaction((tx) => migration.up(tx))
      expect((yield* f.sandbox.get(before)).profile).toBe("off")
      const migratedParent = yield* f.sandbox.capture(before)
      yield* f.sandbox.inherit(migratedParent, legacyChild)
      expect((yield* f.sandbox.get(legacyChild)).profile).toBe("off")
      yield* f.sandbox.inherit(migratedParent, legacyChild)
      expect((yield* f.sandbox.inspect(legacyChild)).parent?.createdEventID).toBe(
        (yield* f.sandbox.inspect(before)).created,
      )
      expect((yield* f.sandbox.get(missing).pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
      expect((yield* f.sandbox.get(malformed).pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
      expect((yield* f.sandbox.get(ambiguous).pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
      expect(
        yield* f.db
          .select()
          .from(SessionCommandSandboxTable)
          .where(eq(SessionCommandSandboxTable.session_id, ambiguous))
          .get(),
      ).toBeUndefined()
      const later = SessionSchema.ID.create()
      yield* f.create(later)
      expect((yield* f.sandbox.get(later).pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
      expect((yield* f.sandbox.assertLegacy(later).pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
      // An ordinary new off record without private lineage is not a migration record.
      const ordinaryParent = SessionSchema.ID.create()
      const ordinary = yield* f.sandbox.prepareRoot(ordinaryParent, CommandSandboxPolicy.off)
      yield* f.create(ordinaryParent, undefined, {
        id: ordinary.eventID,
        commit: () => ordinary.commit.pipe(Effect.orDie),
      })
      const ordinaryChild = SessionSchema.ID.create()
      yield* f.create(ordinaryChild, ordinaryParent)
      const childProof = yield* f.db.select().from(EventTable).where(eq(EventTable.aggregate_id, ordinaryChild)).get()
      if (!childProof) throw new Error("Missing ordinary child proof")
      yield* f.db
        .insert(SessionCommandSandboxTable)
        .values({
          session_id: ordinaryChild,
          created_event_id: childProof.id,
          version: 1,
          policy: { policy: CommandSandboxPolicy.off },
          time_created: Date.now(),
        })
        .run()
      expect(
        (yield* f.sandbox.inherit(yield* f.sandbox.capture(ordinaryParent), ordinaryChild).pipe(Effect.flip))._tag,
      ).toBe("CommandSandbox.Failure")
    }).pipe(Effect.provide(layer)),
  )
})

test("immutable policy survives a real database reopen while missing records remain unavailable", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "apexo-sandbox-store-"))
  const filename = path.join(directory, "database.sqlite")
  try {
    const id = await Effect.runPromise(
      Effect.gen(function* () {
        const f = yield* fixture
        const id = SessionSchema.ID.create()
        const creation = yield* f.sandbox.prepareRoot(id, CommandSandboxPolicy.off)
        yield* f.create(id, undefined, { id: creation.eventID, commit: () => creation.commit.pipe(Effect.orDie) })
        return id
      }).pipe(Effect.provide(fromFile(filename))),
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        const f = yield* fixture
        expect((yield* f.sandbox.get(id)).revision).toBe("off-v1")
        yield* f.db.delete(SessionCommandSandboxTable).where(eq(SessionCommandSandboxTable.session_id, id)).run()
        expect((yield* f.sandbox.get(id).pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
      }).pipe(Effect.provide(fromFile(filename))),
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        const f = yield* fixture
        expect((yield* f.sandbox.get(id).pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
      }).pipe(Effect.provide(fromFile(filename))),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
