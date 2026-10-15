import assert from "node:assert/strict"
import { startTaskUiFixture } from "./grok-task-ui-fixture.mjs"

const fixture = await startTaskUiFixture({ background: true })
try {
  const before = fixture.calls.length
  assert.ok(fixture.tasks.every((task) => task.background))
  const running = fixture.tasks.find((task) => task.status === "running")
  await fixture.runtime.api(`/api/session/${fixture.session.id}/task/${running.id}`, undefined, "GET")
  assert.equal(fixture.calls.length, before)
  await fixture.runtime.api(`/api/session/${fixture.session.id}/task/${running.id}/cancel`, undefined, "POST")
  fixture.hold.resolve()
  assert.equal(fixture.calls.length, before)
  assert.equal(fixture.background.scenario("HOLD").notices, 0)
  for (const mode of ["IDLE", "ACTIVE", "WAIT"]) {
    const task = await fixture.background.launch(mode)
    const before = fixture.calls.length
    await fixture.runtime.api(`/api/session/${fixture.session.id}/task/${task.id}`, undefined, "GET")
    assert.equal(fixture.calls.length, before)
    fixture.background.scenario(mode).child.resolve()
    await fixture.background.settle(mode)
  }
  console.log(
    JSON.stringify({
      checks: 4,
      providerCalls: fixture.calls.length,
      output: fixture.runtime.output,
    }),
  )
} finally {
  await fixture.close()
}
