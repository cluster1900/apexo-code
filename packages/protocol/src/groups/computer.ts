import { Computer } from "@apexo/schema/computer"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"

const root = "/api/session/:sessionID/computer"
const error = [SessionNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError]

export const ComputerGroup = HttpApiGroup.make("server.computer").add(
  HttpApiEndpoint.get("computer.list", root, {
    params: { sessionID: SessionID },
    success: Schema.Array(Computer.Info),
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.computer.list" })),
  HttpApiEndpoint.post("computer.open", root, {
    params: { sessionID: SessionID },
    payload: Schema.Struct({ backend: Schema.optional(Schema.Literals(["auto", "native", "fixture"])) }),
    success: Computer.Info,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.computer.open" })),
  HttpApiEndpoint.post("computer.action", `${root}/:computerSessionID/action`, {
    params: { sessionID: SessionID, computerSessionID: Computer.ComputerSessionID },
    payload: Schema.Struct({
      action: Computer.Action,
      x: Schema.optional(Schema.Number),
      y: Schema.optional(Schema.Number),
      text: Schema.optional(Schema.String),
      key: Schema.optional(Schema.String),
      target: Schema.optional(Schema.String),
      expectedSnapshotHash: Schema.optional(Schema.String),
      destructive: Schema.optional(Schema.Boolean),
    }),
    success: Computer.ActionResult,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.computer.action" })),
  HttpApiEndpoint.post("computer.close", `${root}/:computerSessionID/close`, {
    params: { sessionID: SessionID, computerSessionID: Computer.ComputerSessionID },
    success: HttpApiSchema.NoContent,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.computer.close" })),
  HttpApiEndpoint.get("computer.events", `${root}/:computerSessionID/events`, {
    params: { sessionID: SessionID, computerSessionID: Computer.ComputerSessionID },
    query: { after: Schema.optional(Schema.NumberFromString), limit: Schema.optional(Schema.NumberFromString) },
    success: Computer.ReplayPage,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.computer.events" })),
)
