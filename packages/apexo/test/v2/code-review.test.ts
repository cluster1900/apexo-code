import { expect } from "bun:test"
import path from "node:path"
import { mkdir, symlink } from "node:fs/promises"
import { ConfigProvider, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionCodeReview } from "@apexo/core/session/code-review"
import { Database } from "@apexo/core/database/database"
import { SessionCodeReviewTable } from "@apexo/core/session/code-review.sql"
import { eq } from "drizzle-orm"
import { CodeReviewCapture } from "@apexo/core/session/code-review-capture"
import { CodeReviewResult } from "@apexo/core/session/code-review-result"
import { CodeReview } from "@apexo/schema/code-review"
import { AbsolutePath } from "@apexo/schema/schema"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AgentV2 } from "@apexo/core/agent"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer, reply } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
async function git(root: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [text, error, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(error)
  return text.trim()
}

it.live(
  "frozen uncommitted capture preserves the real index, HEAD, untracked files and symlink entries",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(async () => {
        await Bun.write(path.join(root, "tracked.ts"), "before\n")
        await git(root, "add", ".")
        await git(root, "commit", "-m", "fixture")
        await Bun.write(path.join(root, "tracked.ts"), "staged\n")
        await git(root, "add", "tracked.ts")
        await Bun.write(path.join(root, "tracked.ts"), "unstaged\n")
        await Bun.write(path.join(root, "new.ts"), "captured untracked\n")
        await symlink("/outside/review-must-not-follow", path.join(root, "link"))
      })
      const before = yield* Effect.promise(() => git(root, "diff", "--cached"))
      const status = yield* Effect.promise(() => git(root, "status", "--porcelain"))
      yield* Effect.gen(function* () {
        const capture = yield* CodeReviewCapture.Service
        const frozen = yield* capture.capture(root, { type: "uncommitted" })
        expect(yield* capture.workspaceStatus(frozen)).toBe("current")
        expect(frozen.files.map((file) => file.path)).toContain("new.ts")
        expect(yield* capture.read(frozen, "new", "tracked.ts")).toBe("unstaged\n")
        expect(yield* capture.read(frozen, "new", "link")).toBe("/outside/review-must-not-follow")
        yield* Effect.promise(() => Bun.write(path.join(root, "new.ts"), "changed later\n"))
        expect(yield* capture.workspaceStatus(frozen)).toBe("stale")
        expect(yield* capture.read(frozen, "new", "new.ts")).toBe("captured untracked\n")
        expect((yield* Effect.exit(capture.read(frozen, "new", "../escape")))._tag).toBe("Failure")
        expect(yield* Effect.promise(() => git(root, "diff", "--cached"))).toBe(before)
        expect(yield* Effect.promise(() => git(root, "status", "--porcelain"))).toBe(status)
      }).pipe(Effect.provide(AppNodeBuilder.build(CodeReviewCapture.node)))
    }),
  20000,
)

it.live(
  "host validation preserves outside-hunk findings, downgrades invalid lines and deduplicates",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(async () => {
        await Bun.write(
          path.join(root, "file.ts"),
          Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n",
        )
        await git(root, "add", ".")
        await git(root, "commit", "-m", "fixture")
        await Bun.write(
          path.join(root, "file.ts"),
          "changed\n" + Array.from({ length: 29 }, (_, i) => `line ${i + 2}`).join("\n") + "\n",
        )
      })
      yield* Effect.gen(function* () {
        const capture = yield* CodeReviewCapture.Service
        const frozen = yield* capture.capture(root, { type: "uncommitted" })
        const finding = {
          priority: "P1" as const,
          title: "outside",
          explanation: "broken caller",
          confidence: 0.9,
          path: "file.ts",
          side: "new" as const,
          startLine: 20,
          endLine: 20,
        }
        const result = yield* CodeReviewResult.validate(frozen, {
          summary: "review",
          assessment: "issues_found",
          findings: [finding, finding, { ...finding, title: "invalid", startLine: -2, endLine: 99 }],
        })
        expect(result.findings).toHaveLength(2)
        expect(result.findings[0].anchor.type).toBe("line")
        expect(result.findings[0].anchor).toMatchObject({ inHunk: false, snippet: { startLine: 17 } })
        expect(result.findings[1].anchor).toEqual({ type: "file" })
        expect(result.coverage.invalidLocations).toBe(1)
      }).pipe(Effect.provide(AppNodeBuilder.build(CodeReviewCapture.node)))
    }),
  20000,
)

const setup = Effect.gen(function* () {
  const root = yield* tmpdirScoped({ git: true })
  const llm = yield* TestLLMServer
  yield* Effect.promise(async () => {
    await mkdir(path.join(root, "data"), { recursive: true })
    await Bun.write(path.join(root, ".gitignore"), "data/\nconfig/\n")
    await Bun.write(
      path.join(root, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        compaction: { auto: false },
        agents: { reviewer: { mode: "primary", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
        providers: {
          test: {
            name: "Review fixture",
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url, settings: { apiKey: "fixture" } },
            models: {
              fixture: {
                name: "Fixture",
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 100000, output: 4096 },
              },
            },
          },
        },
      }),
    )
    await Bun.write(path.join(root, "review.ts"), "before\n")
    await git(root, "add", "review.ts")
    await git(root, "commit", "-m", "fixture")
    await Bun.write(path.join(root, "review.ts"), "after\n")
  })
  return {
    root,
    llm,
    create: {
      location: { directory: AbsolutePath.make(root) },
      agent: AgentV2.ID.make("reviewer"),
      model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("fixture") },
    },
    app: AppNodeBuilder.build(
      LayerNode.group([SessionV2.node, SessionCodeReview.node, SessionExecutionLocal.node, Database.node]),
      [
        [SessionExecution.node, SessionExecutionLocal.node],
        [Database.node, Database.layerFromPath(path.join(root, "data", "review.db"))],
        [
          Global.node,
          Layer.succeed(Global.Service)(
            Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
          ),
        ],
      ],
    ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" })))),
  }
})
const clean = JSON.stringify({ summary: "No findings", assessment: "no_findings", findings: [] })

it.live(
  "uncommitted review never executes repository clean filters",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(async () => {
        await Bun.write(path.join(root, "code.ts"), "before\n")
        await git(root, "add", "code.ts")
        await git(root, "commit", "-m", "fixture")
        await Bun.write(path.join(root, ".gitattributes"), "*.ts filter=review-probe\n")
        await git(root, "config", "filter.review-probe.clean", "touch FILTER_EXECUTED; cat")
        await Bun.write(path.join(root, "code.ts"), "after\n")
      })
      yield* Effect.gen(function* () {
        const capture = yield* CodeReviewCapture.Service
        const frozen = yield* capture.capture(root, { type: "uncommitted" })
        expect(yield* Effect.promise(() => Bun.file(path.join(root, "FILTER_EXECUTED")).exists())).toBe(false)
        expect(yield* capture.workspaceStatus(frozen)).toBe("current")
        expect(yield* Effect.promise(() => Bun.file(path.join(root, "FILTER_EXECUTED")).exists())).toBe(false)
        expect(yield* capture.read(frozen, "new", "code.ts")).toBe("after\n")
      }).pipe(Effect.provide(AppNodeBuilder.build(CodeReviewCapture.node)))
    }),
  20000,
)

it.live(
  "base, first-parent commit, renames, deletions and excluded binaries use frozen Git identities",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      const first = yield* Effect.promise(async () => {
        await Bun.write(path.join(root, "old.ts"), "original\n".repeat(30))
        await Bun.write(path.join(root, "deleted.ts"), "deleted\n")
        await git(root, "add", ".")
        await git(root, "commit", "-m", "fixture")
        const sha = await git(root, "rev-parse", "HEAD")
        await git(root, "branch", "baseline")
        await git(root, "mv", "old.ts", "renamed.ts")
        await git(root, "rm", "deleted.ts")
        await Bun.write(path.join(root, "binary.bin"), new Uint8Array([0, 1, 2, 3]))
        await git(root, "add", ".")
        await git(root, "commit", "-m", "changes")
        return sha
      })
      yield* Effect.gen(function* () {
        const capture = yield* CodeReviewCapture.Service
        const base = yield* capture.capture(root, { type: "base", ref: "baseline" })
        const commit = yield* capture.capture(root, { type: "commit", ref: "HEAD" })
        expect(base.mergeBaseSha).toBe(first)
        expect(base.beforeTree).toBe(commit.beforeTree)
        expect(base.afterTree).toBe(commit.afterTree)
        expect(base.files.find((file) => file.path === "renamed.ts")).toMatchObject({
          status: "renamed",
          oldPath: "old.ts",
        })
        expect(base.files.find((file) => file.path === "deleted.ts")?.status).toBe("deleted")
        expect(base.exclusions).toContainEqual({ path: "binary.bin", reason: "binary" })
        expect(yield* capture.read(base, "old", "deleted.ts")).toBe("deleted\n")
        expect((yield* Effect.exit(capture.capture(root, { type: "commit", ref: "--help" })))._tag).toBe("Failure")
      }).pipe(Effect.provide(AppNodeBuilder.build(CodeReviewCapture.node)))
    }),
  20000,
)

it.live(
  "invalid output, exhausted repair budgets, missing usage and unavailable reads cannot become clean reviews",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const reviews = yield* SessionCodeReview.Service
        const parent = yield* sessions.create(f.create)
        yield* f.llm.text("bad", { usage: { input: 2, output: 1 } })
        const limited = yield* reviews.start(parent.id, {
          target: { type: "uncommitted" },
          limits: { mode: "headless", permissions: "reject", maxTurns: 1 },
        })
        const budget = yield* pollWithTimeout(
          reviews
            .get(parent.id, limited.id)
            .pipe(Effect.map((entry) => (CodeReview.terminal(entry) ? entry : undefined))),
          "limited review did not finish",
          "15 seconds",
        )
        expect(budget.status).toBe("failed")
        expect(budget.result).toBeUndefined()
        expect(yield* f.llm.calls).toBe(1)
        yield* f.llm.text(clean)
        const unmetered = yield* reviews.start(parent.id, { target: { type: "uncommitted" } })
        const noUsage = yield* pollWithTimeout(
          reviews
            .get(parent.id, unmetered.id)
            .pipe(Effect.map((entry) => (CodeReview.terminal(entry) ? entry : undefined))),
          "unmetered review did not finish",
          "15 seconds",
        )
        expect(noUsage.status).toBe("failed")
        expect(noUsage.error).toContain("incomplete_usage")
        yield* f.llm.push(
          reply()
            .tool("review_read", { path: "missing.ts", side: "new", startLine: 1, endLine: 2 })
            .usage({ input: 2, output: 1 })
            .item(),
        )
        yield* f.llm.text(clean, { usage: { input: 2, output: 1 } })
        const missing = yield* reviews.start(parent.id, { target: { type: "uncommitted" } })
        const incomplete = yield* pollWithTimeout(
          reviews
            .get(parent.id, missing.id)
            .pipe(Effect.map((entry) => (CodeReview.terminal(entry) ? entry : undefined))),
          "missing-content review did not finish",
          "15 seconds",
        )
        expect(incomplete.status).toBe("completed")
        expect(incomplete.result?.assessment).toBe("inconclusive")
        expect(incomplete.result?.coverage.exclusions).toContainEqual({
          path: "missing.ts",
          reason: "captured_content_unavailable",
        })
      }).pipe(Effect.provide(f.app))
    }),
  30000,
)

it.live(
  "report reload preserves captured evidence and restart marks unfinished work interrupted without sampling",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      const run = yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const reviews = yield* SessionCodeReview.Service
        const database = yield* Database.Service
        const parent = yield* sessions.create(f.create)
        yield* f.llm.text(clean, { usage: { input: 2, output: 1 } })
        const admitted = yield* reviews.start(parent.id, { target: { type: "uncommitted" } })
        const done = yield* pollWithTimeout(
          reviews
            .get(parent.id, admitted.id)
            .pipe(Effect.map((entry) => (CodeReview.terminal(entry) ? entry : undefined))),
          "review did not finish",
          "15 seconds",
        )
        yield* database.db
          .update(SessionCodeReviewTable)
          .set({ data: { ...done, status: "running", result: undefined } })
          .where(eq(SessionCodeReviewTable.id, done.id))
          .run()
        return done
      }).pipe(Effect.provide(f.app))
      yield* Effect.gen(function* () {
        const reviews = yield* SessionCodeReview.Service
        const recovered = yield* reviews.get(run.sessionID, run.id)
        expect(recovered.status).toBe("interrupted")
        expect(recovered.captured).toEqual(run.captured)
        expect((yield* reviews.start(run.sessionID, run.input)).status).toBe("interrupted")
        expect(yield* f.llm.calls).toBe(1)
      }).pipe(Effect.provide(f.app))
    }),
  25000,
)

it.live(
  "native owned review persists a report, denies fabricated mutation tools and reconciles retries",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const reviews = yield* SessionCodeReview.Service
        const parent = yield* sessions.create(f.create)
        yield* f.llm.push(reply().tool("bash", { command: "touch MUTATED" }).usage({ input: 4, output: 3 }).item())
        yield* f.llm.text(clean, { usage: { input: 4, output: 3 } })
        const run = yield* reviews.start(parent.id, { target: { type: "uncommitted" } })
        expect(run.status).toBe("admitted")
        const done = yield* pollWithTimeout(
          reviews.get(parent.id, run.id).pipe(Effect.map((entry) => (CodeReview.terminal(entry) ? entry : undefined))),
          "review did not finish",
          "15 seconds",
        )
        expect(done.error).toBeUndefined()
        expect(done.status).toBe("completed")
        expect(done.result?.assessment).toBe("no_findings")
        expect(yield* Effect.promise(() => Bun.file(path.join(f.root, "MUTATED")).exists())).toBe(false)
        const inputs = JSON.stringify(yield* f.llm.inputs)
        expect(inputs).toContain("review_diff")
        expect(inputs).toContain('"$defs"')
        expect(inputs).toContain("Only review_diff and review_read")
        expect((yield* reviews.start(parent.id, run.input)).id).toBe(run.id)
        expect((yield* Effect.exit(reviews.start(parent.id, { ...run.input, focus: "changed" })))._tag).toBe("Failure")
        expect(yield* f.llm.calls).toBe(2)
        expect((yield* reviews.list(parent.id)).data).toHaveLength(1)
        expect((yield* sessions.messages({ sessionID: parent.id, order: "asc" })).length).toBe(0)
      }).pipe(Effect.provide(f.app))
    }),
  20000,
)

it.live(
  "malformed review output gets one tool-free repair and cancellation settles only the review",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const reviews = yield* SessionCodeReview.Service
        const parent = yield* sessions.create(f.create)
        yield* f.llm.text("malformed", { usage: { input: 4, output: 3 } })
        yield* f.llm.text(clean, { usage: { input: 4, output: 3 } })
        const run = yield* reviews.start(parent.id, { target: { type: "uncommitted" } })
        const done = yield* pollWithTimeout(
          reviews.get(parent.id, run.id).pipe(Effect.map((entry) => (CodeReview.terminal(entry) ? entry : undefined))),
          "repair did not finish",
          "15 seconds",
        )
        expect(done.status).toBe("completed")
        expect(yield* f.llm.calls).toBe(2)
        const repair = (yield* f.llm.inputs)[1]
        expect(repair.tools ?? []).toEqual([])
        yield* f.llm.hang
        const next = yield* reviews.start(parent.id, { target: { type: "uncommitted" } })
        yield* f.llm.wait(3)
        expect((yield* reviews.cancel(parent.id, next.id)).status).toBe("cancelled")
        expect((yield* reviews.cancel(parent.id, next.id)).status).toBe("cancelled")
        expect((yield* sessions.get(parent.id)).id).toBe(parent.id)
        yield* f.llm.hang
        const deleting = yield* reviews.start(parent.id, { target: { type: "uncommitted" } })
        yield* f.llm.wait(4)
        yield* sessions.remove(parent.id)
        expect((yield* Effect.exit(reviews.get(parent.id, deleting.id)))._tag).toBe("Failure")
        expect((yield* Effect.exit(sessions.get(deleting.reviewSessionID)))._tag).toBe("Failure")
      }).pipe(Effect.provide(f.app))
    }),
  25000,
)
