import { expect, test } from "bun:test"
import path from "node:path"

test("interrupted maintenance recovery retains its real lock until marker persistence settles", async () => {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../fixture/memory-maintenance-recovery.ts")], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = setTimeout(() => child.kill(), 15000)
  const result = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).finally(() => clearTimeout(timer))
  expect(result[2]).toBe("")
  expect(result[0]).toBe(0)
}, 20000)
