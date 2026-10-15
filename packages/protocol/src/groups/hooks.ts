import { HostHooks } from "@apexo/schema/host-hooks"
import { SessionID } from "@apexo/schema/session-id"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"

const root = "/api/session/:sessionID/hooks"
export const HooksGroup = HttpApiGroup.make("server.hooks").add(
  HttpApiEndpoint.get("hooks.get", root, {
    params: { sessionID: SessionID },
    success: HostHooks.Snapshot,
    error: [ServiceUnavailableError, SessionNotFoundError],
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.hooks.get" })),
  HttpApiEndpoint.post("hooks.reload", `${root}/reload`, {
    params: { sessionID: SessionID },
    success: HostHooks.Snapshot,
    error: [ConflictError, ServiceUnavailableError, SessionNotFoundError],
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.hooks.reload" })),
  HttpApiEndpoint.post("hooks.trust", `${root}/trust`, {
    params: { sessionID: SessionID },
    payload: HostHooks.RepositoryTrust,
    success: HostHooks.Snapshot,
    error: [InvalidRequestError, ConflictError, ServiceUnavailableError, SessionNotFoundError],
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.hooks.trust" })),
  HttpApiEndpoint.post("hooks.preference", `${root}/preference`, {
    params: { sessionID: SessionID },
    payload: HostHooks.Preference,
    success: HostHooks.Snapshot,
    error: [InvalidRequestError, ConflictError, ServiceUnavailableError, SessionNotFoundError],
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.hooks.preference" })),
)
