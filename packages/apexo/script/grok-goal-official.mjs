// Installed Grok Goal lifecycle, with an isolated home/workspace and a local held provider.
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const output = await mkdtemp(join(tmpdir(), "apexo-goal-official-"))
const roleModels = process.argv.includes("--role-models")
const currentModelOnly = process.argv.includes("--current-model-only")
const unknownRole = process.argv.includes("--unknown-role")
const observeRoles = process.argv.includes("--observe-roles")
const differences = []
const fallback = process.argv.find((arg) => arg.startsWith("--fallback="))?.split("=")[1]
assert.ok(!fallback || ["initial", "parent", "mtime"].includes(fallback))
const changes = process.argv.includes("--changes") || !!fallback
const workspace = process.argv.includes("--workspace") || roleModels || changes
const planning = process.argv.includes("--planner") || workspace
const execution = process.argv.includes("--execute")
const retention = process.argv.includes("--retention")
const verifierArg = process.argv.indexOf("--verifiers")
const verifierCount = verifierArg < 0 ? 3 : Number(process.argv[verifierArg + 1])
assert.ok(Number.isInteger(verifierCount) && verifierCount >= 1 && verifierCount <= 5)
const scenario = { mode: "complete", verifiers: 0, workers: 0, evaluations: 0 }
const authorizedWrites = new Set()
const cwd = join(output, "workspace")
const home = join(output, "home")
await mkdir(cwd)
await mkdir(home)
if (workspace) await writeFile(join(cwd, "evidence.txt"), "GOAL_OFFICIAL_WORKSPACE_PROOF")
if (fallback !== "mtime") execFileSync("git", ["init"], { cwd, stdio: "pipe" })
const git = (...args) =>
  execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "-c", "user.name=Goal Test", "-c", "user.email=goal@apexo.test", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim()
if (changes && !fallback) {
  await writeFile(join(cwd, "work.txt"), "before\n")
  git("add", ".")
  git("commit", "-m", "Before Goal")
}
const baseline = changes && !fallback ? git("rev-parse", "HEAD") : undefined
const calls = [],
  events = [],
  evidence = [],
  checks = [],
  logs = []
const goalCalls = () =>
  calls.filter((call) => !JSON.stringify(call.messages?.at(-1)).includes("Generate a session title")).length
const provider = createServer(async (request, response) => {
  if (request.method !== "POST") return response.end(JSON.stringify({ data: [{ id: "fixture", object: "model" }] }))
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push(body)
  if (execution) {
    const title =
      body.tools?.some((tool) => tool.function?.name === "session_title") ||
      JSON.stringify(body.messages?.at(-1)).includes("Generate a session title") ||
      body.messages?.some(
        (message) => message.role === "system" && String(message.content).includes("ultra-short dashboard line"),
      )
    const evaluator = body.messages?.some(
      (message) => message.role === "system" && String(message.content).includes("hidden completion evaluator"),
    )
    const planner = !title && !evaluator && JSON.stringify(body.messages).includes("Goal Plan Writer")
    const verifier = !title && !evaluator && !planner && JSON.stringify(body.messages).includes("adversarial verifier")
    const inspected = workspace && (planner || verifier) ? workspaceReply(body, planner) : undefined
    if (evaluator) scenario.evaluations++
    if (verifier) scenario.verifiers++
    if (!title && !verifier && !evaluator && !planner) scenario.workers++
    if (changes && scenario.workers === 1 && !title && !verifier && !evaluator && !planner) {
      if (fallback === "parent") {
        await writeFile(join(cwd, "original.txt"), "OFFICIAL_OLD_COMMIT_PROOF\n")
        git("add", "original.txt")
        const date = new Date(Date.now() - 120_000).toISOString()
        execFileSync(
          "git",
          [
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.name=GoalTest",
            "-c",
            "user.email=goal@apexo.test",
            "commit",
            "-m",
            "Older commit",
          ],
          { cwd, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, stdio: "pipe" },
        )
      }
      await writeFile(join(cwd, "committed.txt"), "OFFICIAL_COMMITTED_PROOF\n")
      if (fallback !== "mtime") {
        git("add", "committed.txt")
        git("commit", "-m", "During Goal")
      }
      await writeFile(join(cwd, "staged.txt"), "OFFICIAL_STAGED_PROOF\n")
      if (fallback !== "mtime") git("add", "staged.txt")
      await writeFile(join(cwd, "work.txt"), "OFFICIAL_WORKTREE_PROOF\n")
      await writeFile(join(cwd, "untracked.txt"), "OFFICIAL_UNTRACKED_PROOF\n")
    }
    const content =
      inspected?.content ??
      (title
        ? "Goal runtime test"
        : evaluator
          ? JSON.stringify({
              decision:
                scenario.mode === "blocked"
                  ? "blocked"
                  : scenario.mode === "continue" && scenario.evaluations < 4
                    ? "continue"
                    : "candidate_complete",
              ...(scenario.mode === "invalid" || (scenario.mode === "retry-evaluation" && scenario.evaluations === 1)
                ? { extra: true }
                : {}),
              evidence: "The transcript states GOAL_RUNTIME_FACT with A and B",
              next_step: "Independently verify the stated answer",
              blocker_key: scenario.mode === "blocked" ? "required_service" : "",
            })
          : verifier
            ? scenario.mode === "reject" && scenario.verifiers <= verifierCount
              ? "Refuted"
              : "Not Refuted"
            : "GOAL_RUNTIME_FACT: A and B are both stated.")
    const tool = inspected?.tool
      ? body.tools.find((tool) => tool.function?.name === inspected.tool)
      : !planner && !title && !verifier && body.messages?.at(-1)?.role !== "tool"
        ? body.tools?.find((tool) => tool.function?.name === "update_goal")
        : undefined
    const id = `official_goal_${calls.length}`
    const delta = tool
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id,
              type: "function",
              function: {
                name: tool.function.name,
                arguments: JSON.stringify(
                  inspected?.args ?? { completed: true, message: "GOAL_RUNTIME_FACT: A and B are both stated." },
                ),
              },
            },
          ],
        }
      : { role: "assistant", content }
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(
      [
        {
          id,
          object: "chat.completion.chunk",
          created: 1,
          model: "fixture",
          choices: [{ index: 0, delta, finish_reason: null }],
        },
        {
          id,
          object: "chat.completion.chunk",
          created: 1,
          model: "fixture",
          choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }],
          usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
        },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("") + "data: [DONE]\n\n",
    )
    return
  }
  // Keep actual inference pending until cancellation/SIGKILL, without synthesizing completion.
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.write(": held goal provider\n\n")
})
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve))
await writeFile(
  join(home, "config.toml"),
  `[models]
default = "fixture"
[model.fixture]
model = "fixture"
name = "Goal fixture"
base_url = "http://127.0.0.1:${provider.address().port}/v1"
api_key = "local-fixture-key"
api_backend = "chat_completions"
context_window = 100000
[memory]
enabled = false
[features]
goal = true
[cli]
use_leader = false
` +
    (roleModels
      ? `
[goal]
planner_model = { model = "${unknownRole ? "missing-role-model" : "fixture-planner"}", agent_type = "grok-build" }
skeptic_models = [{ model = "${unknownRole ? "missing-role-model" : "fixture-skeptic"}", agent_type = "grok-build" }, { model = "fixture", agent_type = "grok-build" }]
${["fixture-planner", "fixture-skeptic"]
  .map(
    (id) => `[model.${id}]
model = "${id}"
name = "${id}"
base_url = "http://127.0.0.1:${provider.address().port}/v1"
api_key = "local-fixture-key"
api_backend = "chat_completions"
context_window = 100000
`,
  )
  .join("\n")}`
      : ""),
)

const launch = async () => {
  const child = spawn("grok", ["agent", "stdio", "--leader-socket", join(output, "leader.sock")], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: home,
      GROK_HOME: home,
      GROK_CONFIG: "",
      GROK_CONFIG_PATH: "",
      XAI_API_KEY: "local-fixture-key",
      GROK_MEMORY: "0",
      GROK_GOAL: "1",
      ...(verifierArg >= 0 ? { GROK_GOAL_VERIFIER_N: String(verifierCount) } : {}),
      GROK_GOAL_PLANNER: planning ? "1" : "0",
      GROK_GOAL_CLASSIFIER: execution ? "1" : "0",
      GROK_GOAL_SUMMARY: "0",
      GROK_GOAL_USE_CURRENT_MODEL_ONLY: roleModels && !currentModelOnly ? "0" : "1",
      GROK_MANAGED_MCPS_ENABLED: "0",
      ...Object.fromEntries(
        ["CURSOR", "CLAUDE", "CODEX"].flatMap((vendor) =>
          ["MCPS", "RULES", "SKILLS", "AGENTS", "HOOKS"].map((surface) => [`GROK_${vendor}_${surface}_ENABLED`, "0"]),
        ),
      ),
    },
  })
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })))
  child.stderr.on("data", (chunk) => logs.push(chunk))
  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(params) {
        events.push({ permission: params })
        if (workspace && authorizedWrites.has(params.toolCall.rawInput?.file_path)) {
          const option = params.options.find((option) => option.kind === "allow_once")
          assert.ok(option)
          return { outcome: { outcome: "selected", optionId: option.optionId } }
        }
        return { outcome: { outcome: "cancelled" } }
      },
      async sessionUpdate(params) {
        events.push(params)
      },
      async extNotification(method, params) {
        events.push({ method, params })
      },
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  )
  await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    30_000,
    "initialize",
  )
  return { child, exited, connection }
}

const runtime = { current: undefined }
const stop = async (signal = "SIGTERM") => {
  const current = runtime.current
  if (!current) return
  current.child.kill(signal)
  await deadline(current.exited, 10_000, "isolated Grok exit")
  runtime.current = undefined
}
const prompt = (id, text) => runtime.current.connection.prompt({ sessionId: id, prompt: [{ type: "text", text }] })
const state = async (id) => {
  const response = await runtime.current.connection.extMethod("_x.ai/session/state", { sessionId: id, cwd })
  return response.result ?? response
}

try {
  runtime.current = await launch()
  if (execution) await exerciseExecution()
  else {
    const id = (await runtime.current.connection.newSession({ cwd, mcpServers: [] })).sessionId
    await deadline(prompt(id, "/goal status"), 15_000, "empty goal status")
    assert.equal(goalCalls(), 0)
    checks.push("status-without-goal-does-not-call-model")
    const turn = prompt(id, "/goal Preserve GOAL_LIFECYCLE_FACT and validate all requirements --budget 10000").then(
      (result) => ({ result }),
      (error) => ({ error: String(error) }),
    )
    await poll(() => goalCalls() > 0, "goal inference started", 20_000)
    if (planning) {
      assert.ok(calls.some((call) => JSON.stringify(call.messages).includes("Goal Plan Writer")))
      checks.push("creation-starts-independent-planner-with-original-objective")
    }
    await runtime.current.connection.cancel({ sessionId: id })
    await deadline(turn, 15_000, "cancelled goal turn")
    await poll(async () => (await state(id)).goal?.status === "user_paused", "cancel state persisted", 10_000)
    const paused = await state(id)
    evidence.push({ stage: "cancelled", state: paused })
    assert.equal(paused.goal.status, "user_paused")
    assert.equal(paused.goal.token_budget, 10000)
    assert.match(paused.goal.objective, /GOAL_LIFECYCLE_FACT/)
    assert.equal(paused.goal.objective.includes("--budget"), false)
    checks.push("cancel-pauses-and-persists-objective-budget")
    const count = goalCalls()
    for (const _ of [1, 2, 3]) await deadline(prompt(id, "/goal status"), 15_000, "paused status")
    assert.equal(goalCalls(), count)
    checks.push("status-polling-does-not-resume")
    const resumed = prompt(id, "/goal resume").then(
      (result) => ({ result }),
      (error) => ({ error: String(error) }),
    )
    await poll(() => goalCalls() > count, "explicit resume starts inference", 20_000)
    await stop("SIGKILL")
    await deadline(resumed, 15_000, "killed goal request")
    runtime.current = await launch()
    await runtime.current.connection.loadSession({ sessionId: id, cwd, mcpServers: [] })
    await deadline(prompt(id, "/goal status"), 15_000, "recovered status")
    const restored = await state(id)
    evidence.push({ stage: "sigkill-reopened", state: restored })
    assert.equal(restored.goal.status, "user_paused")
    assert.equal(restored.goal.objective, paused.goal.objective)
    checks.push("sigkill-reopen-restores-paused-goal")
    const afterReopen = goalCalls()
    await deadline(prompt(id, "/goal pause"), 15_000, "idempotent pause")
    assert.equal(goalCalls(), afterReopen)
    checks.push("paused-pause-is-idempotent")
    await deadline(prompt(id, "/goal clear"), 15_000, "clear")
    const cleared = await state(id)
    evidence.push({ stage: "cleared", state: cleared })
    assert.ok(!cleared.goal || cleared.goal === null)
    assert.equal(goalCalls(), afterReopen)
    checks.push("clear-removes-goal-without-inference")
  }
  console.log(
    JSON.stringify(
      {
        output,
        checks,
        calls: calls.length,
        ...(roleModels ? { status: differences.length ? "partial" : "passed", differences } : {}),
      },
      null,
      2,
    ),
  )
} finally {
  await stop()
  provider.closeAllConnections()
  await new Promise((resolve) => provider.close(resolve))
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify({ checks, differences, evidence, calls, events }, null, 2),
  )
  await writeFile(join(output, "grok.log"), Buffer.concat(logs))
  console.error(`Goal evidence: ${output}`)
}

async function exerciseExecution() {
  for (const mode of workspace
    ? ["complete"]
    : [
        "complete",
        "reject",
        "budget",
        ...(process.argv.includes("--evaluator") ? ["continue", "blocked", "retry-evaluation", "invalid"] : []),
      ]) {
    scenario.mode = mode
    scenario.workers = 0
    scenario.verifiers = 0
    scenario.evaluations = 0
    const id = (await runtime.current.connection.newSession({ cwd, mcpServers: [] })).sessionId
    await deadline(
      prompt(
        id,
        `/goal ${workspace ? "Read evidence.txt and confirm GOAL_OFFICIAL_WORKSPACE_PROOF" : "State GOAL_RUNTIME_FACT with both A and B"} --budget ${mode === "budget" ? 200 : 100000}`,
      ),
      60_000,
      `official goal ${mode}`,
    )
    const result = await poll(
      async () => {
        const value = await state(id)
        return value.goal && value.goal.status !== "active" && value
      },
      `official ${mode} settles`,
      20_000,
    )
    evidence.push({
      mode,
      state: result,
      workers: scenario.workers,
      verifiers: scenario.verifiers,
      evaluations: scenario.evaluations,
    })
    if (mode === "budget") {
      assert.equal(result.goal.status, "budget_limited")
      assert.ok(result.goal.tokens_used_high_water >= 200)
      checks.push("actual-provider-usage-exhausts-budget")
      continue
    }
    if (mode === "invalid") {
      assert.equal(result.goal.status, "infra_paused")
      assert.equal(scenario.evaluations, 2)
      assert.equal(scenario.verifiers, 0)
      checks.push("invalid-evaluator-json-pauses-after-one-retry")
      continue
    }
    if (mode === "blocked") {
      assert.equal(result.goal.status, "blocked")
      assert.equal(scenario.evaluations, 3)
      assert.equal(scenario.workers, 3)
      assert.equal(scenario.verifiers, 0)
      checks.push("three-independent-stable-blockers-pause")
      continue
    }
    assert.equal(result.goal.status, "complete")
    if (workspace) {
      if (changes) {
        if (fallback) assert.ok(result.goal.changes_baseline_commit == null)
        else assert.equal(result.goal.changes_baseline_commit, baseline)
        const materials = calls
          .flatMap((call) => call.messages ?? [])
          .filter(
            (message) =>
              message.role === "user" &&
              typeof message.content === "string" &&
              message.content.includes("CHANGES_FILE:"),
          )
        assert.ok(materials.length)
        const paths = [
          ...new Set(
            materials.map((message) => message.content.match(/CHANGES_FILE:\s*(\/[^\n\\]+)/)?.[1]).filter(Boolean),
          ),
        ]
        assert.equal(paths.length, 1)
        // Grok removes temporary patches after completion; inspect the actual read_file tool receipts.
        const patch = calls
          .flatMap((call) => call.messages ?? [])
          .filter((message) => message.role === "tool")
          .map((message) => String(message.content))
          .join("\n")
        for (const proof of !fallback || fallback === "mtime"
          ? ["OFFICIAL_COMMITTED_PROOF", "OFFICIAL_STAGED_PROOF", "OFFICIAL_WORKTREE_PROOF"]
          : ["OFFICIAL_COMMITTED_PROOF"])
          assert.ok(patch.includes(proof))
        if (fallback === "parent") assert.ok(!patch.includes("OFFICIAL_OLD_COMMIT_PROOF"))
        assert.ok(materials.some((message) => message.content.includes("untracked.txt")))
        checks.push(
          fallback
            ? `official-${fallback}-fallback-shared-change-material`
            : "official-creation-baseline-cumulative-diff-untracked-list-shared-across-reviewers",
        )
      }
      const readbacks = calls.filter((call) =>
        call.messages?.some(
          (message) => message.role === "tool" && String(message.content).includes("GOAL_OFFICIAL_WORKSPACE_PROOF"),
        ),
      )
      assert.ok(readbacks.some((call) => JSON.stringify(call.messages).includes("Goal Plan Writer")))
      assert.ok(
        readbacks.filter((call) => JSON.stringify(call.messages).includes("adversarial verifier")).length >=
          verifierCount,
      )
      checks.push("official-planner-and-verifiers-read-real-workspace-file")
      const writes = calls
        .flatMap((call) => call.messages ?? [])
        .flatMap((message) => message.tool_calls ?? [])
        .filter((call) => call.function?.name === "write")
      assert.ok(new Set(writes.map((call) => call.function.arguments)).size >= 1 + verifierCount * 2)
      checks.push("official-plan-and-structured-verdict-artifacts-written-through-tools")
      if (retention) {
        const roots = [
          ...new Set(
            [...authorizedWrites].flatMap((file) => {
              const root = /^(.*\/grok-goal-[^/]+)\//.exec(file)?.[1]
              return root ? [root] : []
            }),
          ),
        ]
        assert.ok(roots.length, "Actual official report tool paths expose owned scratch roots")
        for (const root of roots)
          assert.equal(
            await access(root).then(
              () => true,
              () => false,
            ),
            false,
          )
        assert.ok(result.goal.last_classifier_details_path, "Terminal snapshot retains a details reference")
        assert.match(await readFile(result.goal.last_classifier_details_path, "utf8"), /GOAL_OFFICIAL_WORKSPACE_PROOF/)
        evidence.push({
          terminalRetention: { removedScratchRoots: roots, retainedDetails: result.goal.last_classifier_details_path },
        })
        checks.push("official-terminal-removes-owned-scratch-and-retains-classifier-details")
      }
      if (roleModels) {
        const planners = calls.filter((call) => JSON.stringify(call.messages).includes("Goal Plan Writer"))
        const skeptics = calls.filter(
          (call) =>
            !JSON.stringify(call.messages).includes("Goal Plan Writer") &&
            JSON.stringify(call.messages).includes("adversarial verifier"),
        )
        assert.ok(planners.length && skeptics.length)
        const plannerModels = [...new Set(planners.map((call) => call.model))]
        if (
          observeRoles &&
          !currentModelOnly &&
          !unknownRole &&
          !planners.every((call) => call.model === "fixture-planner")
        )
          differences.push({ feature: "planner_model", expected: "fixture-planner", observed: plannerModels })
        else assert.deepEqual(plannerModels, [currentModelOnly || unknownRole ? "fixture" : "fixture-planner"])
        assert.deepEqual(
          [...new Set(skeptics.map((call) => call.model))].sort(),
          currentModelOnly || unknownRole ? ["fixture"] : ["fixture", "fixture-skeptic"],
        )
        checks.push(
          currentModelOnly
            ? "official-current-model-kill-switch"
            : unknownRole
              ? "official-unknown-role-model-falls-back"
              : differences.length
                ? "official-round-robin-skeptic-models-planner-not-aligned"
                : "official-planner-and-round-robin-skeptic-models",
        )
      }
    }
    if (mode === "continue") {
      assert.equal(scenario.workers, 4)
      assert.equal(scenario.evaluations, 4)
      checks.push("evaluator-continues-concrete-work-for-four-rounds")
      continue
    }
    if (mode === "retry-evaluation") {
      assert.equal(scenario.evaluations, 2)
      assert.equal(scenario.workers, 1)
      checks.push("evaluator-invalid-json-retries-before-verification")
      continue
    }
    assert.ok(
      scenario.verifiers >= verifierCount * (mode === "reject" ? 2 : 1),
      `expected actual independent verifier requests: ${scenario.verifiers}`,
    )
    if (mode === "reject") assert.ok(scenario.workers >= 2)
    checks.push(
      mode === "reject"
        ? "verifier-rejection-restarts-work-before-completion"
        : "worker-and-independent-verifier-panel-complete-goal",
    )
  }
}

function workspaceReply(body, planner) {
  const messages = body.messages ?? []
  const text = messages
    .flatMap((message) =>
      typeof message.content === "string"
        ? [message.content]
        : (message.content ?? []).flatMap((part) => (typeof part.text === "string" ? [part.text] : [])),
    )
    .join("\n")
  const read = messages.some(
    (message) => message.role === "tool" && String(message.content).includes("GOAL_OFFICIAL_WORKSPACE_PROOF"),
  )
  if (!read) return { tool: "read_file", args: { target_file: join(cwd, "evidence.txt") } }
  if (
    changes &&
    !planner &&
    !messages.some((message) => message.role === "tool" && String(message.content).includes("OFFICIAL_COMMITTED_PROOF"))
  ) {
    const patch = text.match(/CHANGES_FILE:\s*(\/[^\n\\]+)/)?.[1]
    assert.ok(patch && patch !== "(unavailable)")
    return { tool: "read_file", args: { target_file: patch } }
  }
  const paths = planner
    ? [text.match(/your only write is `([^`]+)`/)?.[1]]
    : [text.match(/JSON verdict[^`\n]*`([^`\n]+)`/)?.[1], text.match(/Details[^`\n]*`([^`\n]+)`/)?.[1]]
  assert.ok(paths.every(Boolean), "official role prompt contains explicit artifact paths")
  const written = messages
    .flatMap((message) => message.tool_calls ?? [])
    .filter((call) => call.function?.name === "write")
    .map((call) => JSON.parse(call.function.arguments).file_path)
  const missing = paths.find((path) => !written.includes(path))
  if (!missing) return { content: planner ? "Done" : "Not Refuted" }
  authorizedWrites.add(missing)
  const details = "Read evidence.txt through read_file and observed GOAL_OFFICIAL_WORKSPACE_PROOF."
  return {
    tool: "write",
    args: {
      file_path: missing,
      content: planner
        ? "# Goal plan\n## Goal kind\nanalysis\n## Objective\nRead evidence.txt and confirm GOAL_OFFICIAL_WORKSPACE_PROOF.\n## Acceptance criteria\n1. Read the current file and cite its exact contents.\n## Verification plan\nUse read_file to inspect evidence.txt.\n"
        : missing === paths[0]
          ? JSON.stringify({
              refuted: false,
              findings: [],
              evidence: details,
              confidence: "high",
              blocking: "none",
              details_md: details,
            })
          : details,
    },
  }
}
