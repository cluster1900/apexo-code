import assert from "node:assert/strict"
import { join } from "node:path"
import { startCodeReviewFixture } from "./code-review-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"
const fixture = await startCodeReviewFixture()
const checks = []
try {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const child = Bun.spawn(
      [
        process.execPath,
        join(fixture.repo, "packages/apexo/src/index.ts"),
        "review",
        "--attach",
        fixture.runtime.url,
        "--dir",
        fixture.runtime.directory,
        "--model",
        "reviewfixture/review-model",
        "--format",
        "streaming-json",
        "REVIEW_HOLD",
      ],
      { cwd: fixture.runtime.directory, env: fixture.runtime.env, stdout: "pipe", stderr: "pipe" },
    )
    const output = { text: "" }
    const reading = (async () => {
      for await (const chunk of child.stdout) output.text += new TextDecoder().decode(chunk)
    })()
    try {
      const started = await poll(
        () =>
          output.text
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .find((item) => item.status === "running"),
        "CLI running receipt",
        30000,
      )
      child.kill(signal)
      assert.equal(await deadline(child.exited, 15000, "signal cleanup"), signal === "SIGINT" ? 130 : 143)
      await reading
      const run = await fixture.runtime.api(`/api/session/${started.sessionID}/review/${started.reviewID}`)
      assert.equal(run.status, "cancelled")
      checks.push(`${signal}-targeted-cancel-and-exit`)
    } finally {
      child.kill("SIGKILL")
    }
  }
  const requests = []
  const unauthorized = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push({ method: request.method, path: new URL(request.url).pathname })
      return Response.json({ message: "Authentication required" }, { status: 401 })
    },
  })
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        join(fixture.repo, "packages/apexo/src/index.ts"),
        "review",
        "--attach",
        unauthorized.url.origin,
        "--dir",
        fixture.runtime.directory,
        "--session-protocol",
        "native",
      ],
      { cwd: fixture.runtime.directory, env: fixture.runtime.env, stdout: "pipe", stderr: "pipe" },
    )
    const error = new Response(child.stderr).text()
    assert.equal(await deadline(child.exited, 15000, "remote authentication rejection"), 1)
    assert.match(await error, /authentication failed/)
    assert.deepEqual(requests, [{ method: "GET", path: "/openapi.json" }])
    checks.push("remote-auth-fails-before-admission")
  } finally {
    await unauthorized.stop(true)
  }
  console.log(JSON.stringify({ checks, output: fixture.runtime.output }, null, 2))
} finally {
  await fixture.close()
}
