// Real Bun/Electron processes and shared SQLite, including killed Dream owners.
// This exercises storage; production session and UI scripts verify separate behavior.
import assert from "node:assert/strict"
import { chmod, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { MemoryCapture } from "@apexo/core/memory-capture"

if (process.argv[2] === "worker") await worker()
else await run()

async function run() {
  const mode = process.argv[2] ?? "cli"
  const retention = process.argv.includes("--retention")
  assert.ok(["cli", "desktop"].includes(mode))
  const output = await mkdtemp(join(tmpdir(), `apexo-memory-${retention ? "retention" : "dream"}-${mode}-`))
  const home = join(output, "home")
  await mkdir(home)
  const build = await Bun.build({
    entrypoints: [fileURLToPath(import.meta.url)],
    target: mode === "cli" ? "bun" : "node",
    format: "esm",
    outdir: join(output, "build"),
    external: ["bun:sqlite", "node:sqlite"],
  })
  assert.equal(build.success, true, build.logs.map(String).join("\n"))
  const engine =
    mode === "cli"
      ? process.execPath
      : resolve(
          "../desktop/node_modules/electron/dist",
          (await readFile("../desktop/node_modules/electron/path.txt", "utf8")).trim(),
        )
  const children = new Set()
  const checks = [],
    evidence = []
  const spawn = (step, scenario, extra = {}) => {
    const child = Bun.spawn([engine, build.outputs[0].path, "worker", home, step, scenario, JSON.stringify(extra)], {
      env: { ...process.env, ...(mode === "desktop" ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
      stdout: "pipe",
      stderr: "pipe",
    })
    children.add(child)
    return child
  }
  const finish = async (child) => {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    children.delete(child)
    evidence.push({ stdout, stderr, code })
    assert.equal(code, 0, stderr)
    return JSON.parse(stdout)
  }
  const call = (step, scenario, extra) => finish(spawn(step, scenario, extra))
  const kill = async (step, scenario) => {
    const child = spawn(step, scenario)
    const reader = child.stdout.getReader()
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000)
    let text = ""
    try {
      while (!text.includes("\n")) {
        const value = await reader.read()
        if (value.done) throw new Error(`Dream worker exited before readiness: ${text}`)
        text += new TextDecoder().decode(value.value)
      }
      const result = JSON.parse(text.split("\n")[0])
      child.kill("SIGKILL")
      await child.exited
      children.delete(child)
      evidence.push({ killed: step, result })
      return result
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    if (retention) {
      for (const step of ["retention-park-journal", "retention-park-unlinked"]) {
        await call("retention-seed", step)
        const stopped = await kill(step, step)
        assert.equal(stopped.journals, 1)
        assert.equal(stopped.archiveFiles, step === "retention-park-journal" ? 1 : 0)
        const recovered = await call("retention-gc", step)
        assert.deepEqual(recovered.gc, { archives: 1, jobs: 1 })
        assert.equal(recovered.journals, 0)
        assert.equal(recovered.archiveFiles, 0)
        assert.equal(recovered.topics.length, 1)
        assert.equal(recovered.matches.length, 1)
        assert.deepEqual((await call("retention-gc", step)).gc, { archives: 0, jobs: 0 })
        checks.push(
          step === "retention-park-journal"
            ? "killed-after-journal-commit-replays-file-deletion"
            : "killed-after-unlink-replays-sql-cleanup",
        )
      }
      await call("retention-seed", "race")
      const contenders = await Promise.all([
        finish(spawn("retention-gc", "race")),
        finish(spawn("retention-gc", "race")),
      ])
      assert.equal(
        contenders.reduce((sum, row) => sum + row.gc.archives, 0),
        1,
      )
      assert.equal(
        contenders.reduce((sum, row) => sum + row.gc.jobs, 0),
        1,
      )
      checks.push("two-process-retention-collects-once")
      await call("retention-seed", "active")
      await call("arrival", "active")
      await kill("park-claim", "active")
      const busy = await call("retention-gc", "active", { now: 5999 })
      assert.equal(busy.reason, "busy")
      assert.equal(busy.archiveFiles, 1)
      assert.equal((await call("retention-gc", "active", { now: 6000 })).gc.archives, 1)
      checks.push("live-dream-lease-defers-other-process", "expired-inference-allows-retention")
      await call("retention-seed", "clear-retention")
      await kill("retention-park-unlinked", "clear-retention")
      const cleared = await call("retention-clear", "clear-retention")
      assert.equal(cleared.journals, 0)
      assert.equal(cleared.topics.length, 0)
      assert.deepEqual((await call("retention-gc", "clear-retention")).gc, { archives: 0, jobs: 0 })
      checks.push("clear-fences-pending-retention", "topic-and-index-survive-normal-retention")
    } else {
      await call("seed", "lease")
      const parked = await kill("park-claim", "lease")
      assert.equal((await call("claim", "lease", { now: 5999 })).reason, "busy")
      const successor = await call("claim", "lease", { now: 6000 })
      assert.notEqual(successor.lease.token, parked.lease.token)
      assert.equal((await call("stale", "lease", { lease: parked.lease })).reason, "stale_lease")
      checks.push("killed-owner-stays-exclusive-until-expiry", "expired-lease-reclaimed-and-old-worker-fenced")
      await call("seed", "contenders")
      const contenders = await Promise.all([finish(spawn("claim", "contenders")), finish(spawn("claim", "contenders"))])
      assert.equal(contenders.filter((result) => result.lease).length, 1)
      checks.push("two-process-claim-exclusion")
      for (const step of ["park-plan", "park-archive-failure", "park-applied"]) {
        await call("seed", step)
        const stopped = await kill(step, step)
        await call("arrival", step)
        const resumed = await call("resume", step, { now: 6000 })
        assert.equal(resumed.lease.id, stopped.lease.id)
        assert.equal(resumed.lease.planned, true)
        assert.equal(resumed.result.observations, 1)
        assert.equal(resumed.result.topics.length, 2)
        assert.equal(resumed.pending.length, 1)
        assert.equal(resumed.topics.length, 2)
        assert.equal(resumed.matches.length, 2)
        assert.equal(resumed.archives.length, 1)
        const again = await call("resume", step, { now: 6001, lease: resumed.lease })
        assert.deepEqual(again.result, resumed.result)
        checks.push(
          step === "park-plan"
            ? "durable-plan-replays-without-model-and-excludes-arrivals"
            : step === "park-applied"
              ? "post-archive-crash-converges-index-and-manifest"
              : "topic-and-archive-files-replay-after-real-sqlite-failure",
        )
      }
      await call("seed", "clear")
      const pending = await kill("park-plan", "clear")
      const cleared = await call("clear", "clear")
      assert.equal(cleared.pending.length, 0)
      assert.equal(cleared.topics.length, 0)
      assert.equal(cleared.journals, 0)
      assert.equal((await call("stale", "clear", { lease: pending.lease })).reason, "stale_lease")
      checks.push(
        "clear-removes-plans-and-fences-killed-worker",
        "idempotent-replay-does-not-reconsume-new-observations",
      )
    }
    console.log(
      JSON.stringify(
        {
          mode,
          retention,
          scope: "Memory V2 Core process recovery",
          passed: checks.length,
          checks,
          output,
        },
        null,
        2,
      ),
    )
  } finally {
    for (const child of children) child.kill("SIGKILL")
    await Promise.all([...children].map((child) => child.exited))
    await writeFile(join(output, "evidence.json"), JSON.stringify({ checks, evidence }, null, 2))
    console.error(`Dream storage evidence: ${output}`)
  }
}

async function worker() {
  const [home, step, scenario, raw] = process.argv.slice(3)
  const extra = JSON.parse(raw)
  const now = extra.now ?? 1000
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const memory = yield* MemoryCapture.make({ home, directory: home, projectID: scenario })
        const result = { root: memory.root.path, runtime: process.versions }
        const access = () => true
        const database = async () => {
          if (process.versions.bun) {
            const { Database } = await import("bun:sqlite")
            return new Database(join(memory.root.path, "memory_state.sqlite"))
          }
          const { DatabaseSync } = await import("node:sqlite")
          return new DatabaseSync(join(memory.root.path, "memory_state.sqlite"))
        }
        if (step.startsWith("retention-")) {
          if (step === "retention-seed") {
            yield* memory.admit({
              sessionID: "retention",
              promptID: "prompt",
              sourcePromptIndex: 0,
              source: "source",
              exposed: true,
            })
            const capture = yield* memory.claim({ owner: "capture", now: 1000, duration: 5000 })
            yield* memory.commit(
              capture,
              MemoryCapture.parse(
                '{"outcome":"observations","observations":[{"type":"project","statement":"Retained durable observation"}]}',
                "fixture",
                1,
              ),
              1001,
            )
            const lease = yield* memory.dreamClaim({ owner: "dream", now: 1002, duration: 5000 }, access)
            const input = yield* memory.dreamInput(lease, 1002, access)
            yield* memory.dreamCommit(
              lease,
              [
                {
                  action: "create",
                  path: "topics/retained.md",
                  content: "# Retained\nDREAM_DURABLE_TOPIC",
                  evidence: input.observations.map((row) => row.path),
                },
              ],
              1003,
              access,
            )
          }
          if (step === "retention-park-journal")
            yield* Effect.promise(() => chmod(join(memory.root.path, "archive"), 0o500))
          if (step === "retention-park-unlinked")
            yield* Effect.promise(async () => {
              const db = await database()
              db.exec(
                "CREATE TRIGGER fail_retention BEFORE DELETE ON dream_archives BEGIN SELECT RAISE(ABORT, 'retention fault'); END",
              )
              db.close()
            })
          if (step === "retention-gc" || step === "retention-clear") {
            yield* Effect.promise(async () => {
              await chmod(join(memory.root.path, "archive"), 0o700)
              const db = await database()
              db.exec("DROP TRIGGER IF EXISTS fail_retention")
              db.close()
            })
          }
          if (step === "retention-clear") yield* memory.clear
          if (step === "retention-gc" || step.startsWith("retention-park-")) {
            const value = yield* memory
              .gc(extra.now ?? 10000, { archivedDays: 0, jobDays: 0 }, access)
              .pipe(Effect.result)
            if (value._tag === "Success") result.gc = value.success
            if (value._tag === "Failure") result.reason = value.failure.reason ?? "storage"
          }
          result.journals = yield* Effect.promise(async () => {
            const db = await database()
            const row = db.prepare("SELECT count(*) AS n FROM memory_gc_archives").get()
            db.close()
            return row.n
          })
          result.archiveFiles = (yield* Effect.promise(() => readdir(join(memory.root.path, "archive")))).length
          if (step.startsWith("retention-park-")) {
            assert.ok(result.reason)
            console.log(JSON.stringify(result))
            return yield* Effect.never
          }
        }
        if (step === "seed" || step === "arrival")
          yield* memory.remember(step === "seed" ? "DREAM_DURABLE_ORIGINAL" : "DREAM_LATER_ARRIVAL", access)
        if (step === "stale") {
          const value = yield* memory.dreamInput(extra.lease, now + 1, access).pipe(Effect.result)
          result.reason = value._tag === "Failure" ? value.failure.reason : "unexpected-success"
        }
        if (step === "claim" || step.startsWith("park-") || step === "resume") {
          if (step === "resume")
            yield* Effect.promise(async () => {
              const db = await database()
              db.exec("DROP TRIGGER IF EXISTS fail_dream_archive")
              db.close()
            })
          const value = extra.lease
            ? { _tag: "Success", success: extra.lease }
            : yield* memory.dreamClaim({ owner: String(process.pid), now, duration: 5000 }, access).pipe(Effect.result)
          if (value._tag === "Failure") result.reason = value.failure.reason
          if (value._tag === "Success") {
            result.lease = value.success
            if (step === "resume") result.result = yield* memory.dreamResume(result.lease, now + 1, access)
            if (step.startsWith("park-") && step !== "park-claim") {
              const input = yield* memory.dreamInput(result.lease, now + 1, access)
              const evidence = input.observations.map((row) => row.path)
              yield* memory.dreamPrepare(
                result.lease,
                [
                  { action: "create", path: "topics/a.md", content: "# Alpha\nDREAM_DURABLE_TOPIC", evidence },
                  { action: "create", path: "topics/b.md", content: "# Beta\nDREAM_DURABLE_TOPIC", evidence },
                ],
                now + 2,
                access,
              )
              if (step === "park-archive-failure") {
                yield* Effect.promise(async () => {
                  const db = await database()
                  db.exec(
                    "CREATE TRIGGER fail_dream_archive BEFORE INSERT ON dream_archives BEGIN SELECT RAISE(ABORT, 'archive commit failure'); END",
                  )
                  db.close()
                })
                const failure = yield* memory.dreamApply(result.lease, now + 3, access).pipe(Effect.result)
                assert.equal(failure._tag, "Failure")
                result.failure = String(failure.failure)
                assert.equal((yield* Effect.promise(() => readdir(join(memory.root.path, "topics")))).length, 2)
                assert.equal((yield* Effect.promise(() => readdir(join(memory.root.path, "archive")))).length, 1)
              }
              if (step === "park-applied") yield* memory.dreamApply(result.lease, now + 3, access)
            }
          }
          if (step.startsWith("park-")) {
            console.log(JSON.stringify(result))
            return yield* Effect.never
          }
        }
        if (step === "clear") {
          yield* memory.clear
          result.journals = yield* Effect.promise(async () => {
            const db = await database()
            const value = db.prepare("SELECT COUNT(*) AS count FROM dream_runs").get()
            db.close()
            return value.count
          })
        }
        result.pending = yield* Effect.promise(() => readdir(join(memory.root.path, "observations/_inbox")))
        result.topics = yield* Effect.promise(() => readdir(join(memory.root.path, "topics")))
        result.archives = yield* Effect.promise(() => readdir(join(memory.root.path, "archive")))
        result.matches = yield* memory.search("DREAM_DURABLE_TOPIC")
        console.log(JSON.stringify(result))
      }),
    ),
  )
}
