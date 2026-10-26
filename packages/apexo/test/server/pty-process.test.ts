import { expect, test } from "bun:test"
import { spawn } from "@apexo/core/pty/pty.bun"

const posix = process.platform === "win32" ? test.skip : test

posix("drains large PTY output before reporting exit", async () => {
  const proc = spawn(process.execPath, ["-e", 'process.stdout.write("x".repeat(262144))'], { name: "xterm" })
  const output: string[] = []
  proc.onData((chunk) => output.push(chunk))
  const event = await new Promise<{ exitCode: number }>((resolve) => proc.onExit(resolve))
  expect(event.exitCode).toBe(0)
  expect(output.join("")).toBe("x".repeat(262144))
})

posix(
  "retains rapid PTY exits, output, and late exit subscriptions",
  async () => {
    for (const code of Array.from({ length: 30 }, (_, index) => index % 8)) {
      const proc = spawn("/bin/sh", ["-c", `printf 'hello 世界'; exit ${code}`], { name: "xterm" })
      const output: string[] = []
      proc.onData((chunk) => output.push(chunk))
      const event = await new Promise<{ exitCode: number }>((resolve) => proc.onExit(resolve))
      expect(event.exitCode).toBe(code)
      expect(output.join("")).toBe("hello 世界")
      const late = await new Promise<{ exitCode: number }>((resolve) => proc.onExit(resolve))
      expect(late.exitCode).toBe(code)
    }
  },
  10000,
)

posix(
  "rapid PTY exits survive concurrent test workers",
  async () => {
    // A synchronous runtime wait can block the child's test timeout too.
    // Keep the watchdog in a separate process and exercise the actual adapter.
    const workers = Array.from({ length: 4 }, () =>
      Bun.spawn(
        [
          process.execPath,
          "test",
          import.meta.path,
          "--test-name-pattern",
          "retains rapid PTY exits",
          "--rerun-each",
          "10",
        ],
        { stdout: "pipe", stderr: "pipe", timeout: 20000, killSignal: "SIGKILL" },
      ),
    )
    const results = await Promise.all(
      workers.map(async (worker) => {
        const [code, stdout, stderr] = await Promise.all([
          worker.exited,
          new Response(worker.stdout).text(),
          new Response(worker.stderr).text(),
        ])
        return { code, stdout, stderr }
      }),
    )
    for (const result of results) {
      expect(result.code, result.stdout + result.stderr).toBe(0)
      expect(result.stderr).toContain("10 pass")
      expect(result.stderr).toContain("900 expect() calls")
    }
  },
  30000,
)
