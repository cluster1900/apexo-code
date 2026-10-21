import { FileSystem } from "@apexo/core/filesystem"
import { RelativePath } from "@apexo/core/schema"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const FileSystemHandler = HttpApiBuilder.group(Api, "server.fs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handleRaw("fs.read", (ctx) =>
        Effect.gen(function* () {
          const url = new URL(ctx.request.url, "http://localhost")
          const rawPath = decodeURIComponent(url.pathname.slice(13))
          const resolvedPath = !rawPath || rawPath === "*" ? (url.searchParams.get("path") ?? "") : rawPath
          const fs = yield* FileSystem.Service
          const file = yield* fs.read({
            path: RelativePath.make(resolvedPath),
          })
          return HttpServerResponse.uint8Array(file.content, { contentType: file.mime })
        }),
      )
      .handle("fs.list", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.list(ctx.query)
          }),
        ),
      )
      .handle("fs.find", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.find(ctx.query)
          }),
        ),
      )
  }),
)
