import { expect, test } from "bun:test"
import path from "node:path"

for (const mixed of [false, true])
  test(`Permission review Promise/Effect/SDK clients interoperate on ${mixed ? "mixed" : "pure"} HTTP`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        path.join(import.meta.dir, "../../script/permission-review-client.mjs"),
        ...(mixed ? ["--mixed"] : []),
      ],
      {
        cwd: path.join(import.meta.dir, "../.."),
        env: { ...process.env, GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    try {
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(exit, stderr).toBe(0)
      const report = JSON.parse(
        stdout
          .trim()
          .split("\n")
          .findLast((line) => line.startsWith('{"checks"'))!,
      )
      expect(report.checks).toHaveLength(12)
      expect(report.eventTypes.sort()).toEqual([
        "permission.review.mode.changed",
        "permission.review.settled",
        "permission.review.started",
      ])
    } finally {
      child.kill()
      await child.exited
    }
  }, 90000)
