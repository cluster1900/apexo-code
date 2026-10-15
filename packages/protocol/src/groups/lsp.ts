import { Lsp } from "@apexo/schema/lsp"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"
import { ServiceUnavailableError } from "../errors"

export const LspGroup = HttpApiGroup.make("server.lsp").add(
  HttpApiEndpoint.get("lsp.status", "/api/lsp", {
    query: LocationQuery,
    success: Lsp.StatusList,
    error: [ServiceUnavailableError],
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      OpenApi.annotations({
        identifier: "v2.lsp.status",
        summary: "Inspect active project language servers",
        description:
          "Read connection state and supported operations without retrying servers or starting model work. Initial Location creation may initialize trusted configured servers.",
      }),
    ),
)
