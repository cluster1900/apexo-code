import { verifiedMigratedWorktreePaths } from "@apexo/core/app-directory"
import { Global } from "@apexo/core/global"
import { Location } from "@apexo/core/location"
import { AbsolutePath } from "@apexo/core/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const LocationHandler = HttpApiBuilder.group(Api, "server.location", (handlers) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    return handlers.handle(
      "location.get",
      Effect.fn(function* () {
        const location = yield* Location.Service
        const aliases = verifiedMigratedWorktreePaths(global.data, location.directory)
        return new Location.Details({
          directory: location.directory,
          workspaceID: location.workspaceID,
          project: location.project,
          ...(aliases.length > 1 ? { aliases: aliases.map((alias) => AbsolutePath.make(alias)) } : {}),
        })
      }),
    )
  }),
)
