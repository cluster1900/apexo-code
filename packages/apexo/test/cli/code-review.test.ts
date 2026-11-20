import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Effect, Schema } from "effect"
import { CodeReview } from "@apexo/schema/code-review"
import { Model } from "@apexo/schema/model"
import { codeReviewExitCode, formatCodeReview } from "@/cli/code-review-output"
import { reviewApiSupports } from "@/cli/native-code-review"
import { cliIt, testModelID } from "../lib/cli-process"

describe("native code review output", () => {
  test("detects API options before admission", () => {
    const document = {
      paths: {
        "/api/session/{sessionID}/review": {
          post: {
            requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Input" } } } },
          },
        },
      },
      components: { schemas: { Input: { properties: { target: {}, limits: {} } } } },
    }
    expect(reviewApiSupports(document, ["limits"])).toBe(true)
    expect(reviewApiSupports(document, ["model"])).toBe(false)
    expect(reviewApiSupports({})).toBe(false)
  })
})

const reviewEnv = { APEXO_CONFIG_CONTENT: "", APEXO_DISABLE_PROJECT_CONFIG: "", GROK_MEMORY: "0" }

cliIt.live(
  "structured review CLI validates model, agent and mode before admission",
  ({ llm, apexo, home }) =>
    Effect.gen(function* () {
      yield* prepareReviewProject(home, llm.url)
      const unavailable = yield* apexo.spawn(["review", "--model", "nope/nope", "--session-protocol", "native"], {
        env: reviewEnv,
      })
      apexo.expectExit(unavailable, 1)
      expect(unavailable.stderr + unavailable.stdout).toContain("Model unavailable: nope/nope")
      expect(yield* llm.calls).toBe(0)
      const invalidAgent = yield* apexo.spawn(["review", "--agent", "missing-review-agent"], { env: reviewEnv })
      apexo.expectExit(invalidAgent, 1)
      expect(invalidAgent.stderr + invalidAgent.stdout).toContain("Agent unavailable: missing-review-agent")
      expect(yield* llm.calls).toBe(0)
      const incompatible = yield* apexo.spawn(["review", "--session-protocol", "compatibility", "--fail-on", "P1"], {
        env: reviewEnv,
      })
      apexo.expectExit(incompatible, 1)
      expect(incompatible.stderr + incompatible.stdout).toContain("--session-protocol compatibility")
      expect(incompatible.stderr + incompatible.stdout).not.toContain("--output-schema")
    }),
  60000,
)

cliIt.live(
  "structured review CLI captures locally, exports JSON and applies fail-on",
  ({ llm, apexo, home }) =>
    Effect.gen(function* () {
      yield* prepareReviewProject(home, llm.url)
      yield* llm.text(
        JSON.stringify({
          summary: "One defect",
          assessment: "issues_found",
          findings: [
            {
              priority: "P1",
              title: "Broken behavior",
              explanation: "The changed value breaks its caller.",
              confidence: 0.9,
              path: "review.ts",
              side: "new",
              startLine: 1,
              endLine: 1,
            },
          ],
        }),
        { usage: { input: 4, output: 3 } },
      )
      const out = path.join(home, "report.json")
      const result = yield* apexo.spawn(
        [
          "review",
          "--dir",
          home,
          "--session-protocol",
          "native",
          "--model",
          testModelID,
          "--format",
          "json",
          "--fail-on",
          "P1",
          "--title",
          "TITLE_FIXTURE",
          "--ephemeral",
          "-o",
          out,
          "FOCUS_FIXTURE",
        ],
        { env: reviewEnv },
      )
      apexo.expectExit(result, 2)
      const run = Schema.decodeUnknownSync(CodeReview.Run)(JSON.parse(result.stdout.trim()))
      expect(run.status).toBe("completed")
      expect(run.result?.findings).toHaveLength(1)
      expect(JSON.parse(yield* Effect.promise(() => Bun.file(out).text()))).toEqual(JSON.parse(result.stdout.trim()))
      expect(codeReviewExitCode(run, "P0")).toBe(0)
      expect(codeReviewExitCode(run, "P1")).toBe(2)
      expect(formatCodeReview(run)).toContain("[P1] review.ts:1")
      expect(JSON.stringify((yield* llm.inputs)[0])).toContain("FOCUS_FIXTURE")
      expect(JSON.stringify((yield* llm.inputs)[0])).toContain("TITLE_FIXTURE")

      yield* llm.text(JSON.stringify({ summary: "No findings", assessment: "no_findings", findings: [] }), {
        usage: { input: 4, output: 3 },
      })
      const streamed = yield* apexo.spawn(
        ["review", "--model", testModelID, "--format", "streaming-json", "--ephemeral"],
        { env: { ...reviewEnv, PWD: path.join(home, "stale-shell-directory") } },
      )
      apexo.expectExit(streamed, 0)
      const events = streamed.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      expect(events[0].type).toBe("code_review.started")
      expect(events.at(-1).type).toBe("code_review.finished")
      expect(events.at(-1).run.result.assessment).toBe("no_findings")
      expect(yield* llm.calls).toBe(2)
    }),
  60000,
)

cliIt.live(
  "structured review CLI applies configured model, agent and variant selection",
  ({ llm, apexo, home }) =>
    Effect.gen(function* () {
      yield* prepareReviewProject(home, llm.url)
      for (const selection of [
        { args: [], model: "z-preferred", reviewer: true },
        { args: ["--variant", "careful"], model: "z-preferred", reviewer: true },
        { args: ["--model", testModelID, "--agent", "build"], model: "test-model", reviewer: false },
      ]) {
        yield* llm.text(JSON.stringify({ summary: "Selection check", assessment: "no_findings", findings: [] }), {
          usage: { input: 4, output: 3 },
        })
        const selected = yield* apexo.spawn(["review", ...selection.args, "--format", "json", "--ephemeral"], {
          env: reviewEnv,
        })
        apexo.expectExit(selected, 0, "review " + selection.args.join(" "))
        const report = Schema.decodeUnknownSync(CodeReview.Run)(JSON.parse(selected.stdout.trim()))
        expect(report.result?.model?.id).toBe(Model.ID.make(selection.model))
        const request = (yield* llm.inputs).at(-1)
        expect(request).toMatchObject({ model: selection.model })
        expect(JSON.stringify(request).includes("CONFIGURED_REVIEWER_SYSTEM")).toBe(selection.reviewer)
        if (selection.args.includes("careful")) {
          expect(report.result?.model?.variant).toBe(Model.VariantID.make("careful"))
          expect(request).toMatchObject({ review_fixture_variant: "careful" })
        }
      }
    }),
  60000,
)

cliIt.live(
  "structured review CLI attaches without API documents and removes the ephemeral Session",
  ({ llm, apexo, home }) =>
    Effect.gen(function* () {
      yield* prepareReviewProject(home, llm.url)
      const server = yield* apexo.serve({ env: reviewEnv })
      const requests: string[] = []
      const proxy = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch(request) {
              const url = new URL(request.url)
              requests.push(url.pathname)
              if (url.pathname === "/doc" || url.pathname === "/openapi.json")
                return new Response(null, { status: 503 })
              const upstream = new Request(new URL(url.pathname + url.search, server.url), request)
              upstream.headers.set("accept-encoding", "identity")
              return fetch(upstream)
            },
          }),
        ),
        (proxy) => Effect.promise(() => proxy.stop(true)),
      )
      yield* llm.text(JSON.stringify({ summary: "Attached review", assessment: "no_findings", findings: [] }), {
        usage: { input: 4, output: 3 },
      })
      const attached = yield* apexo.spawn(
        ["review", "--attach", proxy.url.origin, "--dir", home, "--max-turns", "4", "--format", "json", "--ephemeral"],
        { env: reviewEnv },
      )
      apexo.expectExit(attached, 0)
      const run = Schema.decodeUnknownSync(CodeReview.Run)(JSON.parse(attached.stdout))
      expect(run.result?.summary).toBe("Attached review")
      expect(run.result?.model?.id).toBe(Model.ID.make("z-preferred"))
      expect(JSON.stringify((yield* llm.inputs)[0])).toContain("CONFIGURED_REVIEWER_SYSTEM")
      expect(yield* llm.calls).toBe(1)
      expect(requests[0]).toBe("/api/review/capabilities")
      expect(requests).not.toContain("/doc")
      expect(requests).not.toContain("/openapi.json")
      const removed = yield* Effect.promise(() =>
        fetch(new URL("/api/session/" + run.sessionID, server.url), { signal: AbortSignal.timeout(5000) }),
      )
      expect(removed.status).toBe(404)
    }),
  60000,
)

function prepareReviewProject(home: string, providerUrl: string) {
  return Effect.promise(async () => {
    const run = async (...args: string[]) => {
      const proc = Bun.spawn(["git", "-c", "commit.gpgsign=false", ...args], {
        cwd: home,
        stdout: "ignore",
        stderr: "pipe",
      })
      const error = await new Response(proc.stderr).text()
      if ((await proc.exited) !== 0) throw new Error(error)
    }
    await run("init", "--initial-branch=main")
    await run("config", "user.name", "Fixture")
    await run("config", "user.email", "fixture@example.test")
    await Bun.write(path.join(home, ".gitignore"), "*\n!review.ts\n")
    await Bun.write(path.join(home, "review.ts"), "before\n")
    await run("add", "review.ts")
    await run("commit", "-m", "fixture")
    await Bun.write(path.join(home, "review.ts"), "after\n")
    await Bun.write(
      path.join(home, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        compaction: { auto: false },
        model: "test/z-preferred",
        default_agent: "reviewer",
        agents: { reviewer: { mode: "primary", system: "CONFIGURED_REVIEWER_SYSTEM" } },
        providers: {
          test: {
            api: {
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: providerUrl,
              settings: { apiKey: "fixture" },
            },
            models: {
              "test-model": {
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 100000, output: 4096 },
              },
              "z-preferred": {
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 100000, output: 4096 },
                variants: [{ id: "careful", body: { review_fixture_variant: "careful" } }],
              },
            },
          },
        },
      }),
    )
  })
}
