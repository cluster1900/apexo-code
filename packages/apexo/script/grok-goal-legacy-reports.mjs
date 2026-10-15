// Synthetic compatibility state, not a captured historical database. Real report writer and server maintenance.
import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import { access, readFile, readdir, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { SessionGoalFiles } from "@apexo/core/session/goal-files"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const runtime = await startShellFixture(kind)
const checks = []
const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  )
const rows = []
const plan = "# Original synthetic legacy plan\n- [ ] Preserve historical report authority\n"
const state = { database: undefined }
const read = (sessionID) =>
  JSON.parse(state.database.query("SELECT data FROM session_goal WHERE session_id = ?").get(sessionID).data)
const jobs = (sessionID) =>
  state.database.query("SELECT * FROM session_goal_cleanup WHERE session_id = ?").all(sessionID)
try {
  // Sessions and initial Goals are admitted through the real API; no provider work is requested.
  for (const scenario of ["unknown", "live", "dead"]) {
    const session = await runtime.api("/session", { title: `Synthetic legacy reports: ${scenario}` })
    const goal = await runtime.api(`/session/${session.id}/goal`, {
      id: `goal_${crypto.randomUUID().replaceAll("-", "")}`,
      objective: "Preserve synthetic legacy evidence",
      tokenBudget: 1,
    })
    rows.push({ scenario, sessionID: session.id, goalID: goal.id })
  }
  await runtime.crash()
  const filename = (await readdir(runtime.env.XDG_DATA_HOME, { recursive: true })).find((file) => file.endsWith(".db"))
  assert.ok(filename)
  state.database = new Database(join(runtime.env.XDG_DATA_HOME, filename))
  const child = Bun.spawn([process.execPath, "-e", "process.exit(0)"], { stdout: "ignore", stderr: "ignore" })
  assert.equal(await child.exited, 0)
  for (const row of rows) {
    const writer = await SessionGoalFiles.create({
      data: join(runtime.env.XDG_DATA_HOME, "apexo"),
      kind: "planning",
      objective: "Preserve synthetic legacy evidence",
      evidence: JSON.stringify({ syntheticLegacyFixture: true, scenario: row.scenario }),
    })
    await writer.write(writer.paths.plan, plan)
    row.files = (await writer.finish()).files
    await writeFile(join(row.files.workerScratch, "keep.txt"), "PRIVATE SCRATCH")
    assert.equal(await exists(join(row.files.directory, ".report.json")), false)
    const stored = read(row.sessionID)
    // Deliberately construct an older storage shape using actual persisted report hashes.
    // This fixture proves migration semantics, not the historical existence of these records.
    row.info = { ...stored.info, status: "budget_limited", phase: "idle", tokensUsed: 1, plan, plannerFiles: row.files }
    const legacy = Object.fromEntries(
      Object.entries({ ...stored, info: row.info }).filter(
        ([key]) => !["reportIDs", "reportRetentionDays", "terminalReportRecovery"].includes(key),
      ),
    )
    state.database
      .query("UPDATE session_goal SET data = ? WHERE session_id = ?")
      .run(JSON.stringify(legacy), row.sessionID)
    state.database.query("DELETE FROM session_goal_cleanup WHERE session_id = ?").run(row.sessionID)
    if (row.scenario !== "unknown") {
      state.database
        .query(
          "INSERT INTO session_goal_cleanup (id, session_id, goal_id, reason, data, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          `synthetic-retention-${row.scenario}`,
          row.sessionID,
          row.goalID,
          "retention",
          JSON.stringify({
            ids: [],
            info: row.info,
            after: Date.now() + 86_400_000,
            owner: { pid: row.scenario === "live" ? process.pid : child.pid, token: `synthetic-${row.scenario}-owner` },
          }),
          Date.now(),
        )
    }
    row.messages = state.database.query("SELECT * FROM session_message WHERE session_id = ?").all(row.sessionID)
  }
  await runtime.reopen()
  for (const row of rows) {
    await poll(async () => read(row.sessionID).terminalReportRecovery, `${row.scenario} startup discovery`)
    const recovery = read(row.sessionID).terminalReportRecovery
    assert.equal(recovery.status, row.scenario === "unknown" ? "unverified" : "scheduled")
    assert.deepEqual(recovery.ids, [basename(row.files.directory)])
    assert.deepEqual(await runtime.api(`/session/${row.sessionID}/goal`), row.info)
    const reports = await runtime.api(`/session/${row.sessionID}/goal/${row.goalID}/reports`)
    assert.equal(reports.length, 1)
    const report = await runtime.api(`/session/${row.sessionID}/goal/${row.goalID}/reports/${reports[0].id}/plan`)
    assert.equal(report.text, plan)
    assert.equal(report.sha256, row.files.plan.sha256)
    if (row.scenario === "dead")
      await poll(async () => !(await exists(row.files.workerScratch)), "verified dead-owner scratch cleanup")
    assert.equal(await exists(row.files.workerScratch), row.scenario !== "dead")
    assert.equal(await readFile(row.files.plan.path, "utf8"), plan)
    assert.deepEqual(
      state.database.query("SELECT * FROM session_message WHERE session_id = ?").all(row.sessionID),
      row.messages,
    )
    assert.equal(jobs(row.sessionID).length, row.scenario === "unknown" ? 0 : row.scenario === "live" ? 2 : 1)
    checks.push(`${row.scenario}-ownership-recovered-with-original-plan-hash-and-public-state`)
  }
  await runtime.crash()
  await runtime.reopen()
  for (const row of rows) {
    assert.deepEqual(await runtime.api(`/session/${row.sessionID}/goal`), row.info)
    assert.equal(await exists(row.files.workerScratch), row.scenario !== "dead")
    assert.equal(
      read(row.sessionID).terminalReportRecovery.status,
      row.scenario === "unknown" ? "unverified" : "scheduled",
    )
  }
  assert.equal(runtime.calls.length, 0)
  checks.push("reopen-is-idempotent-and-never-retries-provider-work")
  console.log(
    JSON.stringify(
      {
        kind,
        fixture: "explicitly synthetic legacy state",
        checks,
        requests: runtime.calls.length,
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  state.database?.close()
  await writeFile(
    join(runtime.output, "goal-legacy-reports.json"),
    JSON.stringify({ kind, fixture: "explicitly synthetic legacy state", checks }, null, 2),
  )
  await runtime.close()
}
