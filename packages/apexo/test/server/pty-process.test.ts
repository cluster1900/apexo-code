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
