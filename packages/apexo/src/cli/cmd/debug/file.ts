import { EOL } from "os"
import path from "node:path"
import { Cause, Effect } from "effect"
import { FileSystem } from "@apexo/core/filesystem"
import { LocationServiceMap, locationServiceMapLayer } from "@apexo/core/location-services"
import { Location } from "@apexo/core/location"
import { AbsolutePath, RelativePath } from "@apexo/core/schema"
import { effectCmd, fail } from "../../effect-cmd"
import { cmd } from "../cmd"
import { errorMessage } from "@/util/error"

const filesystem = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) }))),
    Effect.provide(locationServiceMapLayer),
  )

const resolveWorkspaceRelativePath = Effect.fnUntraced(function* (rawPath: string) {
  const cwd = process.cwd()
  const resolved = path.resolve(cwd, rawPath)
  const rel = path.relative(cwd, resolved)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    const exists = yield* Effect.promise(() => Bun.file(resolved).exists())
    return yield* fail(
      exists
        ? `Path is outside the current workspace (${cwd}): ${rawPath}`
        : `File not found: ${rawPath} (and path is outside the current workspace ${cwd})`,
    )
  }
  return RelativePath.make(rel || ".")
})

const FileSearchCommand = effectCmd({
  command: "search <query>",
  describe: "search files by query",
  builder: (yargs) =>
    yargs.positional("query", {
      type: "string",
      demandOption: true,
      description: "Search query",
    }),
  handler: Effect.fn("Cli.debug.file.search")(function* (args) {
    const results = yield* filesystem(FileSystem.Service.use((svc) => svc.find({ query: args.query }))).pipe(
      Effect.catchCause((cause) => fail(errorMessage(Cause.squash(cause)))),
    )
    process.stdout.write(results.map((item) => item.path).join(EOL) + EOL)
  }),
})

const FileReadCommand = effectCmd({
  command: "read <path>",
  describe: "read file contents as JSON",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "File path to read",
    }),
  handler: Effect.fn("Cli.debug.file.read")(function* (args) {
    const relPath = yield* resolveWorkspaceRelativePath(args.path)
    const file = yield* filesystem(FileSystem.Service.use((svc) => svc.read({ path: relPath }))).pipe(
      Effect.catchCause((cause) => fail(errorMessage(Cause.squash(cause)))),
    )
    const isText =
      file.mime.startsWith("text/") ||
      file.mime.includes("json") ||
      file.mime.includes("xml") ||
      file.mime.includes("javascript") ||
      file.mime.includes("typescript")
    process.stdout.write(
      JSON.stringify(
        isText
          ? { content: Buffer.from(file.content).toString("utf8"), encoding: "utf8", mime: file.mime }
          : { content: Buffer.from(file.content).toString("base64"), encoding: "base64", mime: file.mime },
        null,
        2,
      ) + EOL,
    )
  }),
})

const FileListCommand = effectCmd({
  command: "list <path>",
  describe: "list files in a directory",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "File path to list",
    }),
  handler: Effect.fn("Cli.debug.file.list")(function* (args) {
    const relPath = yield* resolveWorkspaceRelativePath(args.path)
    const files = yield* filesystem(FileSystem.Service.use((svc) => svc.list({ path: relPath }))).pipe(
      Effect.catchCause((cause) => fail(errorMessage(Cause.squash(cause)))),
    )
    process.stdout.write(JSON.stringify(files, null, 2) + EOL)
  }),
})

export const FileCommand = cmd({
  command: "file",
  describe: "file system debugging utilities",
  builder: (yargs) =>
    yargs.command(FileReadCommand).command(FileListCommand).command(FileSearchCommand).demandCommand(),
  async handler() {},
})
