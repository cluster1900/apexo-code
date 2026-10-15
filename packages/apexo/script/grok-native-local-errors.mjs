import assert from "node:assert/strict"
import { resolve } from "node:path"
import { startShellFixture, deadline } from "./grok-shell-fixture.mjs"

const runtime = await startShellFixture("cli", {
  deferBackend: true,
  next: () => {
    throw new Error("Rejected startup must not call provider")
  },
})
try {
  const cases = [
    {
      args: ["run", "--session-protocol", "native", "--session", "ses_test", "--input-id", "invalid", "unattended"],
      expected: "msg_",
    },
    {
      args: ["run", "--session-protocol", "native", "--input-id", "msg_test", "unattended"],
      expected: "--input-id requires",
    },
    {
      args: ["run", "--session-protocol", "native", "--file", "unsupported.txt", "unattended"],
      expected: "ENOENT",
    },
    {
      args: [runtime.directory, "--session-protocol", "native", "--mini", "--fork"],
      expected: "--fork is not available",
    },
    { args: [runtime.directory, "--session-protocol", "native", "--auto"], expected: "--auto is not available" },
    { args: [runtime.directory, "--session-protocol", "native", "--port", "0"], expected: "--port is not available" },
    { args: [runtime.directory, "--session-protocol", "native", "--demo"], expected: "--demo is not available" },
  ]
  for (const item of cases) {
    const child = Bun.spawn(
      [
        ...(process.env.APEXO_TEST_CLI_BIN
          ? [process.env.APEXO_TEST_CLI_BIN]
          : [process.execPath, resolve("src/index.ts")]),
        ...item.args,
      ],
      {
        cwd: process.cwd(),
        env: runtime.env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    try {
      const [exit, stdout, stderr] = await deadline(
        Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]),
        30000,
        "native local rejection",
      )
      assert.notEqual(exit, 0)
      assert.ok((stdout + stderr).includes(item.expected), stdout + stderr)
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL")
      await child.exited
    }
  }
  assert.equal(runtime.calls.length, 0)
  const files = await Array.fromAsync(new Bun.Glob("**/*.db").scan({ cwd: runtime.output, onlyFiles: true }))
  assert.deepEqual(files, [], "Rejected startup must not construct a Session database")
  console.log(JSON.stringify({ checks: cases.length, providerCalls: 0, databasesCreated: 0 }))
} finally {
  await runtime.close()
  console.error(`Native local rejection evidence: ${runtime.output}`)
}
