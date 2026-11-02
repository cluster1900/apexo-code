import { Sandbox } from "@apexo/schema/sandbox"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"
import { ServiceUnavailableError } from "../errors"

export const SandboxGroup = HttpApiGroup.make("server.sandbox").add(
  HttpApiEndpoint.get("sandbox.catalog", "/api/sandbox", {
    query: LocationQuery,
    success: Sandbox.Catalog,
    error: [ServiceUnavailableError],
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      OpenApi.annotations({
        identifier: "v2.sandbox.catalog",
        summary: "Inspect available command sandbox profiles",
        description:
          "Read built-in and workspace custom command sandbox profiles and backend availability for the target Location.",
      }),
    ),
)
