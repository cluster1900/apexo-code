import assert from "node:assert/strict"
import { access } from "node:fs/promises"
import { startGoalFixture } from "./grok-goal-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const { runtime, control } = await startGoalFixture(kind, {
  reject: 2,
  config: { goal: { report_retention_days: 0 } },
})
try {
  const session = await runtime.api("/session", { title: "Goal report retention" })
  const root = `/session/${session.id}/goal`
  const goal = await runtime.api(root, {
    id: `goal_${crypto.randomUUID().replaceAll("-", "")}`,
    objective: "Verify report retention after multiple independent reviews",
  })
  await runtime.api(`${root}/${goal.id}/start`, { agent: "build", model: { providerID: "xai", id: "grok-4.7" } })
  const info = await poll(async () => {
    const info = await runtime.api(root)
    return info.status === "complete" && info
  }, "three verification rounds")
  assert.equal(info.verificationRounds, 3)
  const first = control.calls.find((call) => call.phase === "verifying")
  const firstPath = first.body.tools.find((tool) => tool.function?.name === "write").function.parameters.properties
    .file_path.enum[0]
  await poll(
    async () =>
      access(firstPath).then(
        () => false,
        () => true,
      ),
    "superseded report retention cleanup",
  )
  const reports = await runtime.api(`${root}/${goal.id}/reports`)
  assert.equal(reports.length, 5)
  assert.equal(reports.filter((report) => report.kind === "planning").length, 1)
  for (const report of reports) {
    const key = report.kind === "planning" ? "plan" : "verdict"
    assert.ok((await runtime.api(`${root}/${goal.id}/reports/${report.id}/${key}`)).text)
  }
  console.log(
    JSON.stringify(
      {
        kind,
        checks: [
          "explicit-zero-day-retention-removes-superseded-report",
          "current-plan-panel-and-previous-review-remain-downloadable",
        ],
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  await runtime.close()
}
