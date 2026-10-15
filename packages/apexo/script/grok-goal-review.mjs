// Real HTTP model transport and durable Goal reviews under Bun and Electron's embedded Node.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { LLM, LLMClient, Message, SystemPart } from "@apexo/llm"
import { OpenAIChat } from "@apexo/llm/protocols/openai-chat"
import { RequestExecutor } from "@apexo/llm/route"
import { FetchHttpClient } from "effect/unstable/http"
import { Database } from "@apexo/core/database/database"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalReview } from "@apexo/core/session/goal-review"
import { SessionTable } from "@apexo/core/session/sql"
import { ProjectTable } from "@apexo/core/project/sql"
import { Goal } from "@apexo/schema/goal"
import { SessionID } from "@apexo/schema/session-id"
import { deadline } from "./grok-shell-fixture.mjs"

if (process.argv[2] === "worker") await worker()
else await run()

async function run() {
  const mode = process.argv[2] ?? "cli"
  assert.ok(["cli", "desktop"].includes(mode))
  const output = await mkdtemp(join(tmpdir(), `apexo-goal-review-${mode}-`))
  const calls = []
  const provider = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    calls.push(body)
    const data = JSON.parse(body.messages.at(-1).content)
    if (data.evidence === "unavailable") {
      res.writeHead(503, { "content-type": "application/json" })
      return res.end(JSON.stringify({ error: { message: "Local fixture unavailable" } }))
    }
    res.writeHead(200, { "content-type": "text/event-stream" })
    const text =
      data.evidence === "malformed"
        ? "not valid JSON"
        : data.evidence === "missing"
          ? JSON.stringify({
              confidence: "high",
              blocking: "none",
              achieved: false,
              evidence: "B has not been tested",
              unmet: ["Test B"],
            })
          : data.evidence === "proven"
            ? JSON.stringify({
                confidence: "high",
                blocking: "none",
                achieved: true,
                evidence: "A and B both passed, test evidence T1 and T2",
                unmet: [],
              })
            : JSON.stringify({ plan: "Implement A and B, then verify T1 and T2 independently." })
    res.write(
      `data: ${JSON.stringify({ id: "review", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: text } }] })}\n\n`,
    )
    if (data.evidence === "held") return
    res.end(
      `data: ${JSON.stringify({ id: "review", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, prompt_tokens_details: { cached_tokens: 5 }, completion_tokens_details: { reasoning_tokens: 4 } } })}\n\ndata: [DONE]\n\n`,
    )
  })
  await new Promise((done) => provider.listen(0, "127.0.0.1", done))
  const childState = { child: undefined }
  try {
    const build = await Bun.build({
      entrypoints: [fileURLToPath(import.meta.url)],
      target: mode === "cli" ? "bun" : "node",
      format: "esm",
      outdir: join(output, "build"),
      external: ["bun:sqlite", "node:sqlite"],
    })
    assert.ok(build.success, build.logs.map(String).join("\n"))
    const engine =
      mode === "cli"
        ? process.execPath
        : resolve(
            "../desktop/node_modules/electron/dist",
            (await readFile("../desktop/node_modules/electron/path.txt", "utf8")).trim(),
          )
    const child = Bun.spawn(
      [engine, build.outputs[0].path, "worker", output, `http://127.0.0.1:${provider.address().port}/v1`],
      {
        env: {
          ...process.env,
          APEXO_TEST_HOME: output,
          XDG_DATA_HOME: output,
          XDG_CONFIG_HOME: output,
          XDG_CACHE_HOME: output,
          ...(mode === "desktop" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    childState.child = child
    const [stdout, stderr, code] = await deadline(
      Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]),
      90_000,
      "Goal model reviews",
    )
    await writeFile(join(output, "worker.log"), `${stdout}\n${stderr}`)
    assert.equal(code, 0, stderr)
    const result = JSON.parse(stdout.trim())
    assert.equal(calls.length, 11)
    assert.equal(calls.filter((call) => JSON.parse(call.messages.at(-1).content).evidence === "unavailable").length, 3)
    assert.ok(calls.every((call) => (call.tools ?? []).length === 0))
    assert.ok(calls.every((call) => JSON.stringify(call).includes("ORIGINAL_A_AND_B")))
    result.checks.push("all-reviews-use-original-objective-and-no-tools")
    await writeFile(join(output, "evidence.json"), JSON.stringify({ mode, result, calls }, null, 2))
    console.log(JSON.stringify({ mode, passed: result.checks.length, output, checks: result.checks }, null, 2))
  } finally {
    if (childState.child && childState.child.exitCode === null) {
      childState.child.kill("SIGTERM")
      await deadline(childState.child.exited, 10_000, "owned review worker exit")
    }
    provider.closeAllConnections()
    await new Promise((done) => provider.close(done))
    await writeFile(join(output, "requests.json"), JSON.stringify(calls, null, 2))
    console.log(`Goal review evidence: ${output}`)
  }
}

async function worker() {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      const llm = yield* LLMClient.Service
      const goals = SessionGoal.make(database.db)
      const reviews = SessionGoalReview.make(goals)
      const model = OpenAIChat.route.with({ endpoint: { baseURL: process.argv[4] } }).model({ id: "fixture" })
      const checks = []
      yield* database.db
        .insert(ProjectTable)
        .values({ id: "goal-review", worktree: process.cwd(), sandboxes: [] })
        .onConflictDoNothing()
        .run()
      const seed = (budget) =>
        Effect.gen(function* () {
          const sessionID = SessionID.create()
          yield* database.db
            .insert(SessionTable)
            .values({
              id: sessionID,
              project_id: "goal-review",
              slug: "review",
              directory: process.cwd(),
              title: "Goal review",
              version: "1",
            })
            .run()
          const info = yield* goals.create(sessionID, {
            id: Goal.ID.create(),
            objective: "ORIGINAL_A_AND_B: implement A and B, verify T1 and T2",
            tokenBudget: budget,
          })
          return { sessionID, goalID: info.id }
        })
      const review = (target, kind, evidence, entered) =>
        reviews.run({
          target,
          kind,
          evidence,
          stream: (request) =>
            llm
              .stream(
                LLM.request({
                  model,
                  system: [SystemPart.make(request.system)],
                  messages: [Message.user(request.content)],
                  tools: [],
                  toolChoice: "none",
                }),
              )
              .pipe(
                Stream.tap((event) =>
                  entered && event.type === "text-delta" ? Deferred.succeed(entered, undefined) : Effect.void,
                ),
              ),
        })
      const completeWorker = (target) =>
        Effect.gen(function* () {
          const attempt = yield* goals.begin(target, "executing")
          yield* goals.update(attempt, { completed: true })
          yield* goals.finish(attempt, {})
        })
      const target = yield* seed()
      const planned = yield* review(target, "planning", "current repository")
      assert.equal(planned.info.tokensUsed, 30)
      assert.match(planned.info.plan, /A and B/)
      checks.push("planning-through-real-http-and-inclusive-usage")
      yield* completeWorker(target)
      const rejected = yield* review(target, "verifying", "missing")
      assert.equal(rejected.info.status, "active")
      assert.deepEqual(rejected.info.unmet, ["Test B"])
      checks.push("independent-verifier-rejects-missing-requirement")
      yield* completeWorker(target)
      const completed = yield* review(target, "verifying", "proven")
      assert.equal(completed.info.status, "complete")
      assert.equal(completed.info.tokensUsed, 150)
      checks.push("independent-verdict-completes-and-saves-evidence")
      const malformed = yield* review(yield* seed(), "planning", "malformed")
      assert.equal(malformed.info.status, "infra_paused")
      assert.equal(malformed.info.tokensUsed, 30)
      checks.push("invalid-json-pauses-with-usage-retained")
      const unavailable = yield* review(yield* seed(), "planning", "unavailable")
      assert.equal(unavailable.info.status, "infra_paused")
      checks.push("http-failure-pauses-without-completion")
      const limited = yield* review(yield* seed(20), "planning", "current repository")
      assert.equal(limited.info.status, "budget_limited")
      assert.equal(limited.info.tokensUsed, 30)
      checks.push("budget-exhaustion-discards-planner-output")
      const held = yield* seed()
      const entered = yield* Deferred.make()
      const running = yield* review(held, "planning", "held", entered).pipe(Effect.forkChild)
      yield* Deferred.await(entered).pipe(Effect.timeout(10_000))
      yield* Fiber.interrupt(running)
      assert.equal((yield* goals.get(held.sessionID)).status, "user_paused")
      checks.push("cancel-aborts-http-and-persists-paused-state")
      return { checks }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Database.layerFromPath(join(process.argv[3], "goals.sqlite")),
          LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(FetchHttpClient.layer)))),
        ),
      ),
    ),
  )
  console.log(JSON.stringify(result))
}
