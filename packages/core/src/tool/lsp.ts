export * as LspTool from "./lsp"

import { Effect, Layer, Schema } from "effect"
import { Lsp } from "@apexo/schema/lsp"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { LSP } from "../lsp"
import { ToolRegistry } from "./registry"
import { Tools } from "./tools"
import { Tool } from "./tool"

export const Input = Schema.Struct({
  operation: Lsp.Operation,
  filePath: Schema.optional(Schema.String).annotate({
    description: "File path relative to the active project, or an absolute path. Required except for workspaceSymbol.",
  }),
  line: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).annotate({
    description: "1-based line number; required for positional operations.",
  }),
  character: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).annotate({
    description: "1-based UTF-16 character offset; required for positional operations.",
  }),
  query: Schema.optional(Schema.String),
})
const Output = Schema.Struct({ result: Schema.Array(Schema.Unknown) })
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
export const node = makeLocationNode({
  name: "tool/lsp",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const tools = yield* Tools.Service
      const lsp = yield* LSP.Service
      const permission = yield* PermissionV2.Service
      const mutation = yield* LocationMutation.Service
      const fs = yield* FSUtil.Service
      yield* tools
        .register({
          lsp: Tool.make({
            description:
              "Query an active project language server for definitions, references, hover information, implementations, document symbols or workspace symbols. Positions use 1-based lines and UTF-16 character offsets. This tool is read-only, checks read and LSP permissions, and requires external_directory approval for external files. It does not install language servers or edit files.",
            input: Input,
            output: Output,
            toModelOutput: ({ input, output }) => [
              {
                type: "text",
                text: output.result.length
                  ? JSON.stringify(output.result, null, 2)
                  : `No results found for ${input.operation}`,
              },
            ],
            execute: (input, context) =>
              Effect.gen(function* () {
                const source = {
                  type: "tool" as const,
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                }
                const access = { sessionID: context.sessionID, agent: context.agent, source }
                const workspaceApprovals = new Set<string>()
                const assertWorkspace = Effect.fn("LspTool.assertWorkspace")(function* (
                  input: Pick<PermissionV2.AssertInput, "action" | "resources" | "save">,
                ) {
                  const inspect = yield* permission.inspect(context.sessionID, context.agent)
                  const current = inspect(input.action, input.resources)
                  const key = JSON.stringify([input.action, input.resources])
                  // Reuse only a one-time ask answered in this invocation. A new
                  // deny always wins; an allow changed to ask still asks afresh.
                  if (current === "ask" && workspaceApprovals.has(key)) return
                  yield* permission.assert({ ...access, ...input })
                  if (current === "ask") workspaceApprovals.add(key)
                })
                const authorizeWorkspace: LSP.AuthorizeWorkspace = (targets) =>
                  Effect.forEach(
                    targets,
                    (target) =>
                      Effect.gen(function* () {
                        if (target.externalDirectory)
                          yield* assertWorkspace({
                            ...LocationMutation.externalDirectoryPermission(target.externalDirectory),
                          })
                        yield* assertWorkspace({
                          action: "read",
                          resources: [target.resource],
                          save: ["*"],
                        })
                        yield* assertWorkspace({
                          action: "lsp",
                          resources: [target.resource],
                          save: ["*"],
                        })
                      }),
                    { discard: true },
                  ).pipe(
                    Effect.mapError(
                      () =>
                        new LSP.Failure({
                          code: "invalid",
                          message: "Language-server workspace access was not authorized",
                        }),
                    ),
                  )
                if (input.operation === "workspaceSymbol") {
                  yield* permission.assert({ ...access, action: "read", resources: ["*"], save: ["*"] })
                  yield* permission.assert({ ...access, action: "lsp", resources: ["*"], save: ["*"] })
                  return {
                    result: yield* lsp.execute({ operation: input.operation, query: input.query }, authorizeWorkspace),
                  }
                }
                if (!input.filePath)
                  return yield* new Tool.Failure({ message: "filePath is required for this LSP operation" })
                if (input.operation !== "documentSymbol" && (input.line === undefined || input.character === undefined))
                  return yield* new Tool.Failure({
                    message: "This LSP operation requires 1-based line and character positions",
                  })
                const target = yield* mutation.resolve({ path: input.filePath, kind: "file" })
                if (target.externalDirectory)
                  yield* permission.assert({
                    ...access,
                    ...LocationMutation.externalDirectoryPermission(target.externalDirectory),
                  })
                yield* permission.assert({ ...access, action: "read", resources: [target.resource], save: ["*"] })
                yield* permission.assert({ ...access, action: "lsp", resources: [target.resource], save: ["*"] })
                const info = yield* fs.stat(target.canonical)
                if (info.type !== "File")
                  return yield* new Tool.Failure({ message: "LSP document must be a regular file" })
                if (Number(info.size) > MAX_DOCUMENT_BYTES)
                  return yield* new Tool.Failure({ message: "LSP document exceeds the 2 MiB limit" })
                const bytes = yield* fs.readFile(target.canonical)
                if (bytes.byteLength > MAX_DOCUMENT_BYTES || bytes.includes(0))
                  return yield* new Tool.Failure({ message: "LSP document is too large or is binary" })
                const text = yield* Effect.try({
                  try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
                  catch: () => new Tool.Failure({ message: "LSP document is not valid UTF-8" }),
                })
                if (input.line !== undefined && input.character !== undefined) {
                  const lines = text.split(/\r\n|\r|\n/)
                  if (input.line > lines.length || input.character > (lines[input.line - 1]?.length ?? 0) + 1)
                    return yield* new Tool.Failure({ message: "LSP position is outside the document" })
                }
                return {
                  result: yield* lsp.execute(
                    {
                      operation: input.operation,
                      file: target.canonical,
                      text,
                      line: input.line === undefined ? undefined : input.line - 1,
                      character: input.character === undefined ? undefined : input.character - 1,
                      query: input.query,
                    },
                    authorizeWorkspace,
                  ),
                }
              }).pipe(
                Effect.mapError((error) =>
                  error instanceof Tool.Failure
                    ? error
                    : new Tool.Failure({
                        message:
                          error instanceof LSP.Failure ? error.message : "Unable to query this document with LSP",
                      }),
                ),
              ),
          }),
        })
        .pipe(Effect.orDie)
    }),
  ),
  deps: [ToolRegistry.node, LSP.node, PermissionV2.node, LocationMutation.node, FSUtil.node],
})
