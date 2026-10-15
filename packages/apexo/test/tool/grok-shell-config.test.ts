import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { BackgroundJob } from "@apexo/core/background-job"
import { ConfigToolset } from "@apexo/core/config/toolset"
import { GrokBuildTools } from "@/tool/grok-build"
import { ToolJsonSchema } from "@/tool/json-schema"
import { MessageID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const cases: {
  name: string
  config: ConfigToolset.Bash
  input?: number
  wait: number
  default: number
  max: number
}[] = [
  { name: "configured default", config: { default_block_until_ms: 45 }, wait: 45, default: 45, max: 36_000_000 },
  {
    name: "default capped",
    config: { default_block_until_ms: 500, max_block_until_ms: 60 },
    wait: 60,
    default: 60,
    max: 60,
  },
  { name: "explicit capped", config: { max_block_until_ms: 60 }, input: 500, wait: 60, default: 60, max: 60 },
  { name: "seconds cap", config: { max_timeout_secs: 0.08 }, input: 500, wait: 80, default: 80, max: 80 },
  {
    name: "lower cap wins",
    config: { max_timeout_secs: 0.03, max_block_until_ms: 60 },
    wait: 30,
    default: 30,
    max: 30,
  },
  { name: "zero default", config: { default_block_until_ms: 0, max_timeout_secs: 0.03 }, wait: 0, default: 0, max: 30 },
  { name: "explicit zero", config: { max_block_until_ms: 60 }, input: 0, wait: 0, default: 60, max: 60 },
  {
    name: "zero caps ignored",
    config: { max_block_until_ms: 0, max_timeout_secs: 0 },
    input: 20,
    wait: 20,
    default: 30_000,
    max: 36_000_000,
  },
  {
    name: "negative seconds ignored",
    config: { max_timeout_secs: -1 },
    input: 20,
    wait: 20,
    default: 30_000,
    max: 36_000_000,
  },
  { name: "submillisecond minimum", config: { max_timeout_secs: 0.0004 }, wait: 1, default: 1, max: 1 },
  { name: "seconds rounding", config: { max_timeout_secs: 0.0015 }, wait: 2, default: 2, max: 2 },
  {
    name: "absolute ceiling",
    config: { default_block_until_ms: 90_000_000, max_block_until_ms: 90_000_000, max_timeout_secs: 90_000 },
    wait: 36_000_000,
    default: 36_000_000,
    max: 36_000_000,
  },
]

for (const item of cases) {
  it.effect(`Shell host configuration: ${item.name}`, () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.make
      const started = yield* Deferred.make<void>()
      const watched: string[] = []
      const executionArgs: unknown[] = []
      const tool = GrokBuildTools.adaptTools(
        [
          {
            id: "bash",
            description: "controlled process lifetime",
            parameters: Schema.Unknown,
            execute: (args) => {
              executionArgs.push(args)
              return Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
            },
          },
        ],
        { background: jobs, bash: item.config },
      )[0]!
      const schema = ToolJsonSchema.fromTool(tool)
      expect(schema.properties?.block_until_ms).toMatchObject({ maximum: item.max, minimum: 0 })
      expect(JSON.stringify(schema.properties?.block_until_ms)).toContain(`defaults to ${item.default}ms`)
      const execution = yield* tool
        .execute(
          {
            command: "controlled",
            description: item.name,
            ...(item.input === undefined ? {} : { block_until_ms: item.input }),
          },
          {
            sessionID: SessionID.make("ses_shell_config"),
            messageID: MessageID.ascending(),
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
            watchBackground: (id) =>
              Effect.sync(() => {
                watched.push(id)
              }),
          },
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(started)
      if (item.wait > 0) {
        yield* TestClock.adjust(item.wait - 1)
        expect(watched).toEqual([])
        yield* TestClock.adjust(1)
      }
      const result = yield* Fiber.join(execution)
      expect(result.metadata.background).toBe(true)
      expect(watched).toEqual([result.metadata.task_id])
      expect(executionArgs).toEqual([{ command: "controlled", timeout: 36_000_000 }])
      expect((yield* jobs.get(String(result.metadata.task_id)))?.status).toBe("running")
      yield* jobs.cancel(String(result.metadata.task_id))
    }),
  )
}

test("Shell host configuration rejects invalid wait values and non-finite seconds", () => {
  for (const input of [
    { default_block_until_ms: -1 },
    { max_block_until_ms: 1.5 },
    { max_timeout_secs: Infinity },
    { max_timeout_secs: NaN },
  ]) {
    expect(() => Schema.decodeUnknownSync(ConfigToolset.Bash)(input)).toThrow()
  }
})
