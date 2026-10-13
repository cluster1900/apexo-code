import { SkillV2 } from "@apexo/core/skill"
import { PluginInternal } from "@apexo/core/plugin/internal"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers
    .handle("skill.list", () =>
      PluginInternal.Service.use((internal) =>
        internal.ready.pipe(Effect.andThen(response(SkillV2.Service.use((skill) => skill.list())))),
      ),
    )
    .handle("skill.reload", () =>
      PluginInternal.Service.use((internal) =>
        internal.ready.pipe(Effect.andThen(SkillV2.Service.use((skill) => skill.reload()))),
      ),
    ),
)
