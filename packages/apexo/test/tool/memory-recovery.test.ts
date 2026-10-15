import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { layer } from "@apexo/core/database/sqlite.bun"
import { MemoryV2Notes } from "@apexo/core/memory-v2-notes"
import { MemoryOperation } from "@apexo/schema/memory-operation"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { MemoryConsolidation } from "@apexo/core/memory-consolidation"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const access = () => true
const publish = <A, E, R>(work: Effect.Effect<A, E, R>) => work
const authority = { id: "explicit-recovery", sessionID: "operator", createdEventID: "created-operator" }
const prepared = (store: Effect.Success<ReturnType<typeof MemoryCapture.make>>) =>
  Effect.gen(function* () {
    yield* store.remember("A durable source observation", access)
    const lease = (yield* store.dreamClaim(
      { owner: "original", now: Date.now(), duration: 300000, ownership: "explicit" },
      access,
    ))!
    const input = yield* store.dreamInput(lease, Date.now(), access)
    yield* store.dreamPrepare(
      lease,
      [
        {
          action: "create",
          path: "topics/prepared.md",
          content: "Prepared knowledge",
          evidence: input.observations.map((row) => row.path),
        },
      ],
      Date.now(),
      access,
    )
    return lease
  })

it.live("released orphan discard is exact and never publishes or adopts the old plan", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home }, { recover: false, strictOwner: true })
    const lease = yield* prepared(store)
    const original = yield* store.revision
    expect((yield* store.recoveryPreview({ action: "discard", scope: "workspace" }, access)).reason).toBe(
      "unknown_owner",
    )
    yield* store.dreamRelease(lease, Date.now())
    const preview = yield* store.recoveryPreview({ action: "discard", scope: "workspace" }, access)
    expect(preview.available).toBe(true)
    expect(JSON.stringify(preview)).not.toContain(lease.token)
    expect(JSON.stringify(preview)).not.toContain(store.root.path)
    const committed = { count: 0 }
    expect(
      (yield* store.recoverExplicit(
        authority,
        preview,
        access,
        publish,
        Effect.sync(() => {
          committed.count++
        }),
      )).committed,
    ).toBe(true)
    expect(committed.count).toBe(1)
    expect(yield* store.revision).toBe(original)
    expect((yield* store.dreamResume(lease, Date.now(), access).pipe(Effect.result))._tag).toBe("Failure")
    expect((yield* store.previewNote("topics/prepared.md", access).pipe(Effect.result))._tag).toBe("Failure")
    expect((yield* store.listNotes("durable", access)).length).toBe(1)
    const reopened = yield* MemoryCapture.make({ home, directory: home }, { recover: false })
    expect((yield* reopened.recoverExplicit(authority, preview, access, publish, Effect.void)).status).toBe("completed")
    expect(
      (yield* reopened
        .recoverExplicit({ ...authority, createdEventID: "replacement" }, preview, access, publish, Effect.void)
        .pipe(Effect.result))._tag,
    ).toBe("Failure")
  }),
)

it.live("clear refuses unknown and live owners, then journals a released partial plan exactly once", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home }, { recover: false, strictOwner: true })
    const lease = yield* prepared(store)
    expect((yield* store.recoveryPreview({ action: "clear", scope: "workspace" }, access)).reason).toBe("unknown_owner")
    yield* store.dreamApply(lease, Date.now(), access)
    yield* store.dreamRelease(lease, Date.now())
    expect((yield* store.recoveryPreview({ action: "discard", scope: "workspace" }, access)).reason).toBe(
      "partial_publication",
    )
    const preview = yield* store.recoveryPreview({ action: "clear", scope: "workspace" }, access)
    expect(preview.available).toBe(true)
    const result = yield* store.recoverExplicit(authority, preview, access, publish, Effect.void)
    expect(result.status).toBe("completed")
    expect(result.committed).toBe(true)
    const generation = yield* store.revision
    expect(generation).not.toBe(preview.generation)
    expect(yield* store.listNotes("", access)).toEqual([])
    const reopened = yield* MemoryCapture.make({ home, directory: home }, { recover: false })
    expect(yield* reopened.recoverExplicit(authority, preview, access, publish, Effect.void)).toEqual(result)
    expect(yield* reopened.revision).toBe(generation)
    expect(
      (yield* reopened
        .dreamClaim(
          { owner: "stranger", now: Date.now(), duration: 1000, ownership: "explicit", recover: lease },
          access,
        )
        .pipe(Effect.result))._tag,
    ).toBe("Failure")
  }),
)

it.live("recovery preview rejects changed content and protects a live capture lease", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home }, { recover: false })
    const note = yield* store.remember("Original fact", access)
    const preview = yield* store.recoveryPreview({ action: "clear", scope: "workspace" }, access)
    yield* Effect.promise(() => Bun.write(note.path, "Changed externally"))
    expect(
      (yield* store.recoverExplicit(authority, preview, access, publish, Effect.void).pipe(Effect.result))._tag,
    ).toBe("Failure")
    expect(yield* Effect.promise(() => Bun.file(note.path).text())).toBe("Changed externally")
    const current = yield* store.recoveryPreview({ action: "clear", scope: "workspace" }, access)
    expect(
      (yield* store.recoverExplicit(authority, current, () => false, publish, Effect.void).pipe(Effect.result))._tag,
    ).toBe("Failure")
    const job = yield* store.admit({
      sessionID: "capture",
      promptID: "capture-prompt",
      exposed: true,
      sourcePromptIndex: 0,
      source: "source",
    })
    if (!job.admitted) return yield* Effect.fail(new Error("Capture fixture source was not admitted"))
    const lease = (yield* store.claim({ sessionID: "capture", owner: "foreign", now: Date.now(), duration: 10000 }))!
    expect(lease.job.job_id).toBe(job.jobID)
    expect((yield* store.recoveryPreview({ action: "clear", scope: "workspace" }, access)).reason).toBe(
      "capture_active",
    )
    expect(
      (yield* store.recoverExplicit(authority, current, access, publish, Effect.void).pipe(Effect.result))._tag,
    ).toBe("Failure")
    yield* store.fail(lease, "Original owner settles", false)
  }),
)

it.live("current process and foreign host provenance never become abandoned by age", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home }, { recover: false })
    yield* store.remember("A fact", access)
    const proof = MemoryConsolidation.provenance({
      sessionID: "owner",
      createdEventID: "original-created",
      operationID: "operation",
      scope: store.root.path,
    })
    const lease = (yield* store.dreamClaim(
      { owner: "live", now: 1000, duration: 1000, ownership: "explicit", provenance: proof },
      access,
    ))!
    expect((yield* store.recoveryPreview({ action: "clear", scope: "workspace" }, access)).reason).toBe("live_owner")
    yield* store.dreamRelease(lease, Date.now())
    const foreign = (yield* store.dreamClaim(
      {
        owner: "foreign",
        now: 3000,
        duration: 1000,
        ownership: "explicit",
        provenance: { ...proof, hostname: `${proof.hostname}-foreign` },
      },
      access,
    ))!
    expect((yield* store.recoveryPreview({ action: "clear", scope: "workspace" }, access)).reason).toBe("foreign_owner")
    yield* store.dreamRelease(foreign, Date.now())
  }),
)

for (const phase of ["dream-planned", "clear-committed", "clear-unlinked", "clear-finished"] as const) {
  it.live(`explicit recovery survives the real ${phase} crash without adopting inference`, () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      yield* Effect.promise(async () => {
        const child = Bun.spawn(
          [process.execPath, `${import.meta.dir}/../fixture/memory-recovery-crash.mjs`, home, phase],
          {
            env: {
              ...process.env,
              HOME: home,
              APEXO_TEST_HOME: home,
              XDG_DATA_HOME: `${home}/data`,
              XDG_STATE_HOME: `${home}/state`,
              XDG_CACHE_HOME: `${home}/cache`,
              XDG_CONFIG_HOME: `${home}/config`,
            },
            stdout: "ignore",
            stderr: "pipe",
          },
        )
        const diagnostics = new Response(child.stderr).text()
        try {
          const deadline = Date.now() + 10000
          while (
            !(await Bun.file(`${home}/recovery-checkpoint`).exists()) &&
            child.exitCode === null &&
            Date.now() < deadline
          )
            await Bun.sleep(10)
          expect(await Bun.file(`${home}/recovery-checkpoint`).exists()).toBe(true)
        } finally {
          child.kill("SIGKILL")
          await child.exited
          await diagnostics
        }
      })
      const store = yield* MemoryCapture.make({ home, directory: home }, { recover: false, strictOwner: true })
      if (phase === "dream-planned") {
        const preview = yield* store.recoveryPreview({ action: "discard", scope: "workspace" }, access)
        expect(preview.available).toBe(true)
        expect((yield* store.recoverExplicit(authority, preview, access, publish, Effect.void)).status).toBe(
          "completed",
        )
        expect((yield* store.previewNote("topics/never-published.md", access).pipe(Effect.result))._tag).toBe("Failure")
        expect((yield* store.listNotes("Preserved", access)).length).toBe(1)
        return
      }
      const input = yield* Effect.promise(() => Bun.file(`${home}/recovery-input.json`).text())
      const decoded = yield* Schema.decodeUnknownEffect(
        Schema.UnknownFromJsonString.pipe(Schema.decodeTo(Schema.Struct({ preview: MemoryOperation.RecoveryPreview }))),
      )(input)
      const preview = decoded.preview
      const generation = yield* store.revision
      const operator = { id: "crash-clear", sessionID: "operator", createdEventID: "operator-created" }
      expect(
        (yield* store
          .recoverExplicit({ ...operator, createdEventID: "reused" }, preview, access, publish, Effect.void)
          .pipe(Effect.result))._tag,
      ).toBe("Failure")
      const result = yield* store.recoverExplicit(operator, preview, access, publish, Effect.void)
      expect(result.status).toBe("completed")
      expect(result.committed).toBe(true)
      expect(yield* store.revision).toBe(generation)
      expect(yield* store.listNotes("", access)).toEqual([])
      expect(yield* store.recoverExplicit(operator, preview, access, publish, Effect.void)).toEqual(result)
    }),
  )
}

it.live("passive recovery preview leaves a missing scope absent", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home }
    expect((yield* MemoryCapture.inspectRecovery(input, { action: "clear", scope: "workspace" }, access)).reason).toBe(
      "scope_empty",
    )
    expect(yield* Effect.promise(() => Bun.file(`${MemoryV2.directory(input)}/memory_state.sqlite`).exists())).toBe(
      false,
    )
  }),
)

it.live("a committed clear retains changed external bytes and settles only its exact receipt", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home }, { recover: false, strictOwner: true })
    const note = yield* store.remember("Original publication", access)
    const original = yield* Effect.promise(() => Bun.file(note.path).text())
    const preview = yield* store.recoveryPreview({ action: "clear", scope: "workspace" }, access)
    const result = yield* store
      .recoverExplicit(
        authority,
        preview,
        access,
        publish,
        Effect.promise(() => Bun.write(note.path, "External replacement after COMMIT")).pipe(Effect.asVoid),
      )
      .pipe(Effect.result)
    expect(result._tag).toBe("Failure")
    const committedGeneration = yield* store.revision
    expect(committedGeneration).not.toBe(preview.generation)
    expect(yield* Effect.promise(() => Bun.file(note.path).text())).toBe("External replacement after COMMIT")
    expect(
      (yield* store.recoverExplicit(authority, preview, access, publish, Effect.void).pipe(Effect.result))._tag,
    ).toBe("Failure")
    expect(yield* store.revision).toBe(committedGeneration)
    yield* Effect.promise(() => Bun.write(note.path, original))
    expect((yield* store.recoverExplicit(authority, preview, access, publish, Effect.void)).committed).toBe(true)
    expect(yield* Effect.promise(() => Bun.file(note.path).exists())).toBe(false)
    expect(yield* store.revision).toBe(committedGeneration)
  }),
)

it.live("old clear retry neither publishes later pending notes nor settles another action's tombstone", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home }, { recover: false, strictOwner: true })
    const original = yield* store.remember("Original clear target", access)
    const preview = yield* store.recoveryPreview({ action: "clear", scope: "workspace" }, access)
    expect(
      (yield* store
        .recoverExplicit(authority, preview, access, publish, Effect.fail("stop after COMMIT"))
        .pipe(Effect.result))._tag,
    ).toBe("Failure")
    const later = "topics/later-action.md"
    yield* Effect.promise(() => MemoryV2.publish(store.root, later, "Later action target", true))
    const pending = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const notes = MemoryV2Notes.make(store.root, sql)
      // Canonical journal writers reproduce a later committed deletion and an
      // independently admitted note whose publication has not run yet.
      yield* notes.prepareClear([{ path: later, hash: MemoryV2.hash("Later action target") }])
      return yield* notes.remember("Later pending publication", access, true)
    }).pipe(Effect.provide(layer({ filename: `${store.root.path}/memory_state.sqlite` })))
    expect(yield* Effect.promise(() => Bun.file(pending.path).exists())).toBe(false)
    expect((yield* store.recoverExplicit(authority, preview, access, publish, Effect.void)).committed).toBe(true)
    expect(yield* Effect.promise(() => Bun.file(original.path).exists())).toBe(false)
    expect(yield* Effect.promise(() => Bun.file(`${store.root.path}/MEMORY.md`).exists())).toBe(false)
    expect(
      yield* Effect.promise(async () => ({
        laterTargetExists: await Bun.file(`${store.root.path}/${later}`).exists(),
        pendingNoteExists: await Bun.file(pending.path).exists(),
      })),
    ).toEqual({ laterTargetExists: true, pendingNoteExists: false })
    yield* store.reconcile
    expect(yield* Effect.promise(() => Bun.file(`${store.root.path}/${later}`).exists())).toBe(false)
    expect(yield* Effect.promise(() => Bun.file(pending.path).text())).toBe("Later pending publication")
  }),
)

it.live("explicit clear removes the captured generated index without rebuilding unrelated content", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const store = yield* MemoryCapture.make({ home, directory: home }, { recover: false, strictOwner: true })
    yield* store.remember("An indexed private fact", access)
    const index = `${store.root.path}/MEMORY.md`
    expect(yield* Effect.promise(() => Bun.file(index).exists())).toBe(true)
    const preview = yield* store.recoveryPreview({ action: "clear", scope: "workspace" }, access)
    expect((yield* store.recoverExplicit(authority, preview, access, publish, Effect.void)).status).toBe("completed")
    expect(yield* Effect.promise(() => Bun.file(index).exists())).toBe(false)
  }),
)
