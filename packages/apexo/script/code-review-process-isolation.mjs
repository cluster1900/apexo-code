import assert from "node:assert/strict"
import { join } from "node:path"
import { startCodeReviewFixture } from "./code-review-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"
const fixture = await startCodeReviewFixture()
const { runtime } = fixture
let peer
try {
  const admitted = await runtime.api(`/api/session/${fixture.session.id}/review`, {
    target: { type: "uncommitted" },
    focus: "REVIEW_HOLD",
  })
  await poll(
    async () =>
      (await runtime.api(`/api/session/${fixture.session.id}/review/${admitted.id}`)).status === "running" &&
      fixture.calls.length === 1,
    "first process owns an active review",
  )
  peer = await fixture.peer()
  const response = await fetch(`${peer.url}/api/session/${fixture.session.id}/review/${admitted.id}`)
  assert.ok(response.ok)
  assert.equal((await response.json()).status, "running")
  assert.equal((await runtime.api(`/api/session/${fixture.session.id}/review/${admitted.id}`)).status, "running")
  const child = Bun.spawn(
    [
      process.execPath,
      join(fixture.repo, "packages/apexo/src/index.ts"),
      "review",
      "--dir",
      runtime.directory,
      "--model",
      "reviewfixture/review-model",
      "--format",
      "json",
      "--ephemeral",
    ],
    { cwd: runtime.directory, env: runtime.env, stdout: "pipe", stderr: "pipe" },
  )
  const text = new Response(child.stdout).text()
  const error = new Response(child.stderr).text()
  assert.equal(await deadline(child.exited, 45000, "second process local CLI review"), 0, await error)
  assert.equal(JSON.parse((await text).trim()).status, "completed")
  assert.equal((await runtime.api(`/api/session/${fixture.session.id}/review/${admitted.id}`)).status, "running")
  fixture.hold.resolve()
  const done = await poll(
    async () => {
      const run = await runtime.api(`/api/session/${fixture.session.id}/review/${admitted.id}`)
      return run.status === "completed" ? run : undefined
    },
    "first process retains and persists its result",
    20000,
  )
  assert.equal(done.result.summary, "REVIEW_UI_REPORT")
  console.log(
    JSON.stringify(
      {
        checks: ["live-owner-survives-peer-startup", "live-owner-survives-second-local-CLI", "first-result-preserved"],
        providerCalls: fixture.calls.length,
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  await peer?.close()
  await fixture.close()
}
