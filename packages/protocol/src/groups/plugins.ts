import { PluginStore } from "@apexo/schema/plugin-store"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

const errors = [InvalidRequestError, ConflictError, ServiceUnavailableError]

export const makePluginsGroup = <LocationId extends HttpApiMiddleware.AnyId, LocationService>(
  locationMiddleware: Context.Key<LocationId, LocationService>,
) =>
  HttpApiGroup.make("server.plugins")
    .add(
      HttpApiEndpoint.get("plugins.list", "/api/plugins", {
        success: PluginStore.Catalog,
        error: errors,
      }).annotateMerge(OpenApi.annotations({ identifier: "v2.plugins.list", summary: "Browse Plugins" })),
      HttpApiEndpoint.get("plugins.detail", "/api/plugins/detail", {
        query: Schema.Struct({ id: Schema.String }),
        success: PluginStore.Detail,
        error: errors,
      }).annotateMerge(OpenApi.annotations({ identifier: "v2.plugins.detail", summary: "Read plugin details" })),
      HttpApiEndpoint.post("plugins.manage", "/api/plugins/manage", {
        payload: PluginStore.Action,
        success: PluginStore.Catalog,
        error: errors,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "v2.plugins.manage", summary: "Manage installed Plugins and sources" }),
      ),
      HttpApiEndpoint.get("plugins.runtime", "/api/plugins/runtime", {
        query: LocationQuery,
        success: PluginStore.Runtime,
        error: errors,
      })
        .middleware(locationMiddleware)
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.plugins.runtime",
            summary: "Inspect Plugins active in the native project runtime",
          }),
        ),
      HttpApiEndpoint.post("plugins.reload", "/api/plugins/reload", {
        query: LocationQuery,
        success: Schema.Boolean,
        error: errors,
      })
        .middleware(locationMiddleware)
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.plugins.reload",
            summary: "Apply validated Plugin changes to an idle native project",
          }),
        ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "plugins",
        description: "Global installation management and explicit native project activation.",
      }),
    )
