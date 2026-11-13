import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { buildReviewPrompt } from "@/cli/cmd/review"
import {
  appendOutputSchemaPrompt,
  loadOutputSchema,
  parseStructuredText,
  validateRunOutputOptions,
  writeLastMessage,
} from "@/cli/run-output-options"
import { cliIt, testModelID } from "../lib/cli-process"

describe("run-output-options unit contracts", () => {
  test("validates incompatible interactive and session flags", () => {
    expect(() => validateRunOutputOptions({ interactive: true, outputSchema: "schema.json" })).toThrow(
      "--output-schema cannot be used in interactive mode",
    )
    expect(() => validateRunOutputOptions({ interactive: true, outputLastMessage: "out.txt" })).toThrow(
      "--output-last-message cannot be used in interactive mode",
    )
    expect(() => validateRunOutputOptions({ interactive: true, ephemeral: true })).toThrow(
      "--ephemeral cannot be used in interactive mode",
    )
    expect(() => validateRunOutputOptions({ command: "review", outputSchema: "schema.json" })).toThrow(
      "--output-schema cannot be used with --command",
    )
    expect(() => validateRunOutputOptions({ ephemeral: true, session: "ses_123" })).toThrow(
      "--ephemeral cannot be used with --session, --continue, --fork, or --input-id",
    )
    expect(() => validateRunOutputOptions({ ephemeral: true, continue: true })).toThrow(
      "--ephemeral cannot be used with --session, --continue, --fork, or --input-id",
    )
    expect(() =>
      validateRunOutputOptions({
        interactive: false,
        ephemeral: true,
        outputSchema: "schema.json",
        outputLastMessage: "out.json",
      }),
    ).not.toThrow()
  })

  test("loads JSON Schema files, parses raw and fenced JSON, and writes nested output files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "apexo-run-opts-"))
    try {
      const schemaFile = path.join(dir, "verdict.schema.json")
      await Bun.write(
        schemaFile,
        JSON.stringify({
          type: "object",
          properties: {
            approved: { type: "boolean" },
            findings: { type: "array", items: { type: "string" } },
          },
          required: ["approved", "findings"],
          additionalProperties: false,
        }),
      )

      const spec = await loadOutputSchema("verdict.schema.json", dir)
      expect(appendOutputSchemaPrompt("Check this PR", spec.rawText)).toContain("<output_schema_contract>")

      const direct = parseStructuredText('{"approved":true,"findings":[]}', spec)
      expect(direct).toEqual({ ok: true, value: { approved: true, findings: [] } })

      const fenced = parseStructuredText('```json\n{"approved":false,"findings":["null deref"]}\n```', spec)
      expect(fenced).toEqual({ ok: true, value: { approved: false, findings: ["null deref"] } })

      const invalid = parseStructuredText('{"approved":"yes"}', spec)
      expect(invalid.ok).toBe(false)

      const nestedOut = path.join(dir, "nested", "reports", "last.txt")
      await writeLastMessage(nestedOut, "final summary\n")
      expect(await Bun.file(nestedOut).text()).toBe("final summary\n")

      await expect(loadOutputSchema("missing.json", dir)).rejects.toThrow("Output schema file not found")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("apexo review prompt construction", () => {
  test("builds target-specific read-only prompts and rejects conflicting target flags", () => {
    const def = buildReviewPrompt({})
    expect(def).toContain("git status --short")
    expect(def).toContain("git diff --cached")
    expect(def).toContain("strictly read-only code review")

    const byBase = buildReviewPrompt({
      base: "main",
      title: "Add V2 Code Mode",
      prompt: "Focus on Effect scope cleanup",
    })
    expect(byBase).toContain("git merge-base main HEAD")
    expect(byBase).toContain("git diff main...HEAD")
    expect(byBase).toContain("Change title / context: Add V2 Code Mode")
    expect(byBase).toContain("Focus on Effect scope cleanup")

    const byCommit = buildReviewPrompt({ commit: "a1b2c3d" })
    expect(byCommit).toContain("git show --stat --patch a1b2c3d")

    const byPr = buildReviewPrompt({ pr: "128" })
    expect(byPr).toContain("gh pr view 128")
    expect(byPr).toContain("gh pr diff 128")

    expect(() => buildReviewPrompt({ uncommitted: true, base: "main" })).toThrow(
      "Specify at most one review target among --uncommitted, --base, --commit, and --pr",
    )
    expect(() => buildReviewPrompt({ commit: "abc", pr: "12" })).toThrow(
      "Specify at most one review target among --uncommitted, --base, --commit, and --pr",
    )
    expect(() => buildReviewPrompt({ base: "   " })).toThrow("--base requires a non-empty branch or ref")
  })
})

describe("apexo run and apexo review CLI subprocess integration", () => {
  cliIt.live(
    "compatibility run enforces --output-schema, writes -o file, and deletes --ephemeral session",
    ({ llm, apexo, home }) =>
      Effect.gen(function* () {
        const schemaPath = path.join(home, "result.schema.json")
        const outPath = path.join(home, "out", "last.json")
        const dbPath = path.join(home, "compat-ephemeral.db")
        yield* Effect.promise(() =>
          Bun.write(
            schemaPath,
            JSON.stringify({
              type: "object",
              properties: {
                summary: { type: "string" },
                score: { type: "number" },
              },
              required: ["summary", "score"],
              additionalProperties: false,
            }),
          ),
        )

        yield* llm.tool("StructuredOutput", { summary: "clean pass", score: 99 })
        const result = yield* apexo.run("produce structured summary", {
          extraArgs: ["--output-schema", schemaPath, "-o", outPath, "--ephemeral"],
          env: { APEXO_DB: dbPath },
        })
        apexo.expectExit(result, 0)

        const written = JSON.parse(yield* Effect.promise(() => Bun.file(outPath).text()))
        expect(written).toEqual({ summary: "clean pass", score: 99 })
        expect(JSON.parse(result.stdout.trim())).toEqual({ summary: "clean pass", score: 99 })

        const sessions = yield* apexo.spawn(["session", "list", "--format", "json"], {
          env: { APEXO_DB: dbPath },
        })
        apexo.expectExit(sessions, 0)
        expect(JSON.parse(sessions.stdout)).toEqual([])
      }),
    60_000,
  )

  cliIt.live(
    "native headless run validates --output-schema, writes -o file, and removes --ephemeral session",
    ({ llm, apexo, home }) =>
      Effect.gen(function* () {
        const schemaPath = path.join(home, "native.schema.json")
        const badOutPath = path.join(home, "bad-out.json")
        const okOutPath = path.join(home, "ok-out.json")
        yield* Effect.promise(async () => {
          await Bun.write(
            path.join(home, "apexo.json"),
            JSON.stringify({
              providers: {
                test: {
                  api: {
                    type: "aisdk",
                    package: "@ai-sdk/openai-compatible",
                    url: llm.url,
                    settings: { apiKey: "test-key" },
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
          await Bun.write(
            schemaPath,
            JSON.stringify({
              type: "object",
              properties: {
                status: { type: "string" },
                count: { type: "number" },
              },
              required: ["status", "count"],
              additionalProperties: false,
            }),
          )
        })

        const nativeEnv = { APEXO_CONFIG_CONTENT: "", APEXO_DISABLE_PROJECT_CONFIG: "" }

        yield* llm.text('{"status":"missing-count"}')
        const invalidRun = yield* apexo.run("emit invalid json", {
          extraArgs: [
            "--dir",
            home,
            "--session-protocol",
            "native",
            "--output-schema",
            schemaPath,
            "-o",
            badOutPath,
            "--ephemeral",
          ],
          env: nativeEnv,
        })
        apexo.expectExit(invalidRun, 1)
        expect(invalidRun.stderr).toContain("did not conform to JSON Schema")
        expect(yield* Effect.promise(() => Bun.file(badOutPath).exists())).toBe(false)

        yield* llm.text('{"status":"ok","count":3}')
        const validRun = yield* apexo.run("emit valid json", {
          extraArgs: [
            "--dir",
            home,
            "--session-protocol",
            "native",
            "--output-schema",
            schemaPath,
            "-o",
            okOutPath,
            "--ephemeral",
          ],
          env: nativeEnv,
        })
        apexo.expectExit(validRun, 0)
        expect(JSON.parse(yield* Effect.promise(() => Bun.file(okOutPath).text()))).toEqual({
          status: "ok",
          count: 3,
        })

        const continued = yield* apexo.run("should have no session to continue", {
          extraArgs: ["--dir", home, "--session-protocol", "native", "--continue"],
          env: nativeEnv,
        })
        apexo.expectExit(continued, 1)
        expect(continued.stderr).toContain("No native Session is available to continue")
      }),
    60_000,
  )

  cliIt.live(
    "compatibility apexo review preserves target prompts, plain-text export and ephemeral cleanup",
    ({ llm, apexo, home }) =>
      Effect.gen(function* () {
        const reportPath = path.join(home, "review-report.md")
        const dbPath = path.join(home, "review.db")
        yield* llm.text("No blocking defects found in diff.")

        const result = yield* apexo.spawn(
          [
            "review",
            "--session-protocol",
            "compatibility",
            "--model",
            testModelID,
            "--base",
            "main",
            "--title",
            "Implement V2 CodeMode",
            "-o",
            reportPath,
            "--ephemeral",
            "Verify fiber interruption safety",
          ],
          { env: { APEXO_DB: dbPath } },
        )
        apexo.expectExit(result, 0)
        expect((yield* Effect.promise(() => Bun.file(reportPath).text())).trim()).toBe(
          "No blocking defects found in diff.",
        )

        const hits = yield* llm.hits
        expect(hits).toHaveLength(1)
        const serializedRequest = JSON.stringify(hits[0]?.body ?? {})
        expect(serializedRequest).toContain("git diff main...HEAD")
        expect(serializedRequest).toContain("Implement V2 CodeMode")
        expect(serializedRequest).toContain("Verify fiber interruption safety")

        const sessions = yield* apexo.spawn(["session", "list", "--format", "json"], {
          env: { APEXO_DB: dbPath },
        })
        apexo.expectExit(sessions, 0)
        expect(JSON.parse(sessions.stdout)).toEqual([])
      }),
    60_000,
  )
})
