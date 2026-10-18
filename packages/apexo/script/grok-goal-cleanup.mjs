import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import { access, readFile, readdir, rename, symlink, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startGoalFixture } from "./grok-goal-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const { runtime, control } = await startGoalFixture(kind)
const checks = []
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  )
const create = async (session, tokenBudget) => {
  const owner = session ?? (await runtime.api("/session", { title: "Goal lifecycle cleanup" }))
  const root = `/session/${owner.id}/goal`
  const info = await runtime.api(root, {
    id: `goal_${crypto.randomUUID().replaceAll("-", "")}`,
    objective: "Keep reports, remove private scratch",
    ...(tokenBudget ? { tokenBudget } : {}),
  })
  await runtime.api(`${root}/${info.id}/start`, { agent: "build", model: { providerID: "xai", id: "grok-4.7" } })
  return { session: owner, root, info, reports: `${root}/${info.id}/reports` }
}
let databaseFile
const pending = async () => {
  // Locate the database once: a recursive scan races with the cleanup it is observing (ENOENT on
  // directories that are being deleted).
  databaseFile ??= (await readdir(runtime.env.XDG_DATA_HOME, { recursive: true }).catch(() => [])).find((file) =>
    file.endsWith(".db"),
  )
  const file = databaseFile
  assert.ok(file, "Expected fixture database")
  const database = new Database(join(runtime.env.XDG_DATA_HOME, file), { readonly: true })
  try {
    return database.query("SELECT session_id, goal_id, reason FROM session_goal_cleanup").all()
  } finally {
    database.close()
  }
}
try {
  await writeFile(join(runtime.directory, "keep-project.txt"), "PROJECT")
  control.hold = Promise.withResolvers()
  const first = await create()
  const active = await poll(async () => {
    const info = await runtime.api(first.root)
    return info.phase === "executing" && info.plannerFiles && info
  }, "active goal with persisted plan")
  await writeFile(join(active.plannerFiles.workerScratch, "scratch.txt"), "WORKER")
  await runtime.api(`${first.root}/${first.info.id}/pause`, undefined, "POST")
  assert.equal(await readFile(join(active.plannerFiles.workerScratch, "scratch.txt"), "utf8"), "WORKER")
  assert.equal((await pending()).length, 0)
  checks.push("pause-preserves-plan-and-worker-scratch")
  control.hold.resolve()
  control.hold = undefined
  await runtime.api(`${first.root}/${first.info.id}/resume`, undefined, "POST")
  await poll(async () => (await runtime.api(first.root)).status === "complete", "goal completion")
  await poll(async () => !(await exists(active.plannerFiles.workerScratch)), "terminal scratch removal")
  const reports = await runtime.api(first.reports)
  assert.equal(reports.length, 4)
  const planner = reports.find((item) => item.kind === "planning")
  assert.equal(
    (await runtime.api(`${first.reports}/${planner.id}/plan`)).text,
    await readFile(active.plannerFiles.plan.path, "utf8"),
  )
  checks.push("completion-cleans-scratch-and-retains-downloadable-reports")
  const budget = await create(undefined, 1)
  await poll(async () => (await runtime.api(budget.root)).status === "budget_limited", "budget stop")
  const root = join(runtime.env.XDG_DATA_HOME, "apexo", "goal-reviews", budget.session.id, budget.info.id)
  await poll(async () => {
    const entries = await readdir(root, { recursive: true })
    return !entries.some(
      (entry) => entry === "worker" || entry.endsWith("/worker") || entry.includes(".deleting-worker-"),
    )
  }, "budget scratch cleanup")
  checks.push("budget-stop-cleans-private-worker-directories")

  for (const scenario of [
    { reason: "goal_cleared", restart: true },
    { reason: "session_deleted", restart: true },
    { reason: "goal_cleared", restart: false },
  ]) {
    const reason = scenario.reason
    control.hold = Promise.withResolvers()
    const target = await create(reason === "session_deleted" ? first.session : undefined)
    const running = await poll(async () => {
      const info = await runtime.api(target.root)
      return info.phase === "executing" && info.plannerFiles && info
    }, `${reason} running`)
    const directory = running.plannerFiles.directory
    const saved = `${directory}-saved`
    await rename(directory, saved)
    await symlink(saved, directory)
    // The real cleanup rejects a substituted directory and leaves a durable retry, without test-only fault hooks.
    await runtime.api(
      reason === "session_deleted" ? `/session/${target.session.id}` : `${target.root}/${target.info.id}`,
      undefined,
      "DELETE",
    )
    control.hold.resolve()
    control.hold = undefined
    assert.ok((await pending()).some((job) => job.session_id === target.session.id && job.reason === reason))
    assert.equal(await readFile(join(saved, "plan.md"), "utf8"), "Implement the objective and verify the result")
    if (reason === "goal_cleared") assert.equal(await runtime.api(target.root), null)
    if (reason === "session_deleted") {
      const response = await fetch(`${runtime.url}/session/${target.session.id}`)
      assert.equal(response.status, 404)
    }
    if (scenario.restart) await runtime.crash()
    await unlink(directory)
    await rename(saved, directory)
    if (scenario.restart) await runtime.reopen()
    await poll(async () => !(await exists(directory)), `${reason} recovery`, scenario.restart ? 10_000 : 75_000)
    await poll(
      async () => !(await pending()).some((job) => job.session_id === target.session.id),
      `${reason} queue drained`,
    )
    checks.push(
      scenario.restart
        ? `${reason}-persists-failed-cleanup-and-recovers-after-sigkill`
        : "periodic-background-retry-cleans-repaired-files-without-restart",
    )
  }
  assert.equal(await exists(active.plannerFiles.directory), false, "Session deletion includes prior Goal reports")
  assert.equal(await readFile(join(runtime.directory, "keep-project.txt"), "utf8"), "PROJECT")
  assert.equal((await runtime.api(budget.root)).status, "budget_limited", "Other Session remains intact")
  checks.push("session-deletion-cleans-old-goals-and-preserves-project-and-other-sessions")
  console.log(JSON.stringify({ kind, checks, requests: runtime.calls.length, output: runtime.output }, null, 2))
} finally {
  control.hold?.resolve()
  await writeFile(join(runtime.output, "goal-cleanup.json"), JSON.stringify({ checks }, null, 2))
  await runtime.close()
}
