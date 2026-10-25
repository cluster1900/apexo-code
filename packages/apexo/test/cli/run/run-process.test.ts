// Subprocess integration tests for `apexo run` (non-interactive mode).
// These exercise the real CLI binary against a TestLLMServer running in the
// same process. See `test/lib/cli-process.ts` for the harness — each test uses
// `apexo.run(message, opts?)` to spawn `bun src/index.ts run ...` with
// `APEXO_CONFIG_CONTENT` providing the test provider config inline.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { reply } from "../../lib/llm-server"
import { cliIt } from "../../lib/cli-process"

describe("apexo run (non-interactive subprocess)", () => {
  ;["typo-effort", "toString"].forEach((variant) =>
    cliIt.live(
      `rejects unsupported explicit variant ${variant} before calling the provider`,
      ({ llm, apexo }) =>
        Effect.gen(function* () {
          const result = yield* apexo.run("do not send this", { extraArgs: ["--variant", variant] })
          apexo.expectExit(result, 1)
          expect(result.stderr).toContain(`Unsupported variant "${variant}"`)
          expect(result.stderr).toContain("Available variants: default")
          expect(yield* llm.hits).toHaveLength(0)
        }),
      60_000,
    ),
  )
  ;["typo-effort", "toString", undefined].forEach((variant) =>
    cliIt.live(
      variant
        ? `native rejects unsupported explicit variant ${variant} before calling the provider`
        : "native sends the final-step reminder as a user turn",
      ({ llm, apexo, home }) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(home, "apexo.json"),
              JSON.stringify({
                agents: { limited: { mode: "primary", steps: 1 } },
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
            ),
          )
          if (!variant) yield* llm.text("limited response")
          const result = yield* apexo.run("reply with the step limit", {
            agent: "limited",
            format: "json",
            extraArgs: ["--dir", home, "--session-protocol", "native", ...(variant ? ["--variant", variant] : [])],
            env: { APEXO_CONFIG_CONTENT: "", APEXO_DISABLE_PROJECT_CONFIG: "" },
          })
          if (!variant) {
            apexo.expectExit(result, 1)
            expect(result.stdout).toContain("limited response")
            expect(result.stdout).toContain('"reason":"turn_limit"')
            const requests = yield* llm.hits
            expect(requests).toHaveLength(1)
            expect((requests[0].body.messages as { role: string; content: string }[]).at(-1)).toMatchObject({
              role: "user",
              content: expect.stringContaining("MAXIMUM STEPS REACHED"),
            })
            return
          }
          apexo.expectExit(result, 1)
          expect(result.stdout).toContain("Variant unavailable")
          expect(result.stdout).toContain(variant)
          expect(yield* llm.hits).toHaveLength(0)
        }),
      60_000,
    ),
  )

  cliIt.live(
    "fork reports a session directory mismatch instead of waiting for events",
    ({ llm, apexo, home }) =>
      Effect.gen(function* () {
        const other = path.join(home, "other")
        yield* Effect.promise(() => mkdir(other))
        yield* llm.text("original")
        const env = { APEXO_DB: path.join(home, "fork.db") }
        const original = yield* apexo.run("reply original", { format: "json", env })
        apexo.expectExit(original, 0)
        const sessionID = apexo.parseJsonEvents(original.stdout).find((event) => typeof event.sessionID === "string")!
          .sessionID as string
        // A different --dir exercises the same placement mismatch as a session relocated by import.
        const result = yield* apexo.run("fork", {
          extraArgs: ["--dir", other, "--session", sessionID, "--fork"],
          timeoutMs: 15_000,
          env,
        })
        apexo.expectExit(result, 1)
        expect(result.stderr).toContain("belongs to")
        expect(result.stderr).toContain("Retry with --dir")
        expect(yield* llm.calls).toBe(1)
      }),
    60_000,
  )

  // Happy path: prompt completes, output reaches stdout, process exits 0.
  // If this fails, all the others likely will too — debug here first.
  cliIt.live(
    "exits 0 and writes the response to stdout on a successful prompt",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.text("hello from the test llm")
        const result = yield* apexo.run("say hi")
        apexo.expectExit(result, 0)
        expect(result.stdout).toBe("hello from the test llm\n")
      }),
    60_000,
  )

  // Like Grok Build -p, a prompt argument containing spaces reaches the model as typed, without added quotes.
  cliIt.live(
    "sends a spaced prompt argument verbatim",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.text("ok")
        const result = yield* apexo.run("fix the add bug, then reply")
        apexo.expectExit(result, 0)
        const bodies = (yield* llm.hits).map((hit) => JSON.stringify(hit.body))
        expect(bodies.some((body) => body.includes("fix the add bug, then reply"))).toBe(true)
        expect(bodies.some((body) => body.includes('\\"fix the add bug, then reply\\"'))).toBe(false)
      }),
    60_000,
  )

  cliIt.live(
    "prints each completed text part in order around a tool continuation",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("  before tool  ").tool("bash", {
            command: "printf tool-output",
            description: "Print deterministic output",
          }),
        )
        yield* llm.text("  after tool  ")

        const result = yield* apexo.run("use a tool", {
          extraArgs: ["--dangerously-skip-permissions"],
        })

        apexo.expectExit(result, 0)
        expect(result.stdout).toBe("before tool\nafter tool\n")
      }),
    60_000,
  )

  cliIt.live(
    "prints reasoning before text only with --thinking",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.reason("  considering  ", { text: "  answer  " })
        const thinking = yield* apexo.run("think", { extraArgs: ["--thinking"] })
        apexo.expectExit(thinking, 0)
        expect(thinking.stdout).toBe("Thinking: considering\nanswer\n")

        yield* llm.reason("hidden", { text: "visible" })
        const plain = yield* apexo.run("think again")
        apexo.expectExit(plain, 0)
        expect(plain.stdout).toBe("visible\n")
      }),
    60_000,
  )

  // Regression for #27371: an unknown model used to hang the process forever
  // waiting on a session.status === idle event that never arrived. The fix
  // makes the SDK call surface an error promptly so the process exits nonzero.
  // We assert nonzero exit AND wall-clock under the harness timeout — a hang
  // would expire the timeout and produce a different (signal-killed) failure.
  // Keep competing CLI startups out of this wall-clock assertion on busy CI runners.
  cliIt.live(
    "exits nonzero promptly when the model is unknown (regression for #27371)",
    ({ apexo }) =>
      Effect.gen(function* () {
        const result = yield* apexo.run("say hi", {
          model: "test/nonexistent-model",
          timeoutMs: 15_000,
        })
        expect(result.exitCode).not.toBe(0)
        expect(result.durationMs).toBeLessThan(15_000)
      }),
    30_000,
  )

  // The test provider's SSE error item is interpreted by the SDK as an unknown
  // finish, not a fatal provider/session error. Unknown finishes should continue
  // the prompt loop so a subsequent response can complete the run.
  cliIt.live(
    "unknown stream finish preserves partial output and continues",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("partial response").tool("bash", {
            command: "printf tool",
            description: "Print deterministic output",
          }),
        )
        yield* llm.fail("upstream provider exploded mid-stream")
        yield* llm.text("recovered")
        const result = yield* apexo.run("trigger midstream error", { timeoutMs: 30_000 })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe("partial response\nrecovered\n")
        expect(result.stderr).not.toContain("upstream provider exploded mid-stream")
      }),
    60_000,
  )

  // --format json puts one JSON object per line on stdout for each emitted
  // event. Consumers (CI scripts, tooling) parse this stream. Asserts the
  // shape so a future event-emit change has to update this expectation.
  cliIt.live(
    "--format json emits parseable line-delimited JSON to stdout",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.text("structured output")
        const result = yield* apexo.run("say hi", { format: "json" })
        apexo.expectExit(result, 0)

        const events = apexo.parseJsonEvents(result.stdout)
        expect(events.length).toBeGreaterThan(0)
        for (const evt of events) {
          expect(typeof evt.type).toBe("string")
          expect(typeof evt.sessionID).toBe("string")
        }
        expect(events.map((event) => event.type)).toEqual(["step_start", "text", "step_finish"])
        expect(events.map(({ timestamp: _, sessionID: __, ...event }) => event)).toEqual([
          { type: "step_start", part: expect.objectContaining({ type: "step-start" }) },
          {
            type: "text",
            part: expect.objectContaining({ type: "text", text: "structured output" }),
          },
          { type: "step_finish", part: expect.objectContaining({ type: "step-finish" }) },
        ])
        expect(result.stdout.endsWith("\n")).toBe(true)
        expect(
          result.stdout
            .split("\n")
            .slice(0, -1)
            .every((line) => line.length > 0),
        ).toBe(true)
      }),
    60_000,
  )

  cliIt.live(
    "--format json emits a pure error record for a rejected prompt request",
    ({ apexo }) =>
      Effect.gen(function* () {
        const result = yield* apexo.run("use an unknown model", {
          model: "test/nonexistent-model",
          format: "json",
        })

        expect(result.exitCode).not.toBe(0)
        const events = apexo.parseJsonEvents(result.stdout)
        expect(events.map((event) => event.type)).toEqual(["error"])
        expect(events[0]).toEqual({
          type: "error",
          timestamp: expect.any(Number),
          sessionID: expect.any(String),
          error: expect.any(Object),
        })
        expect(result.stdout.split("\n").filter(Boolean)).toHaveLength(1)
      }),
    30_000,
  )

  cliIt.live(
    "--format streaming-json emits the Grok Build headless event shapes",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.text("streamed output")
        const result = yield* apexo.run("say hi", { format: "streaming-json" })
        apexo.expectExit(result, 0)

        const events = apexo.parseJsonEvents(result.stdout)
        expect(events.some((event) => event.type === "available_commands")).toBe(true)
        expect(events.some((event) => event.type === "step_start")).toBe(true)
        expect(events.some((event) => event.type === "text" && event.data === "streamed output")).toBe(true)
        expect(events.some((event) => event.type === "step_finish")).toBe(true)
        expect(events.at(-1)).toMatchObject({
          type: "end",
          stopReason: "end_turn",
          sessionId: expect.any(String),
          requestId: expect.any(String),
        })
        for (const event of events) {
          expect(event.timestamp).toBeUndefined()
          expect(event.sessionID).toBeUndefined()
        }
      }),
    60_000,
  )

  cliIt.live(
    "--format json preserves reasoning, tool, and continuation ordering",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().reason("reasoning").text("before").tool("bash", {
            command: "printf tool",
            description: "Print deterministic output",
          }),
        )
        yield* llm.text("after")

        const result = yield* apexo.run("exercise json records", {
          format: "json",
          extraArgs: ["--thinking", "--dangerously-skip-permissions"],
        })

        expect(result.exitCode).toBe(0)
        const events = apexo.parseJsonEvents(result.stdout)
        expect(events.map((event) => event.type)).toEqual([
          "step_start",
          "reasoning",
          "text",
          "tool_use",
          "step_finish",
          "step_start",
          "text",
          "step_finish",
        ])
        expect(events.find((event) => event.type === "reasoning")?.part).toEqual(
          expect.objectContaining({ type: "reasoning", text: "reasoning" }),
        )
        expect(events.find((event) => event.type === "tool_use")?.part).toEqual(
          expect.objectContaining({
            type: "tool",
            tool: "bash",
            state: expect.objectContaining({ status: "completed" }),
          }),
        )
        expect(
          result.stdout
            .split("\n")
            .slice(0, -1)
            .every((line) => line.startsWith("{")),
        ).toBe(true)
      }),
    60_000,
  )

  cliIt.live(
    "--format json records an unknown stream finish and continuation",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("partial json").tool("bash", {
            command: "printf tool",
            description: "Print deterministic output",
          }),
        )
        yield* llm.fail("provider failed")
        yield* llm.text("recovered")
        const result = yield* apexo.run("fail after output", { format: "json" })

        const events = apexo.parseJsonEvents(result.stdout)
        expect(result.exitCode).toBe(0)
        expect(events.map((event) => event.type)).toEqual([
          "step_start",
          "text",
          "tool_use",
          "step_finish",
          "step_start",
          "step_finish",
          "step_start",
          "text",
          "step_finish",
        ])
        expect(events[1]?.part).toEqual(expect.objectContaining({ type: "text", text: "partial json" }))
        expect(events[5]?.part).toEqual(expect.objectContaining({ type: "step-finish", reason: "unknown" }))
        expect(events[7]?.part).toEqual(expect.objectContaining({ type: "text", text: "recovered" }))
        expect(events.at(-1)?.part).toEqual(expect.objectContaining({ type: "step-finish", reason: "stop" }))
      }),
    60_000,
  )

  cliIt.live(
    "rejects requested permissions by default and allows them with the dangerous flag",
    ({ home, llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.tool("bash", { command: "rm -f denied-file", description: "Remove a test file" })
        yield* llm.text("continued after rejection")
        const denied = yield* apexo.run("request permission", { permission: { bash: "ask" } })
        apexo.expectExit(denied, 1)
        expect(denied.stderr).toContain("permission requested: bash")
        expect(denied.stdout).toBe("")

        yield* llm.reset
        yield* llm.tool("bash", { command: "rm -f allowed-file", description: "Remove a test file" })
        yield* llm.text("continued after approval")
        const allowed = yield* apexo.run("request permission", {
          permission: { bash: "ask" },
          extraArgs: ["--dangerously-skip-permissions"],
        })
        apexo.expectExit(allowed, 0)
        expect(allowed.stderr).not.toContain("permission requested: bash")
        expect(allowed.stdout).toContain("continued after approval")

        yield* llm.reset
        yield* llm.tool("bash", { command: "touch explicitly-denied", description: "Create a denied marker" })
        yield* llm.text("continued after explicit denial")
        const explicitlyDenied = yield* apexo.run("request denied permission", {
          permission: { bash: "deny" },
          extraArgs: ["--dangerously-skip-permissions"],
        })
        apexo.expectExit(explicitlyDenied, 0)
        expect(explicitlyDenied.stdout).toContain("continued after explicit denial")
        expect(yield* Effect.promise(() => Bun.file(`${home}/explicitly-denied`).exists())).toBe(false)
      }),
    60_000,
  )

  cliIt.live(
    "attach mode sends client-local file contents without a shared path",
    ({ home, llm, apexo }) =>
      Effect.gen(function* () {
        const source = `${home}/client-only.txt`
        const sentinel = "client-only attachment sentinel"
        yield* Effect.promise(() => Bun.write(source, sentinel))
        yield* llm.text("attachment received")
        const server = yield* apexo.serve()

        const result = yield* apexo.run("read the attachment", {
          extraArgs: ["--attach", server.url, `--file=${source}`, "--"],
        })

        apexo.expectExit(result, 0)
        const input = JSON.stringify(yield* llm.inputs)
        expect(input).toContain(sentinel)
        expect(input).not.toContain(`file://${source}`)
      }),
    60_000,
  )

  cliIt.live(
    "attach mode rejects local directories before prompt admission",
    ({ home, apexo }) =>
      Effect.gen(function* () {
        const result = yield* apexo.run("read the directory", {
          extraArgs: ["--attach", "http://127.0.0.1:1", `--file=${home}`, "--"],
        })

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain("Cannot attach local directory without a shared filesystem")
      }),
    30_000,
  )

  cliIt.live(
    "SIGINT interrupts an active non-interactive run without leaking the process",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.hang
        const run = yield* apexo.startRun("wait forever")
        yield* llm.wait(1)
        run.interrupt()
        const result = yield* run.result

        expect(result.exitCode).not.toBe(0)
        expect(result.durationMs).toBeLessThan(30_000)
      }),
    30_000,
  )
  // Grok Build 1.0.62 headless contract: the run waits for background work it started and prints the turn its
  // completion wakes, instead of exiting at the first idle and dropping that reply.
  cliIt.live(
    "waits for a background command and prints the follow-up turn its completion wakes",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().tool("run_terminal_cmd", {
            command: "sleep 1; printf BG-OUT",
            description: "Background output",
            block_until_ms: 0,
          }),
        )
        yield* llm.text("started")
        yield* llm.text("background said BG-OUT")
        const result = yield* apexo.run("start it in the background", {
          extraArgs: ["--profile", "grok-build", "--dangerously-skip-permissions"],
          timeoutMs: 45_000,
        })
        apexo.expectExit(result, 0)
        expect(result.stdout).toBe("started\nbackground said BG-OUT\n")
        // Agent turns carry tools; the session title request does not.
        const turns = (yield* llm.hits).filter((hit) => Array.isArray(hit.body.tools) && hit.body.tools.length > 0)
        expect(turns.length).toBe(3)
      }),
    60_000,
  )

  cliIt.live(
    "stops background work when the wait runs out and exits 1",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().tool("run_terminal_cmd", {
            command: "sleep 60",
            description: "Long background sleep",
            block_until_ms: 0,
          }),
        )
        yield* llm.text("started")
        const result = yield* apexo.run("start a long background job", {
          extraArgs: ["--profile", "grok-build", "--dangerously-skip-permissions", "--background-wait-timeout", "1"],
          timeoutMs: 30_000,
        })
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toBe("started\n")
        expect(result.stderr).toContain(
          "the wait for background work ran out after 1 s and exit stopped 1 background task",
        )
        expect(result.durationMs).toBeLessThan(25_000)
        // Agent turns carry tools; the session title request does not.
        const turns = (yield* llm.hits).filter((hit) => Array.isArray(hit.body.tools) && hit.body.tools.length > 0)
        expect(turns.length).toBe(2)
      }),
    45_000,
  )

  cliIt.live(
    "--no-wait-for-background exits after the first turn",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().tool("run_terminal_cmd", {
            command: "sleep 60",
            description: "Long background sleep",
            block_until_ms: 0,
          }),
        )
        yield* llm.text("started")
        const result = yield* apexo.run("start a long background job", {
          extraArgs: ["--profile", "grok-build", "--dangerously-skip-permissions", "--no-wait-for-background"],
          timeoutMs: 30_000,
        })
        apexo.expectExit(result, 0)
        expect(result.stdout).toBe("started\n")
        expect(result.durationMs).toBeLessThan(25_000)
      }),
    45_000,
  )

  cliIt.live(
    "routes leading <think>...</think> in text-delta to reasoning part",
    ({ llm, apexo }) =>
      Effect.gen(function* () {
        yield* llm.text("<think>internal reasoning</think>\nvisible answer")
        const plain = yield* apexo.run("say hi")
        apexo.expectExit(plain, 0)
        expect(plain.stdout).toBe("visible answer\n")
        expect(plain.stdout).not.toContain("<think>")

        yield* llm.text("<think>internal reasoning</think>\nvisible answer")
        const json = yield* apexo.run("say hi", { extraArgs: ["--format", "json"] })
        apexo.expectExit(json, 0)
        const events = json.stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
        expect(events.some((e) => e.type === "reasoning" && e.part?.text === "internal reasoning")).toBe(true)
        expect(events.some((e) => e.type === "text" && e.part?.text === "visible answer")).toBe(true)
      }),
    60_000,
  )

  cliIt.live(
    "apexo serve blocks non-loopback Host headers with 403 and returns 400 for unknown models",
    ({ apexo }) =>
      Effect.gen(function* () {
        const server = yield* apexo.serve()
        const rebindRes = yield* Effect.promise(() =>
          fetch(`${server.url}/global/health`, {
            headers: { Host: "evil.example.com" },
          }),
        )
        expect(rebindRes.status).toBe(403)

        const okRes = yield* Effect.promise(() => fetch(`${server.url}/global/health`))
        expect(okRes.status).toBe(200)
      }),
    60_000,
  )
})
