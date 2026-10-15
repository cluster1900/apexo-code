import { expect, test } from "bun:test"
import path from "node:path"
import { withTimeout } from "../../src/util/timeout"

test("workspace synchronization releases its actual application and cleanup owners before fixture reset", async () => {
  const child = Bun.spawn([process.execPath, "test/server/httpapi-workspace-owner.fixture.ts"], {
    cwd: path.resolve(import.meta.dir, "../.."),
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    const [stdout, stderr, code] = await withTimeout(
      Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]),
      55_000,
    )
    expect({ code, output: code === 0 ? "" : stdout + stderr }).toEqual({ code: 0, output: "" })
    expect(stdout).toContain("WORKSPACE_OWNER_RELEASED")
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited
  }
}, 60_000)
