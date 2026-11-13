import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startCodeReviewFixture } from "./code-review-ui-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"
const fixture = await startCodeReviewFixture({ large: true })
const { runtime } = fixture
try {
  const run = await runtime.api(`/api/session/${fixture.session.id}/review`, { target: { type: "uncommitted" } })
  const endpoint = `/api/session/${fixture.session.id}/review/${run.id}`
  await poll(async () => (await runtime.api(endpoint)).status === "completed", "large review completed", 30000)
  const samples = []
  for (let index = 0; index < 20; index++) {
    const start = performance.now()
    const value = await runtime.api(endpoint)
    samples.push(performance.now() - start)
    assert.equal(value.workspaceStatus, undefined)
  }
  const start = performance.now()
  assert.equal((await runtime.api(`${endpoint}?compareWorkspace=true`)).workspaceStatus, "current")
  const explicitComparisonMs = performance.now() - start
  await writeFile(join(runtime.directory, "calc.ts"), "changed after capture\n")
  assert.equal((await runtime.api(`${endpoint}?compareWorkspace=true`)).workspaceStatus, "stale")
  const sorted = samples.toSorted((a, b) => a - b)
  console.log(
    JSON.stringify(
      {
        trackedFixtureFiles: 6279,
        polls: samples.length,
        medianMs: (sorted[9] + sorted[10]) / 2,
        p95Ms: sorted[18],
        explicitComparisonMs,
        checks: [
          "plain-polls-omit-workspace-scan",
          "explicit-comparison-current",
          "explicit-comparison-detects-change",
        ],
      },
      null,
      2,
    ),
  )
} finally {
  await fixture.close()
}
