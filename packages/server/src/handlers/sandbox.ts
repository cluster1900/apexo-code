import { CommandSandbox } from "@apexo/core/command-sandbox"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const SandboxHandler = HttpApiBuilder.group(Api, "server.sandbox", (handlers) =>
  handlers.handle("sandbox.catalog", () =>
    Effect.gen(function* () {
      const sandbox = yield* CommandSandbox.Service
      return yield* sandbox.catalog
    }),
  ),
)
