// Goal storage parity under real Bun and Electron processes. Session/UI integration is tested separately.
import assert from "node:assert/strict"
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Goal } from "@apexo/schema/goal"
import { SessionID } from "@apexo/schema/session-id"
import { AbsolutePath } from "@apexo/schema/schema"
import { Database } from "@apexo/core/database/database"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalFiles } from "@apexo/core/session/goal-files"
import { SessionGoalCleanup } from "@apexo/core/session/goal-cleanup"
import { ProjectV2 } from "@apexo/core/project"
import { ProjectTable } from "@apexo/core/project/sql"
import { SessionTable } from "@apexo/core/session/sql"
import { deadline } from "./grok-shell-fixture.mjs"

if (process.argv[2] === "worker") await worker()
else await run()

async function run() {
  const mode = process.argv[2] ?? "cli"
  assert.ok(["cli", "desktop"].includes(mode))
  const output = await mkdtemp(join(tmpdir(), `apexo-goal-storage-${mode}-`))
  const home = join(output, "home")
  await mkdir(home)
  const build = await Bun.build({
    entrypoints: [fileURLToPath(import.meta.url)],
    target: mode === "cli" ? "bun" : "node",
    format: "esm",
    outdir: join(output, "build"),
    external: ["bun:sqlite", "node:sqlite"],
  })
  assert.ok(build.success, build.logs.map(String).join("\n"))
  const engine =
    mode === "cli"
      ? process.execPath
      : resolve(
          "../desktop/node_modules/electron/dist",
          (await readFile("../desktop/node_modules/electron/path.txt", "utf8")).trim(),
        )
  const checks = [],
    evidence = [],
    children = new Set()
  const launch = (step, data = {}) => {
    const child = Bun.spawn(
      [engine, build.outputs[0].path, "worker", join(output, "goals.sqlite"), step, JSON.stringify(data)],
      {
        env: {
          ...process.env,
          APEXO_TEST_HOME: home,
          XDG_DATA_HOME: home,
          XDG_CACHE_HOME: home,
          XDG_CONFIG_HOME: home,
          ...(mode === "desktop" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    children.add(child)
    return child
  }
  const call = async (step, data) => {
    const child = launch(step, data)
    const [stdout, stderr, code] = await deadline(
      Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]),
      30_000,
      `goal ${step}`,
    )
    children.delete(child)
    evidence.push({ step, stdout, stderr, code })
    assert.equal(code, 0, stderr)
    return JSON.parse(stdout.trim())
  }
  const kill = async (step, data, beforeKill) => {
    const child = launch(step, data)
    const reader = child.stdout.getReader()
    const text = { value: "" }
    const ready = async () => {
      while (!text.value.includes("\n")) {
        const chunk = await reader.read()
        assert.ok(!chunk.done, `worker exited before ${step}`)
        text.value += new TextDecoder().decode(chunk.value)
      }
      return JSON.parse(text.value.split("\n")[0])
    }
    const result = await deadline(ready(), 30_000, `goal ${step} readiness`)
    if (beforeKill) await beforeKill(result)
    assert.equal(child.exitCode, null, "parked worker must remain alive until SIGKILL")
    assert.equal(child.signalCode, null, "parked worker must not exit before SIGKILL")
    child.kill("SIGKILL")
    await deadline(child.exited, 10_000, "goal killed child")
    children.delete(child)
    evidence.push({ step, signal: child.signalCode, result })
    assert.equal(child.signalCode, "SIGKILL")
    return result
  }
  try {
    const target = await call("seed", { budget: 1000 })
    const stopped = await kill("work-park", target)
    const raw = await call("read", target)
    assert.equal(raw.status, "active")
    assert.equal(raw.tokensUsed, 125)
    checks.push("sigkill-preserves-committed-goal-and-usage")
    const recovered = await call("recover", { ...target, attemptID: stopped.attemptID })
    assert.equal(recovered.info.status, "user_paused")
    assert.equal(recovered.late.failure.code, "inactive")
    assert.equal(recovered.info.elapsedMs, raw.elapsedMs)
    checks.push("explicit-recovery-pauses-and-fences-late-worker")
    assert.deepEqual(await call("read", target), recovered.info)
    checks.push("new-process-read-does-not-resume")
    for (const tokens of [150, 160, 170, 180, 190]) {
      const charges = await Promise.all(
        [1, 2].map(() => call("usage", { ...target, attemptID: stopped.attemptID, tokens })),
      )
      assert.ok(charges.every((info) => info.tokensUsed === tokens))
    }
    checks.push("concurrent-process-duplicate-usage-counts-once")
    await call("resume", target)
    const verifying = await kill("verify-park", target)
    const interrupted = await call("recover", { ...target, attemptID: verifying.attemptID })
    assert.equal(interrupted.info.status, "user_paused")
    assert.equal(interrupted.late.failure.code, "inactive")
    checks.push("sigkill-verifier-cannot-publish-completion")
    await call("resume", target)
    assert.equal((await call("complete", target)).status, "complete")
    checks.push("fresh-worker-and-independent-verifier-can-complete")
    const budget = await call("seed", { budget: 100 })
    const limit = await call("budget", budget)
    assert.equal(limit.info.status, "budget_limited")
    assert.equal(limit.resume.failure.code, "budget")
    assert.equal((await call("read", budget)).tokensUsed, 120)
    checks.push("budget-is-durable-and-resume-cannot-bypass")
    const crash = await call("seed", { budget: 10 })
    const artifacts = await kill("terminal-park", crash, async (files) => {
      await call("cleanup", crash)
      assert.equal(await readFile(files.scratch, "utf8"), "WORKER")
      checks.push("another-live-process-cannot-release-terminal-teardown")
    })
    await call("cleanup", crash)
    assert.equal(
      await access(artifacts.scratch).then(
        () => true,
        () => false,
      ),
      false,
    )
    assert.equal(
      await access(artifacts.reservedScratch).then(
        () => true,
        () => false,
      ),
      false,
    )
    assert.equal(await readFile(artifacts.plan, "utf8"), "Preserved plan")
    checks.push("sigkill-after-terminal-commit-recovers-backfilled-and-reserved-scratch")
    for (const reason of ["goal_cleared", "session_deleted"]) {
      const target = await call("seed", { budget: 10 })
      const files = await kill("terminal-park", target, async (files) => {
        await call("queue-delete", { ...target, reason })
        await call("cleanup", target)
        assert.equal(await readFile(files.scratch, "utf8"), "WORKER")
      })
      await call("cleanup", target)
      assert.equal(
        await access(files.plan).then(
          () => true,
          () => false,
        ),
        false,
      )
      checks.push(`${reason}-waits-for-live-terminal-owner-and-recovers-after-sigkill`)
    }
    console.log(JSON.stringify({ mode, output, checks }, null, 2))
  } finally {
    for (const child of children) child.kill("SIGKILL")
    await Promise.all([...children].map((child) => child.exited))
    await writeFile(join(output, "evidence.json"), JSON.stringify({ checks, evidence }, null, 2))
  }
}

async function worker() {
  const data = JSON.parse(process.argv[5])
  const step = process.argv[4]
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      const goals = SessionGoal.make(database.db)
      if (step === "seed") {
        const projectID = ProjectV2.ID.make("goal-parity")
        const sessionID = SessionID.create()
        yield* database.db
          .insert(ProjectTable)
          .values({ id: projectID, worktree: AbsolutePath.make(process.cwd()), sandboxes: [] })
          .onConflictDoNothing()
          .run()
        yield* database.db
          .insert(SessionTable)
          .values({
            id: sessionID,
            project_id: projectID,
            slug: "goal",
            directory: process.cwd(),
            title: "Goal",
            version: "1",
          })
          .run()
        const info = yield* goals.create(sessionID, {
          id: Goal.ID.create(),
          objective: "Verify durable Goal lifecycle",
          tokenBudget: data.budget,
        })
        return { sessionID, goalID: info.id }
      }
      if (step === "queue-delete") {
        yield* SessionGoalCleanup.make(database.db, process.env.APEXO_TEST_HOME).prepare(
          data,
          data.reason,
          yield* goals.get(data.sessionID),
        )
        if (data.reason === "goal_cleared") yield* goals.clear(data)
        if (data.reason === "session_deleted")
          yield* database.db.delete(SessionTable).where(eq(SessionTable.id, data.sessionID)).run()
        return true
      }
      if (step === "cleanup") {
        yield* SessionGoalCleanup.make(database.db, process.env.APEXO_TEST_HOME).drain()
        return true
      }
      if (step === "terminal-park") {
        // An unresolved Promise/Effect alone does not keep Electron's Node event loop alive.
        const keepAlive = setInterval(() => {}, 1000)
        yield* Effect.addFinalizer(() => Effect.sync(() => clearInterval(keepAlive)))
        const legacy = yield* Effect.promise(() =>
          SessionGoalFiles.create({
            data: process.env.APEXO_TEST_HOME,
            owner: data,
            kind: "planning",
            objective: "Goal",
            evidence: "{}",
          }),
        )
        yield* Effect.promise(() => legacy.write(legacy.paths.plan, "Preserved plan"))
        const files = yield* Effect.promise(() => legacy.finish())
        yield* Effect.promise(() => writeFile(join(files.files.workerScratch, "scratch.txt"), "WORKER"))
        yield* SessionGoalCleanup.make(database.db, process.env.APEXO_TEST_HOME).backfill(data)
        const attempt = yield* goals.begin(data, "executing")
        const reportID = yield* goals.reserveReport(attempt)
        const reserved = yield* Effect.promise(() =>
          SessionGoalFiles.create({
            data: process.env.APEXO_TEST_HOME,
            owner: data,
            reportID,
            kind: "planning",
            objective: "Goal",
            evidence: "{}",
          }),
        )
        yield* goals.usage(attempt, "budget", 10)
        console.log(
          JSON.stringify({
            scratch: join(files.files.workerScratch, "scratch.txt"),
            plan: files.files.plan.path,
            reservedScratch: join(reserved.paths.plan, "..", "worker"),
          }),
        )
        return yield* Effect.never
      }
      if (step === "read") return yield* goals.get(data.sessionID)
      if (step === "usage") return yield* goals.usage(data, "worker-call", data.tokens)
      if (step === "resume") return yield* goals.resume(data)
      if (step === "recover") {
        const before = yield* goals.get(data.sessionID)
        const info = yield* goals.recover(data, before.revision)
        const late = yield* goals
          .verify(data, { achieved: true, evidence: "Stale process result", unmet: [] })
          .pipe(Effect.result)
        return { info, late }
      }
      if (step === "budget") {
        const work = yield* goals.begin(data, "executing")
        const info = yield* goals.usage(work, "worker-call", 120)
        return { info, resume: yield* goals.resume(data).pipe(Effect.result) }
      }
      const work = yield* goals.begin(data, "executing")
      if (step === "work-park") {
        yield* goals.usage(work, "worker-call", 125)
        console.log(JSON.stringify(work))
        return yield* Effect.never
      }
      yield* goals.update(work, { completed: true, message: "All requested checks completed" })
      yield* goals.finish(work, {})
      const verifier = yield* goals.begin(data, "verifying")
      if (step === "verify-park") {
        console.log(JSON.stringify(verifier))
        return yield* Effect.never
      }
      assert.equal(step, "complete")
      return yield* goals.verify(verifier, {
        achieved: true,
        evidence: "Independent verification of the full objective",
        unmet: [],
      })
    }).pipe(Effect.provide(Database.layerFromPath(process.argv[3])), Effect.scoped),
  )
  console.log(JSON.stringify(result))
}
