import { LSP } from "@apexo/core/lsp"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const LspHandler = HttpApiBuilder.group(Api, "server.lsp", (handlers) =>
  handlers.handle("lsp.status", () =>
    Effect.gen(function* () {
      const lsp = yield* LSP.Service
      return yield* lsp.status
    }),
  ),
)
