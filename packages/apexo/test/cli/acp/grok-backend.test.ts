import { expect, test } from "bun:test"
import path from "node:path"
import { chmod } from "node:fs/promises"
import { tmpdir } from "../../fixture/fixture"

test("Grok ACP proxy forwards termination to its child", async () => {
  await using dir = await tmpdir()
  const file = path.join(dir.path, "grok-fixture")
  const stopped = path.join(dir.path, "stopped")
  await Bun.write(
    file,
    `#!${process.execPath}\nprocess.on("SIGTERM", async () => { await Bun.write(${JSON.stringify(stopped)}, "stopped"); process.exit(0) });\nconsole.log("READY");\nsetInterval(() => {}, 1000);\n`,
  )
  await chmod(file, 0o700)
  const proc = Bun.spawn(
    [process.execPath, "run", "src/index.ts", "acp", "--backend", "grok-build", "--cwd", dir.path],
    {
      cwd: path.resolve(import.meta.dir, "../../.."),
      env: { ...process.env, APEXO_GROK_BUILD_BIN: file },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    const reader = proc.stdout.getReader()
    const ready = await reader.read()
    expect(new TextDecoder().decode(ready.value)).toContain("READY")
    reader.releaseLock()
    proc.kill("SIGTERM")
    expect(await proc.exited).toBe(0)
    expect(await Bun.file(stopped).text()).toBe("stopped")
  } finally {
    proc.kill()
  }
}, 20000)
