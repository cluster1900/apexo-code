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
  const proc = Bun.spawn(["git", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" })
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
      const outside = yield* tmpdirScoped()
      yield* Effect.promise(async () => {
        await Bun.write(path.join(outside, "large"), new Uint8Array(2 * 1024 * 1024 + 1))
        await symlink(path.join(outside, "large"), path.join(root, "large-link"))
        await Bun.write(path.join(root, "tracked.ts"), "before\n")
        await git(root, "add", "tracked.ts")
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
        expect(yield* capture.read(frozen, "new", "large-link")).toBe(path.join(outside, "large"))
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

it.live(
  "uncommitted capture keeps ignored tracked/forced files, staged deletions and renames without touching the real index",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(async () => {
        await Bun.write(path.join(root, "tracked.ts"), "tracked\n")
        await Bun.write(path.join(root, "delete.ts"), "delete me\n")
        await Bun.write(path.join(root, "guide.md"), "rename source\n".repeat(40))
        await Bun.write(path.join(root, ".gitignore"), "ignored/\n")
        await Bun.write(path.join(root, "ignored/tracked.ts"), "tracked ignored\n")
        await git(root, "add", ".")
        await git(root, "add", "-f", "ignored/tracked.ts")
        await git(root, "commit", "-m", "fixture")
        await git(root, "rm", "delete.ts")
        await git(root, "mv", "guide.md", "manual.md")
        await Bun.write(path.join(root, "ignored/forced.ts"), "force staged\n")
        await git(root, "add", "-f", "ignored/forced.ts")
        await Bun.write(path.join(root, "ignored/forced.ts"), "force working\n")
        await Bun.write(path.join(root, "ignored/tracked.ts"), "ignored changed\n")
        await git(root, "update-index", "--split-index")
      })
      const original = yield* Effect.promise(() => Bun.file(path.join(root, ".git/index")).bytes())
      yield* Effect.gen(function* () {
        const capture = yield* CodeReviewCapture.Service
        const frozen = yield* capture.capture(root, { type: "uncommitted" })
        expect(frozen.files).toContainEqual(expect.objectContaining({ path: "delete.ts", status: "deleted" }))
        expect(frozen.files).toContainEqual(
          expect.objectContaining({ path: "manual.md", oldPath: "guide.md", status: "renamed" }),
        )
        expect(yield* capture.read(frozen, "new", "ignored/forced.ts")).toBe("force working\n")
        expect(yield* capture.read(frozen, "new", "ignored/tracked.ts")).toBe("ignored changed\n")
        expect(yield* capture.workspaceStatus(frozen)).toBe("current")
        expect(yield* Effect.promise(() => Bun.file(path.join(root, ".git/index")).bytes())).toEqual(original)
      }).pipe(Effect.provide(AppNodeBuilder.build(CodeReviewCapture.node)))
    }),
  20000,
)

it.live(
  "invalid finding paths are isolated and expected absent sides do not mark coverage missing",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(() => Bun.write(path.join(root, "new.ts"), "added\n"))
      yield* Effect.gen(function* () {
        const capture = yield* CodeReviewCapture.Service
        const frozen = yield* capture.capture(root, { type: "uncommitted" })
        expect(yield* capture.read(frozen, "old", "new.ts")).toBe("")
        const finding = {
          priority: "P1" as const,
          title: "finding",
          explanation: "problem",
          confidence: 0.9,
          path: "./new.ts",
          side: "new" as const,
          startLine: 1,
          endLine: 1,
        }
        const result = yield* CodeReviewResult.validate(frozen, {
          summary: "review",
          assessment: "issues_found",
          findings: [
            finding,
            { ...finding, title: "absolute", path: path.join(root, "new.ts") },
            { ...finding, path: "/outside/escape.ts" },
          ],
        })
        expect(result.findings).toHaveLength(2)
        expect(result.findings.every((item) => item.path === "new.ts")).toBe(true)
        expect(result.coverage.invalidLocations).toBe(1)
        expect(result.coverage.exclusions).toContainEqual({
          path: "/outside/escape.ts",
          reason: "invalid_finding_path",
        })
      }).pipe(Effect.provide(AppNodeBuilder.build(CodeReviewCapture.node)))
    }),
  20000,
)

it.live(
  "wildcard-like filenames keep per-file patches and outside-hunk anchors literal",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      const files = ["[id].tsx", "i.tsx", "star*.ts", "star-other.ts"]
      const content = Array.from({ length: 40 }, (_, index) => `line ${index + 1}\n`).join("")
      yield* Effect.promise(async () => {
        await Promise.all(files.map((file) => Bun.write(path.join(root, file), content)))
        await git(root, "add", ".")
        await git(root, "commit", "-m", "literal paths")
        await Promise.all(
          files.map((file, index) =>
            Bun.write(
              path.join(root, file),
              content.replace(index % 2 ? "line 28\n" : "line 1\n", `changed ${file}\n`),
            ),
          ),
        )
      })
      yield* Effect.gen(function* () {
        const capture = yield* CodeReviewCapture.Service
        const frozen = yield* capture.capture(root, { type: "uncommitted" })
        expect(frozen.files.find((file) => file.path === "[id].tsx")?.patch).not.toContain("a/i.tsx")
        expect(frozen.files.find((file) => file.path === "star*.ts")?.patch).not.toContain("a/star-other.ts")
        const result = yield* CodeReviewResult.validate(frozen, {
          assessment: "issues_found",
          summary: "literal anchor",
          findings: [
            {
              path: "[id].tsx",
              side: "new",
              startLine: 28,
              endLine: 28,
              priority: "P2",
              title: "unchanged context",
              explanation: "outside changed hunk",
              confidence: 1,
            },
          ],
        })
        expect(result.findings[0]?.anchor).toMatchObject({
          type: "line",
          inHunk: false,
          snippet: { text: expect.stringContaining("line 28") },
        })
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
  "review admission rejects unavailable models and ID reuse in another Session",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const reviews = yield* SessionCodeReview.Service
        const parent = yield* sessions.create(f.create)
        const invalid = yield* reviews
          .start(parent.id, {
            target: { type: "uncommitted" },
            model: { providerID: ProviderV2.ID.make("nope"), id: ModelV2.ID.make("nope") },
          })
          .pipe(Effect.result)
        expect(invalid._tag).toBe("Failure")
        if (invalid._tag === "Failure")
          expect(invalid.failure).toMatchObject({ code: "invalid", message: "Model unavailable: nope/nope" })
        expect((yield* reviews.list(parent.id)).data).toHaveLength(0)
        expect(yield* f.llm.calls).toBe(0)
        const invalidAgent = yield* reviews
          .start(parent.id, {
            target: { type: "uncommitted" },
            agent: "missing-review-agent",
          })
          .pipe(Effect.result)
        expect(invalidAgent._tag).toBe("Failure")
        if (invalidAgent._tag === "Failure")
          expect(invalidAgent.failure).toMatchObject({
            code: "invalid",
            message: "Agent unavailable: missing-review-agent",
          })
        expect((yield* reviews.list(parent.id)).data).toHaveLength(0)
        expect(yield* f.llm.calls).toBe(0)
        yield* f.llm.text(clean, { usage: { input: 2, output: 1 } })
        const first = yield* reviews.start(parent.id, { target: { type: "uncommitted" } })
        const other = yield* sessions.create(f.create)
        const conflict = yield* reviews.start(other.id, { ...first.input, id: first.id }).pipe(Effect.result)
        expect(conflict._tag).toBe("Failure")
        if (conflict._tag === "Failure") expect(conflict.failure.code).toBe("conflict")
        yield* pollWithTimeout(
          reviews.get(parent.id, first.id).pipe(Effect.map((run) => (CodeReview.terminal(run) ? run : undefined))),
          "review did not finish",
          "15 seconds",
        )
      }).pipe(Effect.provide(f.app))
    }),
  25000,
)

it.live(
  "a review runs while its parent provider turn is held, and provider failures retain their explanation",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      const gate = Promise.withResolvers<void>()
      yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const reviews = yield* SessionCodeReview.Service
        const execution = yield* SessionExecution.Service
        const parent = yield* sessions.create(f.create)
        yield* f.llm.hold("parent held", gate.promise)
        yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "hold this parent turn" } })
        yield* f.llm.wait(1)
        yield* f.llm.text(clean, { usage: { input: 2, output: 1 } })
        const admitted = yield* reviews.start(parent.id, { target: { type: "uncommitted" } })
        const done = yield* pollWithTimeout(
          reviews.get(parent.id, admitted.id).pipe(Effect.map((run) => (CodeReview.terminal(run) ? run : undefined))),
          "review must not wait for the held parent",
          "8 seconds",
        )
        expect(done.status).toBe("completed")
        expect(yield* f.llm.calls).toBe(2)
        expect((yield* execution.active).has(parent.id)).toBe(true)
        gate.resolve()
        yield* execution.wait(parent.id)
        yield* f.llm.error(400, { error: { message: "review invalid model request" } })
        const rejected = yield* reviews.start(parent.id, { target: { type: "uncommitted" } })
        const failed = yield* pollWithTimeout(
          reviews.get(parent.id, rejected.id).pipe(Effect.map((run) => (CodeReview.terminal(run) ? run : undefined))),
          "provider failure did not settle",
          "10 seconds",
        )
        expect(failed.status).toBe("failed")
        expect(failed.error).toContain("400")
        expect(failed.error).toContain("review invalid model request")
      }).pipe(Effect.provide(f.app))
    }),
  30000,
)

it.live(
  "review history uses admission time instead of caller-supplied IDs, and plain reads do not compare the workspace",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const reviews = yield* SessionCodeReview.Service
        const parent = yield* sessions.create(f.create)
        yield* f.llm.text(clean, { usage: { input: 2, output: 1 } })
        const older = yield* reviews.start(parent.id, {
          id: CodeReview.ID.make("rev_zzzz"),
          target: { type: "uncommitted" },
        })
        yield* pollWithTimeout(
          reviews.get(parent.id, older.id).pipe(Effect.map((run) => (CodeReview.terminal(run) ? run : undefined))),
          "first review did not finish",
          "10 seconds",
        )
        yield* f.llm.text(clean, { usage: { input: 2, output: 1 } })
        const newer = yield* reviews.start(parent.id, {
          id: CodeReview.ID.make("rev_aaaa"),
          target: { type: "commit", ref: "HEAD" },
        })
        yield* pollWithTimeout(
          reviews.get(parent.id, newer.id).pipe(Effect.map((run) => (CodeReview.terminal(run) ? run : undefined))),
          "second review did not finish",
          "10 seconds",
        )
        const page = yield* reviews.list(parent.id, undefined, 1)
        expect(page.data.map((run) => run.id)).toEqual([newer.id])
        expect(page.hasMore).toBe(true)
        expect((yield* reviews.list(parent.id, newer.id, 1)).data.map((run) => run.id)).toEqual([older.id])
        expect((yield* reviews.detail(parent.id, older.id)).workspaceStatus).toBeUndefined()
        expect((yield* reviews.detail(parent.id, newer.id, true)).workspaceStatus).toBe("not_applicable")
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
        const deadOwner = yield* Effect.promise(async () => {
          const child = Bun.spawn(
            [
              process.execPath,
              "-e",
              "process.stdout.write(JSON.stringify({pid:process.pid,token:'exited-review-owner'}))",
            ],
            { stdout: "pipe" },
          )
          const owner = await new Response(child.stdout).text()
          await child.exited
          return owner
        })
        yield* database.db
          .update(SessionCodeReviewTable)
          .set({
            data: { ...done, status: "running", result: undefined },
            execution_owner: JSON.stringify({ pid: process.pid, token: "another-live-review-owner" }),
          })
          .where(eq(SessionCodeReviewTable.id, done.id))
          .run()
        return { done, deadOwner }
      }).pipe(Effect.provide(f.app))
      yield* Effect.gen(function* () {
        const reviews = yield* SessionCodeReview.Service
        const database = yield* Database.Service
        expect((yield* reviews.get(run.done.sessionID, run.done.id)).status).toBe("running")
        yield* database.db
          .update(SessionCodeReviewTable)
          .set({ execution_owner: run.deadOwner })
          .where(eq(SessionCodeReviewTable.id, run.done.id))
          .run()
      }).pipe(Effect.provide(f.app))
      yield* Effect.gen(function* () {
        const reviews = yield* SessionCodeReview.Service
        const recovered = yield* reviews.get(run.done.sessionID, run.done.id)
        expect(recovered.status).toBe("interrupted")
        expect(recovered.captured).toEqual(run.done.captured)
        expect((yield* reviews.start(run.done.sessionID, run.done.input)).status).toBe("interrupted")
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
