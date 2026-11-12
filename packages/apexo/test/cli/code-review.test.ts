import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Effect, Schema } from "effect"
import { CodeReview } from "@apexo/schema/code-review"
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

cliIt.live(
  "structured review CLI captures locally, exports JSON, applies fail-on and cleans ephemeral Sessions",
  ({ llm, apexo, home }) =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        const run = async (...args: string[]) => {
          const proc = Bun.spawn(["git", ...args], { cwd: home, stdout: "ignore", stderr: "pipe" })
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
            providers: {
              test: {
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: llm.url,
                  settings: { apiKey: "fixture" },
                },
                models: {
                  "test-model": {
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                },
              },
            },
          }),
        )
      })
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
      const env = { APEXO_CONFIG_CONTENT: "", APEXO_DISABLE_PROJECT_CONFIG: "", GROK_MEMORY: "0" }
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
        { env },
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
        { env: { ...env, PWD: path.join(home, "stale-shell-directory") } },
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
      const server = yield* apexo.serve({ env })
      yield* llm.text(JSON.stringify({ summary: "Attached review", assessment: "no_findings", findings: [] }), {
        usage: { input: 4, output: 3 },
      })
      const attached = yield* apexo.spawn(
        [
          "review",
          "--attach",
          server.url,
          "--dir",
          home,
          "--model",
          testModelID,
          "--max-turns",
          "4",
          "--format",
          "json",
          "--ephemeral",
        ],
        { env },
      )
      apexo.expectExit(attached, 0)
      expect(Schema.decodeUnknownSync(CodeReview.Run)(JSON.parse(attached.stdout.trim())).result?.summary).toBe(
        "Attached review",
      )
      expect(yield* llm.calls).toBe(3)
    }),
  60000,
)
