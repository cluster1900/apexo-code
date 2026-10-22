import { CommandV2 } from "@apexo/core/command"
import { PluginInternal } from "@apexo/core/plugin/internal"
import { SkillV2 } from "@apexo/core/skill"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const CommandHandler = HttpApiBuilder.group(Api, "server.command", (handlers) =>
  handlers.handle("command.list", () =>
    PluginInternal.Service.use((internal) =>
      internal.ready.pipe(
        Effect.andThen(
          response(
            Effect.gen(function* () {
              const command = yield* CommandV2.Service
              const skill = yield* SkillV2.Service
              const commands = yield* command.list()
              const names = new Set(commands.map((item) => item.name))
              const skills = (yield* skill.list())
                .filter((item) => item.slash !== false && !names.has(item.name))
                .map((item) =>
                  CommandV2.Info.make({
                    name: item.name,
                    template: item.content,
                    description: item.description,
                  }),
                )
              return [...commands, ...skills]
            }),
          ),
        ),
      ),
    ),
  ),
)
