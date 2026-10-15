// Production providers, child transcripts and persisted role routing in CLI/Electron.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const checks = [],
  evidence = []
const pair = { model: "xai/role-planner", agent_type: "inspector" }
for (const mode of [
  "explicit",
  "config-inherit",
  "env-inherit",
  "env-enabled",
  "env-false",
  "invalid-env",
  "unknown-model",
  "unknown-agent",
  "incapable-agent",
  "transport-failure",
  "cancel",
]) {
  const calls = []
  const held = { entered: false, ...Promise.withResolvers() }
  const inherited = ["config-inherit", "env-inherit", "env-enabled", "invalid-env"].includes(mode)
  const requested =
    mode === "unknown-model"
      ? { ...pair, model: "missing" }
      : mode === "unknown-agent"
        ? { ...pair, agent_type: "missing" }
        : mode === "incapable-agent"
          ? { ...pair, agent_type: "blind" }
          : pair
  const runtime = await startShellFixture(kind, {
    goalReports: true,
    models: Object.fromEntries(
      ["role-planner", "role-skeptic"].map((id) => [
        id,
        { name: id, tool_call: true, limit: { context: 100000, output: 10000 } },
      ]),
    ),
    config: {
      agent: {
        build: { permission: { webfetch: "deny" } },
        inspector: { prompt: "ROLE_INSPECTOR_SYSTEM_MARKER", permission: { bash: "deny" } },
        blind: { permission: { read: "deny" } },
      },
      goal: {
        planner_model: requested,
        skeptic_models: [
          { model: "role-skeptic", agent_type: "inspector" },
          { model: "grok-4.7", agent_type: "build" },
        ],
        use_current_model_only: ["config-inherit", "env-false", "invalid-env"].includes(mode),
      },
    },
    env: {
      GROK_GOAL_USE_CURRENT_MODEL_ONLY:
        mode === "env-inherit"
          ? "true"
          : mode === "env-enabled"
            ? " Enabled "
            : mode === "env-false"
              ? "false"
              : "invalid",
    },
    next: async ({ body, input }) => {
      const system = JSON.stringify(input.filter((message) => message.role === "system"))
      const phase = system.includes("independent goal planner")
        ? "planning"
        : system.includes("independent skeptical goal verifier")
          ? "verifying"
          : system.includes("hidden completion evaluator")
            ? "evaluating"
            : "executing"
      calls.push({ phase, body })
      if (phase === "planning" && mode === "transport-failure" && body.model === "role-planner")
        return { error: { status: 400, message: "Role model unavailable during inference" } }
      if (phase === "planning" || phase === "verifying") {
        const inspector = system.includes("ROLE_INSPECTOR_SYSTEM_MARKER")
        const names = body.tools.map((tool) => tool.function?.name ?? tool.name)
        assert.ok(names.includes("read_file"))
        assert.ok(names.includes("write") && !names.includes("task") && !names.includes("web_fetch"))
        if (inspector) assert.ok(!names.includes("run_terminal_cmd"))
        if (input.at(-1)?.role !== "tool")
          return { tool: "read_file", args: { target_file: join(runtime.directory, "evidence.txt") } }
        assert.ok(JSON.stringify(input.at(-1)).includes("ROLE_WORKSPACE_PROOF"))
        if (mode === "cancel") {
          held.entered = true
          await held.promise
        }
        return {
          content: JSON.stringify(
            phase === "planning"
              ? { plan: "Inspect the workspace proof and verify it" }
              : {
                  achieved: true,
                  confidence: "high",
                  blocking: "none",
                  evidence: "Read ROLE_WORKSPACE_PROOF",
                  unmet: [],
                },
          ),
        }
      }
      return {
        content:
          phase === "evaluating"
            ? JSON.stringify({
                decision: "candidate_complete",
                evidence: "Worker checked the file",
                next_step: "Verify it",
                blocker_key: "",
              })
            : "ROLE_WORKER_DONE",
      }
    },
  })
  try {
    await writeFile(join(runtime.directory, "evidence.txt"), "ROLE_WORKSPACE_PROOF")
    const session = await runtime.api("/session", {
      title: `Goal roles ${mode}`,
      permission: [
        { permission: "*", pattern: "*", action: "allow" },
        { permission: "webfetch", pattern: "*", action: "deny" },
      ],
    })
    await runtime.api(`/session/${session.id}/message`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "Inspect the workspace" }],
    })
    const root = `/session/${session.id}/goal`
    const goal = await runtime.api(root, {
      id: `goal_${randomUUID().replaceAll("-", "")}`,
      objective: "Read and confirm ROLE_WORKSPACE_PROOF",
    })
    await runtime.api(`${root}/${goal.id}/run`, undefined, "POST")
    if (mode === "cancel") {
      await poll(() => held.entered, "explicit role waiting after file read", 15000)
      await runtime.api(`${root}/${goal.id}/pause`, undefined, "POST")
      held.resolve()
    }
    const state = await poll(
      async () => {
        const state = await runtime.api(root)
        return state.status !== "active" && state
      },
      `Goal roles ${mode}`,
      45000,
    )
    if (mode === "cancel") {
      assert.equal(state.status, "user_paused")
      assert.equal(state.usageIncomplete, true)
      assert.deepEqual(
        calls.map((call) => call.body.model),
        ["role-planner", "role-planner"],
      )
      assert.equal((await runtime.api(`/session/${session.id}/children`)).length, 1)
    } else if (mode === "transport-failure") {
      assert.equal(state.status, "infra_paused")
      assert.equal(state.usageIncomplete, true)
      assert.deepEqual(
        calls.filter((call) => call.phase === "planning").map((call) => call.body.model),
        ["role-planner", "grok-4.7", "grok-4.7"],
      )
      assert.equal((await runtime.api(`/session/${session.id}/children`)).length, 2)
    } else {
      assert.equal(state.status, "complete", JSON.stringify(state))
      const fallback = {
        "unknown-model": "model_unavailable",
        "unknown-agent": "agent_unavailable",
        "incapable-agent": "agent_incapable",
      }[mode]
      assert.equal(state.plannerExecution.model.id, inherited || fallback ? "grok-4.7" : "role-planner")
      assert.equal(state.plannerExecution.fallback, fallback)
      assert.deepEqual(
        state.verification.results.map((item) => item.execution.model.id),
        inherited ? ["grok-4.7", "grok-4.7", "grok-4.7"] : ["role-skeptic", "grok-4.7", "role-skeptic"],
      )
      assert.equal(state.tokensUsed, calls.length * 120)
      assert.ok(
        calls
          .filter((call) => ["executing", "evaluating"].includes(call.phase))
          .every((call) => call.body.model === "grok-4.7"),
      )
      if (mode === "explicit") {
        await runtime.crash()
        await runtime.reopen()
        assert.deepEqual(await runtime.api(root), state)
      }
    }
    checks.push(mode)
    evidence.push({ mode, output: runtime.output, modelDecisions: calls.length, modelRequests: runtime.calls.length })
    await writeFile(join(runtime.output, "goal-roles.json"), JSON.stringify({ state, calls }, null, 2))
  } finally {
    held.resolve()
    await runtime.close()
    console.error(`Goal role evidence (${mode}): ${runtime.output}`)
  }
}
console.log(JSON.stringify({ kind, checks, evidence }, null, 2))
