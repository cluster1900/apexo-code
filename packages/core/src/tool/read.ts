export * as ReadTool from "./read"

import { ToolFailure } from "@apexo/llm"
import { Effect, Layer, Schema } from "effect"
import nodePath from "node:path"
import { CommandSandbox } from "../command-sandbox"
import { makeLocationNode } from "../effect/app-node"
import { FileSystem } from "../filesystem"
import { Image } from "../image"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { AbsolutePath } from "../schema"
import { ReadToolFileSystem } from "./read-filesystem"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "read"
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
const LocationInput = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "File or directory path to read. Relative paths resolve within the active Location.",
  }),
  filePath: Schema.optional(Schema.String).annotate({
    description: "Alternative parameter name for path.",
  }),
  offset: ReadToolFileSystem.PageInput.fields.offset.annotate({
    description: "The 1-based directory entry or text line offset to start reading from",
  }),
  limit: ReadToolFileSystem.PageInput.fields.limit.annotate({
    description: "The maximum number of directory entries or text lines to read",
  }),
})
export const Input = LocationInput
const Output = Schema.Union([FileSystem.Content, ReadToolFileSystem.TextPage, ReadToolFileSystem.ListPage])

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const reader = yield* ReadToolFileSystem.Service
    const mutation = yield* LocationMutation.Service
    const image = yield* Image.Service
    const permission = yield* PermissionV2.Service
    const sandbox = yield* CommandSandbox.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Read a text file or supported image, page through a large UTF-8 text file by line offset, or list a directory page. Relative paths resolve from the current location; absolute paths inside it are accepted, while external absolute paths require external_directory approval.",
          input: Input,
          output: Output,
          toModelOutput: ({ input, output }) => {
            if (!("encoding" in output) || output.encoding !== "base64" || !SUPPORTED_IMAGE_MIMES.has(output.mime))
              return []
            return [
              { type: "text", text: "Image read successfully" },
              { type: "file", data: output.content, mime: output.mime, name: input.path ?? input.filePath ?? "" },
            ]
          },
          execute: (input, context) => {
            return Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              }
              const path = input.path ?? input.filePath
              if (!path) return yield* new ToolFailure({ message: "path or filePath is required" })
              yield* sandbox.assertRead(context.sessionID, path, path)
              const target = yield* mutation.resolve({ path, kind: "directory" })
              const external = target.externalDirectory
              if (external)
                yield* permission.assert({
                  ...LocationMutation.externalDirectoryPermission(external),
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
              const resource = target.resource
              const absolute = AbsolutePath.make(target.canonical)
              yield* sandbox.assertRead(context.sessionID, target.canonical, path)
              const type = yield* reader.inspect(absolute)
              yield* permission.assert({
                action: name,
                resources: [resource],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              if (type === "directory") {
                const page = yield* reader.list(absolute, { offset: input.offset, limit: input.limit })
                const entries = yield* sandbox.filterReadable(context.sessionID, page.entries, (entry) =>
                  nodePath.resolve(absolute, entry.path),
                )
                return new ReadToolFileSystem.ListPage({ ...page, entries })
              }
              const content = yield* reader.read(absolute, resource, {
                offset: input.offset,
                limit: input.limit,
              })
              if ("encoding" in content && content.encoding === "base64" && SUPPORTED_IMAGE_MIMES.has(content.mime)) {
                return yield* image
                  .normalize(resource, { ...content, encoding: "base64" })
                  .pipe(Effect.catchTag("Image.ResizerUnavailableError", () => Effect.succeed(content)))
              }
              if ("encoding" in content && content.encoding === "base64")
                return yield* Effect.fail(new ReadToolFileSystem.BinaryFileError({ resource }))
              return content
            }).pipe(
              Effect.mapError((error) => {
                const message =
                  error instanceof ReadToolFileSystem.BinaryFileError ||
                  error instanceof ReadToolFileSystem.MediaIngestLimitError ||
                  error instanceof Image.DecodeError ||
                  error instanceof Image.SizeError
                    ? error.message
                    : `Unable to read ${input.path ?? input.filePath}`
                return new ToolFailure({ message })
              }),
            )
          },
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/read",
  layer,
  deps: [
    ToolRegistry.node,
    ReadToolFileSystem.node,
    LocationMutation.node,
    Image.node,
    PermissionV2.node,
    CommandSandbox.node,
  ],
})
