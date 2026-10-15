import { Project } from "@apexo/schema/project"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const makeProjectGroup = <LocationId extends HttpApiMiddleware.AnyId, LocationService>(
  locationMiddleware: Context.Key<LocationId, LocationService>,
) =>
  HttpApiGroup.make("server.project")
    .add(
      HttpApiEndpoint.get("project.list", "/api/project", {
        success: Schema.Array(Project.Info),
        error: ServiceUnavailableError,
      }).annotateMerge(OpenApi.annotations({ identifier: "v2.project.list", summary: "List persisted projects" })),
      HttpApiEndpoint.get("project.current", "/api/project/current", {
        query: LocationQuery,
        success: Project.Current,
      })
        .middleware(locationMiddleware)
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({ identifier: "v2.project.current", summary: "Resolve the current project" }),
        ),
    )
    .annotateMerge(OpenApi.annotations({ title: "project", description: "Native project catalog and identity." }))
