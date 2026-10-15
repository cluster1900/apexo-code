import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createHistoricalMemoryFixture } from "./grok-memory-owner-fixture.mjs"

const fixture = await createHistoricalMemoryFixture(process.argv[2] ?? "cli")
const checks = []
const results = []
try {
  const result = await fixture.flush()
  results.push(result)
  assert.equal(result.status, "conflict")
  assert.equal(result.reason, "historical_capture_ownership")
  assert.equal(fixture.calls.extraction, 0)
  await fixture.preserved()
  checks.push("explicit-historical-owner-conflict-without-extraction-or-ledger-mutation")
  const again = await fixture.flush()
  assert.deepEqual(again, result)
  assert.equal(fixture.calls.extraction, 0)
  await fixture.preserved()
  checks.push("repeated-conflict-preserves-note-and-receipt-only-state")
  await fixture.runtime.crash()
  await fixture.runtime.reopen()
  const reopened = await fixture.flush()
  results.push(reopened)
  assert.deepEqual(reopened, result)
  assert.equal(fixture.calls.extraction, 0)
  await fixture.preserved()
  checks.push("restart-retains-conflict-and-preserved-historical-state")
  const fresh = await fixture.runtime.api("/session", { title: "Fresh Memory ownership positive control" })
  await fixture.runtime.api(`/session/${fresh.id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Remember FRESH_SESSION_MEMORY: new Sessions still capture normally." }],
  })
  const completed = await fixture.flush(fresh.id)
  results.push(completed)
  assert.equal(completed.status, "completed")
  assert.equal(fixture.calls.extraction, 1)
  assert.equal(
    fixture.rows("SELECT count(*) AS n FROM capture_jobs WHERE session_id = ? AND status = 'completed'", fresh.id)[0].n,
    1,
  )
  await fixture.preserved()
  checks.push("fresh-session-captures-normally-without-changing-historical-ledger")
  console.log(
    JSON.stringify(
      {
        checks,
        results,
        extractionCalls: fixture.calls.extraction,
        syntheticLegacySeed: true,
        output: fixture.runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  await fixture.runtime.close()
  await writeFile(
    join(fixture.runtime.output, "memory-owner-conflict.json"),
    JSON.stringify({ checks, results, extractionCalls: fixture.calls.extraction, syntheticLegacySeed: true }, null, 2),
  )
}
