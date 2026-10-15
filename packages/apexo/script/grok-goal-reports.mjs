import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startGoalFixture } from "./grok-goal-fixture.mjs"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const { runtime, control } = await startGoalFixture(kind)
const checks = []
const history = []
const status = async (endpoint, method = "GET") => {
  const response = await fetch(`${runtime.url}${endpoint}?directory=${encodeURIComponent(runtime.directory)}`, {
    method,
  })
  await response.text()
  return response.status
}
const command = async (...args) => {
  const child = Bun.spawn(
    [process.execPath, resolve("src/index.ts"), "goal", ...args, "--attach", runtime.url, "--dir", runtime.directory],
    { env: runtime.env, stdout: "pipe", stderr: "pipe" },
  )
  try {
    const [code, stdout, stderr] = await deadline(
      Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]),
      30000,
      "report CLI",
    )
    history.push({ args, code, stdout, stderr })
    return { code, stdout, stderr }
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL")
  }
}
const create = async () => {
  const session = await runtime.api("/session", { title: "Report ownership" })
  const root = `/session/${session.id}/goal`
  const info = await runtime.api(root, {
    id: `goal_${randomUUID().replaceAll("-", "")}`,
    objective: "Inspect complete reports 中文 😀",
  })
  await runtime.api(`${root}/${info.id}/start`, { agent: "build", model: { providerID: "xai", id: "grok-4.7" } })
  return { session, info, root, reports: `${root}/${info.id}/reports` }
}
try {
  control.hold = Promise.withResolvers()
  const first = await create()
  await poll(async () => (await runtime.api(first.root)).phase === "executing", "report worker active")
  assert.equal(await status(first.reports, "DELETE"), 409)
  const active = await runtime.api(first.reports)
  assert.ok(active.some((item) => item.complete))
  checks.push("active-goal-reports-readable-and-protected-from-cleanup")
  await runtime.api(`${first.root}/${first.info.id}/pause`, undefined, "POST")
  control.hold.resolve()
  control.hold = undefined
  assert.equal(await status(first.reports, "DELETE"), 409)
  checks.push("paused-goal-plan-and-scratch-remain-protected")
  await runtime.api(`${first.root}/${first.info.id}/resume`, undefined, "POST")
  const completed = await poll(async () => {
    const info = await runtime.api(first.root)
    return info.status === "complete" && info
  }, "report goal completed")
  const reports = await runtime.api(first.reports)
  assert.equal(reports.length, 4)
  for (const report of reports)
    for (const file of report.files) {
      const data = await runtime.api(`${first.reports}/${report.id}/${file.key}`)
      assert.equal(data.bytes, Buffer.byteLength(data.text))
      assert.equal(data.sha256, createHash("sha256").update(data.text).digest("hex"))
      assert.equal(data.sha256, file.sha256)
    }
  checks.push("all-plan-verdict-evidence-and-change-files-download-with-original-hashes")
  await runtime.crash()
  await runtime.reopen()
  assert.deepEqual(await runtime.api(first.reports), reports)
  checks.push("catalog-and-downloads-survive-real-process-reopen")
  const planner = reports.find((item) => item.kind === "planning")
  const endpoint = `${first.reports}/${planner.id}/plan`
  const original = await readFile(completed.plannerFiles.plan.path, "utf8")
  await writeFile(completed.plannerFiles.plan.path, "FORGED")
  assert.equal(await status(endpoint), 409)
  const catalog = join(completed.plannerFiles.directory, ".report.json")
  const originalCatalog = await readFile(catalog, "utf8")
  const forgedCatalog = JSON.parse(originalCatalog)
  forgedCatalog.files.plan.sha256 = createHash("sha256").update("FORGED").digest("hex")
  forgedCatalog.files.plan.bytes = Buffer.byteLength("FORGED")
  await writeFile(catalog, JSON.stringify(forgedCatalog))
  assert.equal(await status(endpoint), 409, "Persisted hashes must defeat simultaneous catalog and content tampering")
  await writeFile(catalog, originalCatalog)
  await writeFile(completed.plannerFiles.plan.path, original)
  const other = await runtime.api("/session", { title: "Other report owner" })
  assert.equal(await status(`/session/${other.id}/goal/${first.info.id}/reports/${planner.id}/plan`), 404)
  assert.deepEqual(await runtime.api(`/session/${other.id}/goal/${first.info.id}/reports`), [])
  checks.push("modified-files-and-cross-session-report-access-rejected")
  const listed = await command("reports", "--session", first.session.id)
  assert.equal(listed.code, 0, listed.stderr)
  assert.deepEqual(JSON.parse(listed.stdout), reports)
  const output = join(runtime.output, "downloaded-plan.md")
  const download = await command(
    "report",
    "--session",
    first.session.id,
    "--report",
    planner.id,
    "--file",
    "plan",
    "--output",
    output,
  )
  assert.equal(download.code, 0, download.stderr)
  assert.equal(await readFile(output, "utf8"), original)
  assert.notEqual(
    (
      await command(
        "report",
        "--session",
        first.session.id,
        "--report",
        planner.id,
        "--file",
        "plan",
        "--output",
        output,
      )
    ).code,
    0,
  )
  assert.equal(await readFile(output, "utf8"), original)
  checks.push("headless-cli-lists-and-downloads-without-overwriting-existing-files")
  const cleanup = await command("cleanup-reports", "--session", first.session.id)
  assert.equal(cleanup.code, 0, cleanup.stderr)
  assert.deepEqual(JSON.parse(cleanup.stdout), { removed: 4, failed: [] })
  assert.deepEqual(await runtime.api(first.reports), [])
  assert.equal((await runtime.api(first.root)).status, "complete")
  assert.equal(await status(endpoint), 404)
  checks.push("completed-report-cleanup-is-idempotent-and-preserves-goal-result")
  control.hold = Promise.withResolvers()
  const second = await create()
  await poll(async () => (await runtime.api(second.root)).phase === "executing", "clear goal active")
  assert.ok((await runtime.api(second.reports)).length)
  await runtime.api(`${second.root}/${second.info.id}`, undefined, "DELETE")
  control.hold.resolve()
  control.hold = undefined
  assert.equal(await runtime.api(second.root), null)
  assert.deepEqual(await runtime.api(second.reports), [])
  assert.deepEqual(await runtime.api(second.reports, undefined, "DELETE"), { removed: 0, failed: [] })
  assert.ok((await runtime.api(`/session/${second.session.id}/message`)).length)
  checks.push("clear-stops-execution-cleans-private-reports-and-keeps-transcript")
  console.log(JSON.stringify({ kind, checks, requests: runtime.calls.length, output: runtime.output }, null, 2))
} finally {
  control.hold?.resolve()
  await writeFile(join(runtime.output, "goal-reports.json"), JSON.stringify({ checks, history }, null, 2))
  await runtime.close()
}
