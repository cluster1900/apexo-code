import { AgentV2 } from "@apexo/core/agent"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const AgentHandler = HttpApiBuilder.group(Api, "server.agent", (handlers) =>
  handlers.handle("agent.list", () =>
    Effect.gen(function* () {
      return yield* response(
        AgentV2.Service.use((agent) =>
          agent.all().pipe(
            Effect.map((items) =>
              items
                .filter((item) => !item.hidden)
                .map((item) => ({
                  id: item.id,
                  model: item.model,
                  request: item.request,
                  description: item.description,
                  mode: item.mode,
                  hidden: item.hidden,
                  color: item.color,
                  steps: item.steps,
                  permissions: [],
                })),
            ),
          ),
        ),
      )
    }),
  ),
)
