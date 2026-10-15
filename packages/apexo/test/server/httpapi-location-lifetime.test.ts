import { expect, test } from "bun:test"
import path from "node:path"

test("shared HttpApi services retain their Location map after the first project scope closes", async () => {
  // The route exerciser deliberately shares the production HttpApi memoMap while
  // releasing each project's AppLayer scope. Its next prompt must still reach a
  // real local provider. A fresh server for each request would hide this defect.
  const child = Bun.spawn(
    [process.execPath, "script/httpapi-exercise.ts", "--mode", "effect", "--include", "session.prompt"],
    { cwd: path.resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ code, output: code === 0 ? "" : stdout + stderr }).toEqual({ code: 0, output: "" })
  expect(stdout).toContain("summary pass=3 fail=0 skip=0 missing=0 extra=0")
}, 60_000)
