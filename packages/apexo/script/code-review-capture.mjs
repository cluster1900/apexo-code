import assert from "node:assert/strict"
import { resolve } from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CodeReviewCapture } from "@apexo/core/session/code-review-capture"
const root = resolve(process.argv[2] ?? "../..")
const git = (...args) => {
  const result = Bun.spawnSync(["git", "--no-optional-locks", "-c", "core.fsmonitor=false", ...args], { cwd: root })
  assert.equal(result.exitCode, 0, result.stderr.toString())
  return result.stdout.toString().trim()
}
const index = resolve(root, git("rev-parse", "--git-path", "index"))
const before = await Bun.file(index).bytes()
const head = git("rev-parse", "HEAD")
const started = performance.now()
const captured = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const capture = yield* CodeReviewCapture.Service
      return yield* capture.capture(root, { type: "uncommitted" })
    }),
  ).pipe(Effect.provide(AppNodeBuilder.build(CodeReviewCapture.node))),
)
assert.deepEqual(await Bun.file(index).bytes(), before)
assert.equal(git("rev-parse", "HEAD"), head)
console.log(
  JSON.stringify(
    {
      root,
      files: captured.files.length,
      exclusions: captured.exclusions.length,
      elapsedMs: performance.now() - started,
      indexUnchanged: true,
      headUnchanged: true,
    },
    null,
    2,
  ),
)
