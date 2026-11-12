import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startCodeReviewFixture } from "./code-review-ui-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"
const url = process.argv[2]
assert.ok(
  url?.startsWith("https://github.com/"),
  "Pass an existing GitHub PR URL; this script reads it without changing the PR",
)
const fixture = await startCodeReviewFixture({ github: true })
const { runtime } = fixture
try {
  // Reuse read-only local objects to avoid downloading this checkout's history twice.
  await mkdir(join(runtime.directory, ".git/objects/info"), { recursive: true })
  await writeFile(join(runtime.directory, ".git/objects/info/alternates"), join(fixture.repo, ".git/objects") + "\n")
  const admitted = await runtime.api(`/api/session/${fixture.session.id}/review`, { target: { type: "pr", ref: url } })
  const run = await poll(
    async () => {
      const value = await runtime.api(`/api/session/${fixture.session.id}/review/${admitted.id}`)
      return ["completed", "failed", "cancelled", "interrupted"].includes(value.status) ? value : undefined
    },
    "authenticated PR review",
    120000,
  )
  assert.equal(run.status, "completed", run.error)
  assert.ok(run.captured.baseSha && run.captured.headSha && run.captured.mergeBaseSha)
  assert.ok(run.captured.files.length > 0)
  const refs = Bun.spawnSync(["git", "for-each-ref", "refs/apexo-review"], { cwd: runtime.directory })
  assert.equal(refs.stdout.toString().trim(), "")
  console.log(
    JSON.stringify(
      {
        target: url,
        status: run.status,
        baseSha: run.captured.baseSha,
        headSha: run.captured.headSha,
        files: run.captured.files.length,
        exclusions: run.captured.exclusions.length,
        temporaryRefs: 0,
      },
      null,
      2,
    ),
  )
} finally {
  await fixture.close()
}
