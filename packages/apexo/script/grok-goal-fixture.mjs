import { startShellFixture } from "./grok-shell-fixture.mjs"

export async function startGoalFixture(kind, options = {}) {
  const plan = options.progress
    ? "# Goal plan\n## Acceptance criteria\nPreserve and verify the original objective.\n## Task checklist\n- [ ] Capture evidence\n- [ ] Independently inspect evidence\n"
    : "Implement the objective and verify the result"
  const progressNote = "PROGRESS_NOTE: Used captured local evidence."
  const control = { hold: undefined, calls: [], reject: options.reject ?? 0, plan, progressNote }
  const runtime = await startShellFixture(kind, {
    goalReports: true,
    git: options.git,
    config: options.config,
    models: options.models,
    next: async (request) => {
      const custom = await options.next?.(request)
      if (custom) return custom
      const { body, ancillary } = request
      const text = JSON.stringify(body)
      const phase = text.includes("independent goal planner")
        ? "planning"
        : text.includes("hidden completion evaluator")
          ? "evaluating"
          : text.includes("independent skeptical goal verifier")
            ? "verifying"
            : ancillary
              ? "ancillary"
              : "executing"
      control.calls.push({ phase, body })
      if (phase === "planning") return { content: JSON.stringify({ plan }) }
      if (phase === "evaluating")
        return {
          content: JSON.stringify({
            decision: "candidate_complete",
            evidence: "Work and checks completed",
            next_step: "Verify every requirement",
            blocker_key: "",
          }),
        }
      if (phase === "verifying" && control.reject > 0) {
        const gap = `Verification gap ${control.reject--}`
        return {
          content: JSON.stringify({
            confidence: "high",
            blocking: "none",
            achieved: false,
            evidence: gap,
            unmet: [gap],
          }),
        }
      }
      if (phase === "verifying")
        return {
          content: JSON.stringify({
            confidence: "high",
            blocking: "none",
            achieved: true,
            evidence: "Every requirement verified",
            unmet: [],
          }),
        }
      if (phase === "executing" && control.hold) await control.hold.promise
      if (phase === "executing" && options.progress) {
        const strings = (value) =>
          typeof value === "string"
            ? [value]
            : value && typeof value === "object"
              ? Object.values(value).flatMap(strings)
              : []
        const progress = JSON.parse(/Advisory plan progress: ([^\n]+)/.exec(strings(body).join("\n"))?.[1] ?? "null")
        if (!progress?.tasks?.[0]?.completed)
          return { tool: "update_goal", args: { plan_progress: { complete: [0, 1], deviation: progressNote } } }
      }
      return { content: "GOAL_UI_WORK_COMPLETED" }
    },
  })
  return { runtime, control }
}

// Shared by the CLI and Desktop /auto flows: bash asks, AUTO_SAFE runs `git status`, AUTO_RISKY runs `rm -rf`.
export const autoReviewFixture = {
  classified: [],
  config: { permission: { "*": "allow", bash: "ask" } },
  next: ({ body, text, finished, ancillary }) => {
    // Mock model classifier: allows `terraform plan`, escalates everything else it is asked about.
    const raw = JSON.stringify(body)
    if (raw.includes("Auto-review safety classifier")) {
      autoReviewFixture.classified.push(raw)
      return {
        content: raw.includes("terraform plan")
          ? '{"decision":"allow","reason":"read-only plan"}'
          : '{"decision":"ask","reason":"changes infrastructure"}',
      }
    }
    if (ancillary) return
    const command = text.includes("AUTO_SAFE")
      ? "git status"
      : text.includes("AUTO_RISKY")
        ? "rm -rf auto-risky-dir"
        : text.includes("AUTO_MODEL_ALLOW")
          ? "terraform plan"
          : text.includes("AUTO_MODEL_ASK")
            ? "terraform apply"
            : ""
    if (!command) return
    if (finished) return { content: "AUTO_DONE" }
    return { tool: "run_terminal_cmd", args: { command, description: "auto review check" } }
  },
}

// Shared by the CLI and Desktop /import-claude flows: a ~/.claude with every importable section.
export async function seedClaude(runtime) {
  const { mkdir, writeFile } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const home = runtime.env.APEXO_TEST_HOME
  await mkdir(join(home, ".claude", "rules"), { recursive: true })
  await writeFile(
    join(home, ".claude", "settings.json"),
    JSON.stringify({
      permissions: { allow: ["Bash(git *)", "Read"], deny: ["Bash(rm -rf *)"], defaultMode: "auto" },
      env: { CLAUDE_IMPORT_FLOW: "1" },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "true" }] }] },
    }),
  )
  await writeFile(
    join(home, ".claude.json"),
    JSON.stringify({ mcpServers: { imported: { url: "http://127.0.0.1:9/mcp" } } }),
  )
  await writeFile(join(home, ".claude", "rules", "style.md"), "# style\n")
  return home
}

export async function importedClaude(runtime) {
  const config = await runtime.api("/global/config")
  return {
    env: config.env?.CLAUDE_IMPORT_FLOW === "1",
    mcp: config.mcp?.imported?.type === "remote",
    permission: config.permission?.bash?.["rm -rf *"] === "deny",
    mode: config.ui?.permission_mode === "auto",
    paths: (config.instructions ?? []).some((item) => item.includes(".claude/rules")),
  }
}
