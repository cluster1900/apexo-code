import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { readFile, readdir, writeFile, symlink, rm, mkdir } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryHealth } from "@apexo/core/memory-health"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const access = () => true

it.live("health does not initialize absent memory or treat denied access as empty", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, permitted: access }
    expect(yield* MemoryHealth.inspect(input, "workspace", 1000)).toEqual({ scope: "workspace", state: "empty" })
    expect(yield* MemoryHealth.inspect({ ...input, permitted: () => false }, "global", 1000)).toEqual({
      scope: "global",
      state: "denied",
    })
    expect(yield* Effect.promise(() => readdir(home))).toEqual([])
    const root = MemoryV2.directory(input)
    yield* Effect.promise(() => mkdir(root, { recursive: true }))
    expect(yield* MemoryHealth.inspect(input, "workspace", 1000)).toEqual({ scope: "workspace", state: "empty" })
    expect(yield* Effect.promise(() => readdir(root))).toEqual([])
  }),
)

it.live("health reports capture states and never returns source bodies, filenames or error messages", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, permitted: access }
    const store = yield* MemoryCapture.make(input)
    for (const sessionID of ["pending", "running", "retry", "failed", "visible", "hidden"]) {
      yield* store.admit({
        sessionID,
        promptID: "prompt",
        sourcePromptIndex: 0,
        source: "PRIVATE_SOURCE",
        exposed: sessionID !== "hidden",
      })
      if (sessionID === "pending") continue
      const lease = (yield* store.claim({ sessionID, owner: "test", now: 1000, duration: 5000 }))!
      if (sessionID === "running") continue
      if (["retry", "failed"].includes(sessionID)) {
        yield* store.fail(lease, "PRIVATE_ERROR", sessionID === "failed", 1001)
        continue
      }
      yield* store.commit(
        lease,
        MemoryCapture.parse(
          JSON.stringify({ outcome: "observations", observations: [{ type: "project", statement: "PRIVATE_NOTE" }] }),
          "fixture",
          1,
        ),
        1001,
      )
    }
    const info = yield* MemoryHealth.inspect(input, "workspace", 9001)
    expect(info.state).toBe("ready")
    expect(info.snapshot).toMatchObject({
      pendingCaptureJobs: 1,
      runningCaptureJobs: 1,
      publishingCaptureJobs: 0,
      retryCaptureJobs: 1,
      failedCaptureJobs: 1,
      completedCaptureJobs: 2,
      pendingObservations: 1,
      hiddenPendingObservations: 1,
      oldestPendingAgeSecs: 8,
      lastSuccessAt: 1001,
      lastFailureAt: 1001,
      dreamLease: "none",
    })
    expect(JSON.stringify(info)).not.toContain("PRIVATE")
    expect(JSON.stringify(info)).not.toContain(home)
    // Expired capture ownership stays untouched by a diagnostic read.
    expect((yield* store.jobs("running"))[0]?.status).toBe("running")
    const filtered = yield* MemoryHealth.inspect(
      { ...input, permitted: (paths: readonly string[]) => paths.every((file) => !file.includes("/observations/")) },
      "workspace",
      9001,
    )
    expect(filtered.snapshot).toMatchObject({
      pendingObservations: 0,
      hiddenPendingObservations: 0,
      oldestPendingAgeSecs: null,
    })
  }),
)

it.live("health observes active and expired Dream plans without resuming or consuming coalesced triggers", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, permitted: access }
    const store = yield* MemoryCapture.make(input)
    yield* store.remember("PRIVATE_OBSERVATION", access)
    const lease = (yield* store.dreamClaim({ owner: "dream", now: 1000, duration: 1000 }, access))!
    const snapshot = yield* store.dreamInput(lease, 1001, access)
    yield* store.dreamPrepare(
      lease,
      [
        {
          action: "create",
          path: "topics/private.md",
          content: "PRIVATE_TOPIC",
          evidence: snapshot.observations.map((row) => row.path),
        },
      ],
      1002,
      access,
    )
    yield* store.remember("NEW_PRIVATE_OBSERVATION", access)
    expect((yield* MemoryHealth.inspect(input, "workspace", 1003)).snapshot).toMatchObject({
      dreamLease: "active",
      dreamSnapshotSize: 1,
      dreamPlanPending: true,
      hasCoalescedTrigger: true,
    })
    expect((yield* MemoryHealth.inspect(input, "workspace", 3000)).snapshot).toMatchObject({
      dreamLease: "expired",
      dreamPlanPending: true,
      hasCoalescedTrigger: true,
    })
    expect(
      yield* Effect.promise(() => readFile(path.join(store.root.path, snapshot.observations[0]!.path), "utf8")),
    ).toContain("PRIVATE_OBSERVATION")
    const resumed = (yield* store.dreamClaim({ owner: "recovery", now: 3000, duration: 1000 }, access))!
    yield* store.dreamResume(resumed, 3001, access)
    expect((yield* MemoryHealth.inspect(input, "workspace", 3002)).snapshot).toMatchObject({
      dreamLease: "none",
      lastSuccessAt: 3001,
      archiveCount: 1,
      hasCoalescedTrigger: true,
    })
    yield* store.dreamConsumeTrigger
    expect((yield* MemoryHealth.inspect(input, "workspace", 3002)).snapshot?.hasCoalescedTrigger).toBe(false)
    yield* store.clear
    expect((yield* MemoryHealth.inspect(input, "workspace", 3003)).snapshot).toMatchObject({
      pendingObservations: 0,
      lastSuccessAt: null,
      archiveCount: 0,
    })
  }),
)

it.live("health reports an incompatible schema without migrating it", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, permitted: access }
    const store = yield* MemoryCapture.make(input)
    yield* Effect.sync(() => {
      using db = new Database(path.join(store.root.path, "memory_state.sqlite"))
      db.run("UPDATE capture_meta SET value = 'future' WHERE key = 'version'")
    })
    expect(yield* MemoryHealth.inspect(input, "workspace", 1000)).toEqual({
      scope: "workspace",
      state: "unavailable",
      reason: "schema",
    })
    yield* Effect.sync(() => {
      using db = new Database(path.join(store.root.path, "memory_state.sqlite"), { readonly: true })
      expect(db.query("SELECT value FROM capture_meta WHERE key = 'version'").get()).toEqual({ value: "future" })
    })
  }),
)

it.live("health rejects symlinked sidecars and damaged storage instead of returning empty counts", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const input = { home, directory: home, permitted: access }
    const root = yield* Effect.scoped(MemoryCapture.make(input).pipe(Effect.map((store) => store.root.path)))
    yield* Effect.promise(async () => {
      await rm(path.join(root, "memory_state.sqlite"), { force: true })
      await rm(path.join(root, "memory_state.sqlite-wal"), { force: true })
      await rm(path.join(root, "memory_state.sqlite-shm"), { force: true })
      await writeFile(path.join(root, "memory_state.sqlite"), "PRIVATE_CORRUPT_DATABASE")
    })
    expect((yield* MemoryHealth.inspect(input, "workspace", 1000)).state).toBe("unavailable")
    yield* Effect.promise(() => symlink(home, path.join(root, "memory_state.sqlite-wal")))
    expect(yield* MemoryHealth.inspect(input, "workspace", 1000)).toEqual({
      scope: "workspace",
      state: "unavailable",
      reason: "path",
    })
  }),
)
