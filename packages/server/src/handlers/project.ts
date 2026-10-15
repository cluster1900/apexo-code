import { Location } from "@apexo/core/location"
import { ProjectCatalog } from "@apexo/core/project/catalog"
import { ServiceUnavailableError } from "@apexo/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  Effect.gen(function* () {
    const projects = yield* ProjectCatalog.Service
    return handlers
      .handle("project.list", () =>
        projects.list.pipe(
          Effect.mapError((error) => new ServiceUnavailableError({ message: error.message, service: "project" })),
        ),
      )
      .handle(
        "project.current",
        Effect.fn(function* () {
          const location = yield* Location.Service
          return location.project
        }),
      )
  }),
)
