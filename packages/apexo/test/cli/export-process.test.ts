// Subprocess tests for `apexo export`: Markdown transcripts and Grok Build's never-overwrite output rule.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { cliIt } from "../lib/cli-process"

describe("apexo export (subprocess)", () => {
  cliIt.live(
    "exports a Markdown transcript to stdout or a new file and never overwrites one",
    ({ llm, apexo, home }) =>
      Effect.gen(function* () {
        yield* llm.text("the answer is four")
        // The test preload uses an in-memory database per process; export reads what `run` wrote, so share a file.
        // `run` resolves its project from PWD, so keep every invocation in the same project directory too.
        const env = { PWD: home, APEXO_DB: path.join(home, "apexo.db") }
        const run = yield* apexo.run("what is two plus two", { format: "json", env })
        apexo.expectExit(run, 0)
        const sessionID = apexo
          .parseJsonEvents(run.stdout)
          .map((event) => event.sessionID)
          .find((id): id is string => typeof id === "string")
        expect(sessionID).toStartWith("ses_")

        const markdown = yield* apexo.spawn(["export", sessionID!, "--format", "markdown"], { env })
        apexo.expectExit(markdown, 0)
        expect(markdown.stdout).toContain("## User")
        expect(markdown.stdout).toContain("what is two plus two")
        expect(markdown.stdout).toContain("the answer is four")

        const output = path.join(home, "transcript.md")
        const written = yield* apexo.spawn(["export", sessionID!, output, "--format", "markdown"], { env })
        apexo.expectExit(written, 0)
        const first = yield* Effect.promise(() => Bun.file(output).text())
        expect(first).toContain("the answer is four")

        const refused = yield* apexo.spawn(["export", sessionID!, output], { env })
        expect(refused.exitCode).toBe(1)
        expect(refused.stderr).toContain("already exists")
        expect(yield* Effect.promise(() => Bun.file(output).text())).toBe(first)
      }),
    90_000,
  )
})
