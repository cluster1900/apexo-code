/**
 * Model-facing V2 file-write leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as WriteTool from "./write"

import { ToolFailure } from "@apexo/llm"
import { Effect, Layer, Schema } from "effect"
import { CommandSandbox } from "../command-sandbox"
import { makeLocationNode } from "../effect/app-node"
import { FileMutation } from "../file-mutation"
import { LocationMutation } from "../location-mutation"
import { LSP } from "../lsp"
import { LspDiagnostics } from "../lsp-diagnostics"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "write"

export const Input = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description:
      "File path to write. Relative paths resolve within the active Location. Absolute paths inside that Location are accepted; external absolute paths require external_directory approval.",
  }),
  filePath: Schema.optional(Schema.String).annotate({
    description: "Alternative parameter name for path.",
  }),
  content: Schema.String.annotate({ description: "Content to write to the file" }),
})

export const Output = Schema.Struct({
  operation: Schema.Literal("write"),
  target: Schema.String,
  resource: Schema.String,
  existed: Schema.Boolean,
  /** Grok Build `<lsp-diagnostics>` summary from running language servers, model-facing only. */
  diagnostics: Schema.optional(Schema.String),
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) =>
  LspDiagnostics.withReminder(
    `${output.existed ? "Wrote" : "Created"} file successfully: ${output.resource}`,
    output.diagnostics,
  )

/** Deferred V2 write UX integrations remain visible at the model-facing seam. */
// No formatter runs after native edits: Grok Build has none either (search_replace/apply_patch only notify LSP).
// TODO: Publish watcher/file-edit events after V2 watcher integration exists.
// TODO: Add snapshots / undo after design exists.

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const permission = yield* PermissionV2.Service
    const sandbox = yield* CommandSandbox.Service
    const lsp = yield* LSP.Service

    yield* tools
      .register({
        [name]: Tool.withPermission(
          Tool.make({
            description:
              "Write content to one file. Relative paths resolve within the active Location. Absolute paths inside the Location are accepted. Explicit external absolute paths require external_directory approval before edit approval.",
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
            execute: (input, context) =>
              Effect.gen(function* () {
                const source = {
                  type: "tool" as const,
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                }
                const path = input.path ?? input.filePath
                if (!path) return yield* new ToolFailure({ message: "path or filePath is required" })
                yield* sandbox.assertWrite(context.sessionID, path, path)
                const target = yield* mutation.resolve({ path, kind: "file" })
                const external = target.externalDirectory
                if (external)
                  yield* permission.assert({
                    ...LocationMutation.externalDirectoryPermission(external),
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source,
                  })
                yield* permission.assert({
                  action: "edit",
                  resources: [target.resource],
                  save: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
                yield* sandbox.assertWrite(context.sessionID, target.canonical, path)
                const written = yield* files.writeTextPreservingBom({ target, content: input.content })
                const diagnostics = yield* lsp.diagnose([
                  { file: target.canonical, text: input.content.replace(/^\uFEFF/, "") },
                ])
                return { ...written, ...(diagnostics ? { diagnostics } : {}) } satisfies Output
              }).pipe(
                Effect.mapError(() => new ToolFailure({ message: `Unable to write ${input.path ?? input.filePath}` })),
              ),
          }),
          "edit",
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/write",
  layer,
  deps: [ToolRegistry.node, LocationMutation.node, FileMutation.node, PermissionV2.node, CommandSandbox.node, LSP.node],
})
