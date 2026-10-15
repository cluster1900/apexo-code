import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { PluginStore } from "@apexo/schema/plugin-store"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { InvalidRequestError, ConflictError } from "../errors"

export const PluginsApi = HttpApi.make("plugins").add(
  HttpApiGroup.make("plugins")
    .add(
      HttpApiEndpoint.post("reload", "/plugins/reload", {
        query: WorkspaceRoutingQuery,
        success: Schema.Boolean,
        error: ConflictError,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "plugins.reload", summary: "Apply plugin changes to an idle project" }),
      ),
      HttpApiEndpoint.get("list", "/plugins", {
        query: WorkspaceRoutingQuery,
        success: PluginStore.Catalog,
        error: InvalidRequestError,
      }).annotateMerge(OpenApi.annotations({ identifier: "plugins.list", summary: "Browse Plugins" })),
      HttpApiEndpoint.get("detail", "/plugins/detail", {
        query: Schema.Struct({ ...WorkspaceRoutingQueryFields, id: Schema.String }),
        success: PluginStore.Detail,
        error: InvalidRequestError,
      }).annotateMerge(OpenApi.annotations({ identifier: "plugins.detail", summary: "Read plugin details" })),
      HttpApiEndpoint.post("manage", "/plugins/manage", {
        query: WorkspaceRoutingQuery,
        payload: PluginStore.Action,
        success: PluginStore.Catalog,
        error: InvalidRequestError,
      }).annotateMerge(OpenApi.annotations({ identifier: "plugins.manage", summary: "Manage Plugins and sources" })),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
