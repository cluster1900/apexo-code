import { Config } from "@/config/config"
import { ConfigV1 } from "@apexo/core/v1/config/config"
import { Provider } from "@/provider/provider"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { ClaudeImport } from "@/config/claude-import"

const root = "/config"

export const ConfigApi = HttpApi.make("config")
  .add(
    HttpApiGroup.make("config")
      .add(
        HttpApiEndpoint.get("get", root, {
          query: WorkspaceRoutingQuery,
          success: described(ConfigV1.Info, "Get config info"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.get",
            summary: "Get configuration",
            description: "Retrieve the current Apexo configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.patch("update", root, {
          query: WorkspaceRoutingQuery,
          payload: ConfigV1.Info,
          success: described(ConfigV1.Info, "Successfully updated config"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.update",
            summary: "Update configuration",
            description: "Update Apexo configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.get("claudeImportPreview", `${root}/import-claude`, {
          query: WorkspaceRoutingQuery,
          success: described(ClaudeImport.Preview, "Claude settings found under ~/.claude"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.claudeImport.preview",
            summary: "Preview Claude settings import",
            description:
              "List the permissions, environment, MCP servers, hooks and rule paths /import-claude can bring over.",
          }),
        ),
        HttpApiEndpoint.post("claudeImportApply", `${root}/import-claude`, {
          query: WorkspaceRoutingQuery,
          payload: ClaudeImport.ApplyInput,
          success: described(ClaudeImport.ApplyResult, "Imported sections"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.claudeImport.apply",
            summary: "Import Claude settings",
            description: "Write the chosen Claude settings sections into the global apexo config and hooks.",
          }),
        ),
        HttpApiEndpoint.get("providers", `${root}/providers`, {
          query: WorkspaceRoutingQuery,
          success: described(Provider.ConfigProvidersResult, "List of providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.providers",
            summary: "List config providers",
            description: "Get a list of all configured AI providers and their default models.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "config",
          description: "Experimental HttpApi config routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "apexo experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
