import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, utimes, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const checks = []
const commit = "git -c commit.gpgsign=false -c user.name=GoalTest -c user.email=goal@apexo.test commit"
for (const mode of ["new-repository", "commit-parent", "mtime", "large", "empty"]) {
  const roles = new Map()
  const state = { worker: false }
  const older = new Date(Date.now() - 120_000).toISOString()
  const command =
    mode === "new-repository"
      ? `git init && printf ROOT_COMMIT_PROOF > root.txt && git add root.txt && ${commit} -m root && printf LATER_COMMIT_PROOF > later.txt && git add later.txt && ${commit} -m later && printf UNTRACKED_PROOF > untracked.txt`
      : mode === "commit-parent"
        ? `git init && printf OLD_COMMIT_PROOF > original.txt && git add original.txt && GIT_AUTHOR_DATE='${older}' GIT_COMMITTER_DATE='${older}' ${commit} -m old && printf WINDOW_COMMIT_PROOF > current.txt && git add current.txt && ${commit} -m current`
        : mode === "empty"
          ? "true"
          : "printf MTIME_PROOF > current.txt && printf RESTRICTED_CONTENT > secret.txt && mkdir -p node_modules nested && printf MUST_IGNORE > node_modules/generated.txt && printf MUST_IGNORE > ignored.txt && printf 'ignored.txt\\n' > .gitignore && printf NESTED_PROOF > nested/proof.txt"
  const runtime = await startShellFixture(kind, {
    goalReports: true,
    next: async ({ body, input }) => {
      const system = input
        .filter((item) => item.role === "system")
        .map((item) => item.content)
        .join("\n")
      if (system.includes("independent goal planner"))
        return {
          content: JSON.stringify({
            plan: "# Plan\n## Goal kind\ncode-change\n## Acceptance criteria\nCapture all available Goal change evidence and disclose fallback limitations.\n## Verification plan\nRead both the manifest and patch.\n",
          }),
        }
      if (system.includes("hidden completion evaluator"))
        return {
          content: JSON.stringify({
            decision: "candidate_complete",
            evidence: "Worker returned the completion marker",
            next_step: "Verify fallback material",
            blocker_key: "",
          }),
        }
      if (!system.includes("independent skeptical goal verifier")) {
        if (!state.worker) {
          state.worker = true
          return {
            tool: "run_terminal_cmd",
            args: {
              command: `${command} && printf FALLBACK_WORKER_DONE`,
              description: `Exercise ${mode}`,
              block_until_ms: 10000,
            },
          }
        }
        assert.ok(JSON.stringify(input).includes("FALLBACK_WORKER_DONE"))
        return { content: "The fallback fixture changes are ready for inspection" }
      }
      const directory = dirname(
        body.tools.find((item) => item.function?.name === "write").function.parameters.properties.file_path.enum[0],
      )
      const step = roles.get(directory) ?? 0
      roles.set(directory, step + 1)
      if (step === 0) return { tool: "read_file", args: { target_file: join(directory, "changed-files.json") } }
      if (step === 1) return { tool: "read_file", args: { target_file: join(directory, "changes.patch") } }
      const receipts = JSON.stringify(input.filter((item) => item.role === "tool"))
      assert.ok(
        receipts.includes(
          mode === "empty"
            ? "No readable files"
            : mode === "commit-parent"
              ? "WINDOW_COMMIT_PROOF"
              : mode === "new-repository"
                ? "ROOT_COMMIT_PROOF"
                : mode === "large"
                  ? "a-big.txt"
                  : "MTIME_PROOF",
        ),
      )
      assert.ok(!receipts.includes("MUST_IGNORE") && !receipts.includes("RESTRICTED_CONTENT"))
      return {
        content: JSON.stringify({
          achieved: true,
          evidence: "Read fallback manifest and patch with stated limitations",
          unmet: [],
          confidence: "high",
          blocking: "none",
        }),
      }
    },
  })
  const results = []
  try {
    await writeFile(join(runtime.directory, "old.txt"), "OLD_MTIME_PROOF")
    await utimes(join(runtime.directory, "old.txt"), new Date(older), new Date(older))
    const session = await runtime.api("/session", {
      title: `Goal fallback ${mode}`,
      permission: [
        { permission: "*", pattern: "*", action: "allow" },
        { permission: "read", pattern: "secret.txt", action: "deny" },
        { permission: "read", pattern: "**/secret.txt", action: "deny" },
      ],
    })
    await runtime.api(`/session/${session.id}/message`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "Exercise Goal change fallback and inspect its available evidence" }],
    })
    const root = `/session/${session.id}/goal`
    const goal = await runtime.api(root, {
      id: `goal_${randomUUID().replaceAll("-", "")}`,
      objective: "Capture available changes and disclose fallback limitations",
    })
    assert.equal(goal.changesBaselineCommit, undefined)
    if (mode === "large") {
      for (const name of ["a-big.txt", "b-big.txt", "c-big.txt", "d-big.txt", "z-tail.txt"])
        await writeFile(join(runtime.directory, name), "中文😀\n".repeat(20000))
    }
    await runtime.api(`${root}/${goal.id}/run`, undefined, "POST")
    const result = await poll(
      async () => {
        const value = await runtime.api(root)
        return value.status !== "active" && value
      },
      `Goal ${mode}`,
      60000,
    )
    results.push(result)
    assert.equal(result.status, "complete", JSON.stringify(result))
    assert.equal(result.changesBaselineCommit, undefined, "Fallback must not rewrite creation history")
    const reports = result.verification.results.map((item) => item.files)
    assert.equal(reports.length, 3)
    assert.equal(new Set(reports.map((item) => item.changedFiles.sha256)).size, 1)
    const manifest = JSON.parse(await readFile(reports[0].changedFiles.path, "utf8"))
    const patch = await readFile(reports[0].changes.path, "utf8")
    assert.equal(manifest.source, ["new-repository", "commit-parent"].includes(mode) ? "git_history" : "mtime")
    assert.equal(manifest.status, mode === "empty" ? "unavailable" : "captured")
    if (mode === "new-repository")
      assert.ok(manifest.files.includes("untracked.txt") && patch.includes("LATER_COMMIT_PROOF"))
    if (mode === "commit-parent")
      assert.ok(!manifest.files.includes("original.txt") && !patch.includes("OLD_COMMIT_PROOF"))
    if (["mtime", "large"].includes(mode)) {
      assert.equal(manifest.omitted, 1)
      assert.ok(!manifest.files.includes("old.txt") && !manifest.files.includes("secret.txt"))
      assert.ok(!patch.includes("RESTRICTED_CONTENT") && !patch.includes("OLD_MTIME_PROOF"))
    }
    if (mode === "large") assert.ok(manifest.truncated && manifest.files.includes("z-tail.txt"))
    await runtime.crash()
    await runtime.reopen()
    assert.deepEqual(await runtime.api(root), result)
    checks.push({ mode, requests: runtime.calls.length, output: runtime.output })
    console.log(JSON.stringify(checks.at(-1)))
  } finally {
    await writeFile(join(runtime.output, "goal-fallback.json"), JSON.stringify({ mode, results }, null, 2))
    await runtime.close()
  }
}
console.log(JSON.stringify({ kind, checks }, null, 2))
