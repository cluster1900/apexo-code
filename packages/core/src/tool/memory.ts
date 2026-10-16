export * as MemoryTools from "./memory"

import { ToolFailure } from "@apexo/llm"
import { Effect, Layer, Schema } from "effect"
import { NonNegativeInt } from "@apexo/schema/schema"
import { makeLocationNode } from "../effect/app-node"
import { MemoryNative } from "../memory-native"
import { Tools } from "./tools"
import { Tool } from "./tool"
import { ToolRegistry } from "./registry"

const optionalCount = Schema.optional(Schema.NullOr(NonNegativeInt))
const Result = Schema.Struct({ path: Schema.String, content: Schema.String })
const failure = (error: MemoryNative.Failure) => new ToolFailure({ message: error.message })
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const memory = yield* MemoryNative.Service
    yield* tools
      .register({
        memory: Tool.make({
          description:
            "Apexo Memory adaptation: read saved notes or remember a durable fact in the selected global/workspace scope. Requires enabled legacy Memory. This never extracts the transcript or starts a model request.",
          input: Schema.Struct({
            operation: Schema.Literals(["read", "remember"]),
            content: Schema.optional(Schema.String),
            scope: Schema.optional(Schema.Literals(["global", "workspace"])),
          }),
          output: Result,
          execute: (input, context) => memory.note(input, context).pipe(Effect.mapError(failure)),
        }),
        memory_search: Tool.make({
          description:
            "Search enabled legacy Memory for historical notes, not current instructions. Results contain paths and line ranges for memory_get.",
          input: Schema.Struct({
            query: Schema.String,
            max_results: optionalCount,
            min_score: Schema.optional(Schema.NullOr(Schema.Finite)),
          }),
          output: Schema.Struct({
            results: Schema.Array(
              Schema.Struct({
                path: Schema.String,
                source: Schema.Literals(["global", "workspace", "session"]),
                start_line: Schema.Number,
                end_line: Schema.Number,
                score: Schema.Number,
                snippet: Schema.String,
                staleness: Schema.optional(Schema.String),
              }),
            ),
            skipped: Schema.Array(Schema.String),
            mode: Schema.optional(Schema.Literals(["fts", "hybrid"])),
            fallback: Schema.optional(
              Schema.Literals([
                "unsupported_provider",
                "invalid_model",
                "unavailable_provider",
                "unauthorized",
                "invalid_endpoint",
                "transport",
                "malformed_response",
              ]),
            ),
          }),
          execute: (input, context) => memory.search(input, context).pipe(Effect.mapError(failure)),
        }),
        memory_get: Tool.make({
          description:
            "Read an enabled legacy Memory file within this Location's global/workspace roots. from is 1-based (0 means 1); omitted lines reads the remaining file.",
          input: Schema.Struct({ path: Schema.String, from: optionalCount, lines: optionalCount }),
          output: Schema.Struct({ ...Result.fields, from: Schema.Number, lines: Schema.Number }),
          execute: (input, context) => memory.get(input, context).pipe(Effect.mapError(failure)),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
export const node = makeLocationNode({ name: "tool/memory", layer, deps: [ToolRegistry.node, MemoryNative.node] })
