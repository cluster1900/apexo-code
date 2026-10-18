import { fileURLToPath } from "node:url"
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

// Shared by the CLI and Desktop --bash-prefix flows: bash asks, and "Allow always" saves a Grok Build scoped prefix.
export const bashPrefixFixture = {
  config: { permission: { "*": "allow", bash: "ask" } },
  commands: {
    PREFIX_FIRST: "git status",
    PREFIX_AGAIN: "cd . && git status --short",
    PREFIX_OTHER: "git log -1 --oneline",
    PREFIX_RM: "rm -rf prefix-flow-dir",
    PREFIX_RM_AGAIN: "rm -rf prefix-flow-other",
    PREFIX_WIDE: "git diff --stat",
    PREFIX_OPAQUE: "echo $(git rev-parse --short HEAD) | wc -c",
    PREFIX_OPAQUE_AGAIN: "echo $(git rev-parse --short HEAD) | wc -c",
  },
  next: ({ text, finished, ancillary }) => {
    if (ancillary) return
    const key = Object.keys(bashPrefixFixture.commands)
      .sort((a, b) => b.length - a.length)
      .find((item) => text.includes(item))
    if (!key) return
    if (finished) return { content: `${key}_DONE` }
    return { tool: "run_terminal_cmd", args: { command: bashPrefixFixture.commands[key], description: "prefix check" } }
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

// Shared by the CLI and Desktop MCP flows: a real stdio MCP server ("linear") with deferred discovery (the default).
// MCP_FLOW: search_tool → use_tool inline; MCP_FILE: use_tool with an invocation file written in the workspace.
export function mcpFixture() {
  const server = fileURLToPath(new URL("./fixtures/mcp-linear.mjs", import.meta.url))
  const fixture = {
    requests: [],
    config: {
      permission: { "*": "allow" },
      mcp: { linear: { type: "local", command: [process.execPath, server] } },
    },
    next: ({ body, input, text, ancillary }) => {
      if (ancillary) return
      const flow = text.includes("MCP_FLOW") ? "inline" : text.includes("MCP_FILE") ? "file" : text.includes("MCP_AFTER") ? "after" : undefined
      if (!flow) return
      fixture.requests.push(body)
      const lastUser = input.findLastIndex((item) => item.role === "user")
      const outputs = input.slice(lastUser + 1).filter((item) => item.role === "tool" || item.type === "function_call_output")
      if (flow === "inline") {
        if (outputs.length === 0) return { tool: "search_tool", args: { query: "linear create issue" } }
        if (outputs.length === 1) return { tool: "use_tool", args: { tool_name: "linear__create_issue", tool_input: { title: "T1" } } }
        return { content: "MCP_DONE" }
      }
      if (flow === "after") return { content: "MCP_AFTER_DONE" }
      if (outputs.length === 0) return { tool: "use_tool", args: { file: "call.json" } }
      return { content: "MCP_FILE_DONE" }
    },
  }
  return fixture
}

// Shared assertions for the MCP flows; `send(text)` submits a prompt through the real UI.
export async function runMcpFlow(runtime, session, fixture, send, poll) {
  const { writeFile } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const assert = (await import("node:assert/strict")).default
  const checks = []
  const parts = async () => (await runtime.api(`/session/${session.id}/message`)).flatMap((item) => item.parts)
  const tool = async (name, needle) =>
    (await parts()).find(
      (part) => part.type === "tool" && part.tool === name && part.state.status === "completed" && JSON.stringify(part.state).includes(needle),
    )
  const status = await runtime.api("/mcp")
  assert.equal(status.linear?.status, "connected", "stdio MCP server connected")
  await send("MCP_FLOW create an issue")
  await poll(() => tool("use_tool", "ISSUE_CREATED:T1"), "use_tool ran the real MCP tool", 60_000)
  const found = await tool("search_tool", "linear__create_issue")
  assert.ok(found, "search_tool found linear__create_issue")
  assert.ok(JSON.parse(found.state.output).results[0].tools[0].input_schema.required.includes("title"))
  checks.push("search-tool-discovers-real-mcp-tool")
  checks.push("use-tool-calls-real-mcp-tool")
  const first = JSON.stringify(fixture.requests[0])
  const names = (fixture.requests[0].tools ?? []).map((item) => item.function?.name ?? item.name)
  assert.ok(names.includes("search_tool") && names.includes("use_tool"), "wrappers sent")
  assert.ok(!names.some((name) => name.startsWith("linear_")), "MCP tools not sent up front")
  checks.push("mcp-tools-deferred-by-default")
  assert.ok(first.includes("Connected MCP servers:\\n- linear (2 tools)"), "server list reminder")
  checks.push("connected-servers-system-reminder")
  await writeFile(join(runtime.directory, "call.json"), JSON.stringify({ tool_name: "linear__create_issue", tool_input: { title: "T2" } }))
  await send("MCP_FILE create from file")
  await poll(() => tool("use_tool", "ISSUE_CREATED:T2"), "use_tool invocation file", 60_000)
  checks.push("use-tool-invocation-file")
  await runtime.api("/mcp/linear/disconnect", {})
  const before = fixture.requests.length
  await send("MCP_AFTER disconnected")
  await poll(async () => fixture.requests.length > before && (await parts()).some((part) => part.type === "text" && part.text === "MCP_AFTER_DONE"), "turn after disconnect", 60_000)
  assert.ok(JSON.stringify(fixture.requests.at(-1)).includes("MCP server disconnected: linear"), "disconnect delta reminder")
  checks.push("disconnect-delta-reminder")
  return checks
}
