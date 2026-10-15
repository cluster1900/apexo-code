import { HostHooks } from "@apexo/schema/host-hooks"
import { SessionID } from "@apexo/schema/session-id"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { ApiNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError } from "../errors"

const root = "/session/:sessionID/hooks"
export const HooksApi = HttpApi.make("hooks").add(
  HttpApiGroup.make("hooks")
    .add(
      HttpApiEndpoint.get("get", root, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        success: HostHooks.Snapshot,
        error: [ApiNotFoundError, ServiceUnavailableError],
      }).annotateMerge(OpenApi.annotations({ identifier: "hooks.get" })),
      HttpApiEndpoint.post("reload", `${root}/reload`, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        success: HostHooks.Snapshot,
        error: [ApiNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError],
      }).annotateMerge(OpenApi.annotations({ identifier: "hooks.reload" })),
      HttpApiEndpoint.post("trust", `${root}/trust`, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        payload: HostHooks.RepositoryTrust,
        success: HostHooks.Snapshot,
        error: [ApiNotFoundError, InvalidRequestError, ConflictError, ServiceUnavailableError],
      }).annotateMerge(OpenApi.annotations({ identifier: "hooks.trust" })),
      HttpApiEndpoint.post("preference", `${root}/preference`, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        payload: HostHooks.Preference,
        success: HostHooks.Snapshot,
        error: [ApiNotFoundError, InvalidRequestError, ConflictError, ServiceUnavailableError],
      }).annotateMerge(OpenApi.annotations({ identifier: "hooks.preference" })),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
