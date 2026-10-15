import { expect, test } from "bun:test"

test("restoration adapter binds the explicit target and keeps errors and cancellation safe", async () => {
  const child = Bun.spawn([process.execPath, new URL("./fixtures/session-restore.ts", import.meta.url).pathname], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const deadline = setTimeout(() => child.kill(), 15_000)
  try {
    const [code, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ code, error }).toEqual({ code: 0, error: "" })
    expect(output.trim()).toBe("Explicit restoration identity, compatibility, safe errors and cancellation verified")
  } finally {
    clearTimeout(deadline)
    if (child.exitCode === null) child.kill()
    await child.exited
  }
}, 20_000)
