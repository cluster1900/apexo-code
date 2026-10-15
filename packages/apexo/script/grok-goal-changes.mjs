import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const checks = [],
  states = [],
  roles = new Map()
const control = { mode: "success", worker: false, mutated: false }
const traces = []
const verdict = {
  achieved: true,
  evidence: "Read the immutable change manifest and patch",
  unmet: [],
  confidence: "high",
  blocking: "none",
}
const runtime = await startShellFixture(kind, {
  next: async ({ body, input }) => {
    const system = input
      .filter((item) => item.role === "system")
      .map((item) => item.content)
      .join("\n")
    const phase = system.includes("independent goal planner")
      ? "planning"
      : system.includes("independent skeptical goal verifier")
        ? "verifying"
        : system.includes("hidden completion evaluator")
          ? "evaluating"
          : "executing"
    traces.push({
      phase,
      mode: control.mode,
      system,
      tools: body.tools?.map((item) => item.function?.name ?? item.name),
      input,
    })
    if (phase === "evaluating")
      return {
        content: JSON.stringify({
          decision: "candidate_complete",
          evidence: "Worker changed files",
          next_step: "Verify all changed files",
          blocker_key: "",
        }),
      }
    if (phase === "executing") {
      if (control.worker) {
        assert.ok(
          JSON.stringify(input).includes("GIT_WORKER_DONE"),
          "The actual shell tool must finish before claiming changes exist",
        )
        return { content: "The committed, staged and current changes are ready for verification" }
      }
      if (control.mode === "missing-base")
        return { content: "The committed, staged and current changes are ready for verification" }
      control.worker = true
      return {
        tool: "run_terminal_cmd",
        args: {
          command:
            "printf 'STAGED_PROOF\\n' > staged.txt && git add staged.txt && printf 'WORKTREE_PROOF\\n' > work.txt && printf 'UNTRACKED_PROOF\\n' > untracked.txt && printf 'RESTRICTED_SECRET\\n' > secret.env && printf GIT_WORKER_DONE",
          description: "Create verification fixture changes",
          block_until_ms: 10000,
        },
      }
    }
    const paths = body.tools.find((item) => (item.function?.name ?? item.name) === "write")?.function?.parameters
      .properties.file_path.enum
    assert.ok(paths)
    const directory = dirname(paths[0])
    const state = roles.get(directory) ?? { step: 0 }
    roles.set(directory, state)
    const step = state.step++
    if (phase === "planning")
      return step
        ? { content: "Done" }
        : {
            tool: "write",
            args: {
              file_path: paths[0],
              content:
                "# Plan\n## Goal kind\ncode-change\n## Acceptance criteria\nInspect committed, staged, worktree and untracked changes.\n## Verification plan\nRead change materials and current files.\n",
            },
          }
    assert.ok(system.includes("CHANGES_FILE=") && system.includes("CHANGED_FILES="))
    if (step === 0) {
      if (control.mode === "success" && !control.mutated) {
        control.mutated = true
        await writeFile(
          join(runtime.directory, "after-capture.txt"),
          "Must not appear in another reviewer's frozen capture",
        )
      }
      return { tool: "read_file", args: { target_file: join(directory, "changed-files.json") } }
    }
    if (step === 1) return { tool: "read_file", args: { target_file: join(directory, "changes.patch") } }
    if (step === 2) {
      assert.ok(
        JSON.stringify(input).includes(control.mode === "missing-base" ? "fallback-proof.txt" : "committed.txt"),
      )
      if (["deny", "ask"].includes(control.mode)) {
        assert.ok(
          !JSON.stringify(input).includes("PREEXISTING_PRIVATE_VALUE"),
          "Automatic session summaries must not disclose unread source content",
        )
        assert.ok(!JSON.stringify(input.filter((item) => item.role === "tool")).includes("RESTRICTED_SECRET"))
      }
      if (control.mode === "tamper") await writeFile(join(directory, "changes.patch"), "Replaced evidence")
      return { tool: "write", args: { file_path: paths[0], content: JSON.stringify(verdict) } }
    }
    if (step === 3)
      return {
        tool: "write",
        args: {
          file_path: paths[1],
          content: "# Findings\nRead the captured patch and complete permitted changed-file manifest.\n",
        },
      }
    return { content: "Not Refuted" }
  },
})
const git = (...args) =>
  execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "-c", "user.name=Goal Test", "-c", "user.email=goal@apexo.test", ...args],
    { cwd: runtime.directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim()

try {
  git("init")
  for (const mode of ["success", "deny", "ask", "large", "tamper", "missing-base"]) {
    Object.assign(control, { mode, worker: false, mutated: false })
    if (mode === "missing-base") await rename(join(runtime.directory, ".git"), join(runtime.output, "saved-git"))
    else {
      for (const file of ["work.txt", "staged.txt", "secret.env"])
        await writeFile(
          join(runtime.directory, file),
          file === "secret.env" ? "PREEXISTING_PRIVATE_VALUE\n" : `before ${mode}\n`,
        )
      git("add", ".")
      git("commit", "--allow-empty", "-m", `Baseline ${mode}`)
    }
    const session = await runtime.api("/session", {
      title: `Goal changes ${mode}`,
      permission: [
        { permission: "*", pattern: "*", action: "allow" },
        ...(["deny", "ask"].includes(mode) ? [{ permission: "read", pattern: "secret.env", action: mode }] : []),
      ],
    })
    await runtime.api(`/session/${session.id}/message`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "Create and verify the fixture changes" }],
    })
    const root = `/session/${session.id}/goal`
    const payload = {
      id: `goal_${randomUUID().replaceAll("-", "")}`,
      objective: "Inspect all changes since Goal creation",
    }
    const created = await runtime.api(root, payload)
    if (mode === "missing-base") {
      assert.equal(created.changesBaselineCommit, undefined)
      await writeFile(join(runtime.directory, "fallback-proof.txt"), "MTIME_FALLBACK_PROOF")
    } else {
      assert.equal(created.changesBaselineCommit, git("rev-parse", "HEAD"))
      await writeFile(join(runtime.directory, "committed.txt"), `COMMITTED_PROOF ${mode}\n`)
      git("add", "committed.txt")
      git("commit", "-m", `Commit during Goal ${mode}`)
      assert.notEqual(git("rev-parse", "HEAD"), created.changesBaselineCommit)
      assert.deepEqual(await runtime.api(root, payload), created)
    }
    if (mode === "large") {
      await writeFile(join(runtime.directory, "a-big.txt"), "中文😀\n".repeat(50_000))
      await writeFile(join(runtime.directory, "z-tail.txt"), "TAIL_FILE_PROOF\n")
      git("add", "a-big.txt", "z-tail.txt")
    }
    await runtime.api(`${root}/${created.id}/run`, undefined, "POST")
    const state = await poll(
      async () => {
        const value = await runtime.api(root)
        return value.status !== "active" && value
      },
      `Goal changes ${mode}`,
      60000,
    )
    states.push(state)
    assert.equal(state.status, mode === "tamper" ? "infra_paused" : "complete", JSON.stringify(state))
    if (state.status === "complete") {
      const reports = state.verification.results.map((item) => item.files)
      assert.equal(reports.length, 3)
      assert.equal(new Set(reports.map((item) => item.changes.sha256)).size, 1)
      assert.equal(new Set(reports.map((item) => item.changedFiles.sha256)).size, 1)
      const manifest = JSON.parse(await readFile(reports[0].changedFiles.path, "utf8"))
      const patch = await readFile(reports[0].changes.path, "utf8")
      if (mode === "missing-base") {
        assert.equal(manifest.status, "captured")
        assert.equal(manifest.source, "mtime")
        assert.ok(manifest.files.includes("fallback-proof.txt"))
      } else {
        assert.equal(manifest.status, "captured")
        assert.equal(manifest.baseline, created.changesBaselineCommit)
        assert.ok(manifest.files.includes("committed.txt"))
        if (mode === "success") {
          for (const file of ["staged.txt", "work.txt", "untracked.txt"]) assert.ok(manifest.files.includes(file))
          assert.ok(!manifest.files.includes("after-capture.txt"))
          for (const proof of ["COMMITTED_PROOF", "STAGED_PROOF", "WORKTREE_PROOF"]) assert.ok(patch.includes(proof))
        }
        if (["deny", "ask"].includes(mode)) {
          assert.ok(!manifest.files.includes("secret.env"))
          assert.equal(manifest.omitted, 1)
          assert.ok(!patch.includes("RESTRICTED_SECRET"))
        }
        if (mode === "large") {
          assert.equal(manifest.truncated, true)
          assert.ok(manifest.files.includes("z-tail.txt"))
          assert.ok(patch.includes("Patch truncated"))
        }
      }
    }
    if (mode === "success") {
      await runtime.crash()
      await runtime.reopen()
      assert.deepEqual(await runtime.api(root), state)
      checks.push("baseline-and-change-references-survive-process-reopen")
    }
    checks.push(mode)
  }
  console.log(JSON.stringify({ kind, checks, requests: runtime.calls.length, output: runtime.output }, null, 2))
} finally {
  await writeFile(join(runtime.output, "goal-changes.json"), JSON.stringify({ checks, states, traces }, null, 2))
  console.error(`Goal change evidence: ${runtime.output}`)
  await runtime.close()
}
