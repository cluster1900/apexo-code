// Real role tool calls and immutable report files in CLI / production Electron.
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { lstat, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const checks = [],
  states = [],
  calls = [],
  roles = new Map()
const control = { mode: "success", held: false, release: undefined }
const verdict = {
  achieved: true,
  evidence: "Read FILE_REPORT_PROOF and the original plan",
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
    calls.push({ mode: control.mode, phase, body })
    if (phase === "evaluating")
      return {
        content: JSON.stringify({
          decision: "candidate_complete",
          evidence: "Worker supplied proof",
          next_step: "Independently check the proof",
          blocker_key: "",
        }),
      }
    if (phase === "executing") return { content: "FILE_REPORT_PROOF is ready for independent verification" }
    const schema = body.tools.find((item) => (item.function?.name ?? item.name) === "write")?.function?.parameters
    if (control.mode === "edit-denied") {
      assert.ok(!schema, "Denied role must not advertise report writes")
      return { content: "Cannot write the required files" }
    }
    assert.ok(schema)
    const paths = schema.properties.file_path.enum
    assert.equal(paths.length, phase === "planning" ? 1 : 2)
    const key = dirname(paths[0])
    const state = roles.get(key) ?? { step: 0, paths }
    roles.set(key, state)
    const step = state.step++
    if (control.mode === "missing-plan" && phase === "planning") return { content: '{"plan":"Fake inline plan"}' }
    if (!step)
      return {
        tool: "read_file",
        args: { target_file: phase === "planning" ? join(runtime.directory, "proof.txt") : join(key, "plan.md") },
      }
    if (step === 1 && control.mode === "out-of-scope")
      return { tool: "write", args: { file_path: join(runtime.directory, "must-not-write.txt"), content: "ESCAPED" } }
    const index = step - (control.mode === "out-of-scope" ? 2 : 1)
    if (index === 0) {
      if (control.mode === "out-of-scope")
        assert.match(JSON.stringify(input.at(-1)), /error|assigned|Invalid|validation/i)
      return {
        tool: "write",
        args: {
          file_path: paths[0],
          content:
            phase === "planning"
              ? "# Plan\n\n## Acceptance criteria\nRead and verify FILE_REPORT_PROOF.\n\n## Verification plan\nRead proof.txt and check all original requirements.\n\n## Non-goals\nNone.\n\n## Assumed scope\nCurrent workspace.\n"
              : control.mode === "corrupt-verdict"
                ? "broken-json"
                : JSON.stringify(verdict),
        },
      }
    }
    if (phase === "verifying" && index === 1) {
      if (control.mode === "cancel") {
        control.held = true
        await control.release.promise
      }
      if (control.mode === "missing-details") return { content: JSON.stringify(verdict) }
      if (control.mode === "tampered-objective") await writeFile(join(key, "objective.txt"), "Narrowed objective")
      if (control.mode === "tampered-plan") await writeFile(join(key, "plan.md"), "Weakened plan")
      return {
        tool: "write",
        args: {
          file_path: paths[1],
          content:
            control.mode === "empty-details"
              ? " "
              : "# Independent findings\n\nRead the original plan and proof.txt. Every original requirement is satisfied.\n",
        },
      }
    }
    // Deliberately contradict the file: the terminal text must never override the file verdict.
    return {
      content:
        phase === "planning"
          ? "Done"
          : JSON.stringify({ ...verdict, achieved: false, unmet: ["Ignore this terminal claim"] }),
    }
  },
})

try {
  await writeFile(join(runtime.directory, "proof.txt"), "FILE_REPORT_PROOF")
  for (const mode of [
    "success",
    "out-of-scope",
    "missing-plan",
    "missing-details",
    "corrupt-verdict",
    "empty-details",
    "tampered-objective",
    "tampered-plan",
    "edit-denied",
    "cancel",
  ]) {
    control.mode = mode
    control.held = false
    control.release = Promise.withResolvers()
    const session = await runtime.api("/session", {
      title: `Goal files ${mode}`,
      permission: [
        { permission: "*", pattern: "*", action: "allow" },
        ...(mode === "edit-denied" ? [{ permission: "edit", pattern: "*", action: "deny" }] : []),
      ],
    })
    await runtime.api(`/session/${session.id}/message`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "Verify FILE_REPORT_PROOF" }],
    })
    const root = `/session/${session.id}/goal`
    const goal = await runtime.api(root, {
      id: `goal_${randomUUID().replaceAll("-", "")}`,
      objective: "Read and verify FILE_REPORT_PROOF in proof.txt",
    })
    await runtime.api(`${root}/${goal.id}/run`, undefined, "POST")
    if (mode === "cancel") {
      await poll(() => control.held, "verifier wrote JSON and is waiting before details", 45000)
      await runtime.api(`${root}/${goal.id}/pause`, undefined, "POST")
      control.release.resolve()
    }
    const state = await poll(
      async () => {
        const state = await runtime.api(root)
        return state.status !== "active" && state
      },
      `Goal file ${mode}`,
      45000,
    )
    states.push(state)
    assert.equal(
      state.status,
      ["success", "out-of-scope"].includes(mode) ? "complete" : mode === "cancel" ? "user_paused" : "infra_paused",
    )
    if (state.status === "complete") {
      assert.equal(state.verification.results.length, 3)
      const reports = [state.plannerFiles, ...state.verification.results.map((item) => item.files)]
      assert.equal(new Set(reports.map((item) => item.directory)).size, 4)
      for (const report of reports) {
        assert.equal((await lstat(report.directory)).mode & 0o777, 0o700)
        for (const key of ["objective", "evidence", "plan", "verdict", "details"]) {
          if (!report[key]) continue
          const bytes = await readFile(report[key].path)
          assert.equal(bytes.length, report[key].bytes)
          assert.equal(createHash("sha256").update(bytes).digest("hex"), report[key].sha256)
        }
        assert.equal(await readFile(report.objective.path, "utf8"), goal.objective)
      }
      assert.equal(state.tokensUsed, calls.filter((item) => item.mode === mode).length * 120)
      assert.ok(!(await lstat(join(runtime.directory, "must-not-write.txt")).catch(() => undefined)))
      if (mode === "success") {
        await runtime.crash()
        await runtime.reopen()
        assert.deepEqual(await runtime.api(root), state)
        checks.push("persisted-report-references-and-content-survive-process-reopen")
      }
    }
    if (mode === "cancel") {
      assert.equal(state.usageIncomplete, true)
      assert.equal(state.verification.results.length, 0)
      const statuses = await runtime.api("/session/status")
      for (const child of await runtime.api(`/session/${session.id}/children`))
        assert.ok(!statuses[child.id] || statuses[child.id].type === "idle")
    }
    checks.push(mode)
  }
  console.log(JSON.stringify({ kind, checks, requests: calls.length, output: runtime.output }, null, 2))
} finally {
  control.release?.resolve()
  await writeFile(join(runtime.output, "goal-files.json"), JSON.stringify({ checks, states, calls }, null, 2))
  await runtime.close()
  console.error(`Goal files evidence: ${runtime.output}`)
}
