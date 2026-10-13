import { CommandV2 } from "@apexo/core/command"
import { PluginInternal } from "@apexo/core/plugin/internal"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const CommandHandler = HttpApiBuilder.group(Api, "server.command", (handlers) =>
  handlers.handle("command.list", () =>
    PluginInternal.Service.use((internal) =>
      internal.ready.pipe(Effect.andThen(response(CommandV2.Service.use((command) => command.list())))),
    ),
  ),
)
