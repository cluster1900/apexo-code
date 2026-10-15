import assert from "node:assert/strict"
import { resolve } from "node:path"
import { startShellFixture, deadline } from "./grok-shell-fixture.mjs"

const runtime = await startShellFixture("cli", {
  next: () => {
    throw new Error("Selection must not call the provider")
  },
})
try {
  const before = (await runtime.api("/api/session")).data.map((session) => session.id)
  const cases = [
    {
      args: ["attach", runtime.url, "--session-protocol", "unsupported"],
      expected: 'choices: "auto", "native", "compatibility"',
    },
    {
      args: ["run", "--attach", runtime.url, "--session-protocol", "native", "must not submit"],
      expected: "headless approval policy is not supported",
    },
    { args: ["--session-protocol", "native"], expected: "requires attach <url>" },
    { args: ["run", "--session-protocol", "compatibility", "must not submit"], expected: "requires --attach" },
  ]
  for (const item of cases) {
    const child = Bun.spawn([process.execPath, resolve("src/index.ts"), ...item.args], {
      cwd: process.cwd(),
      env: runtime.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    try {
      const result = await deadline(
        Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]),
        30000,
        "selection error child",
      )
      assert.notEqual(result[0], 0)
      assert.ok((result[1] + result[2]).includes(item.expected), result[1] + result[2])
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL")
      await child.exited
    }
  }
  assert.deepEqual(
    (await runtime.api("/api/session")).data.map((session) => session.id),
    before,
  )
  assert.equal(runtime.calls.length, 0)
  console.log(JSON.stringify({ checks: cases.map((item) => item.expected), providerCalls: 0, sessionsCreated: 0 }))
} finally {
  await runtime.close()
}
