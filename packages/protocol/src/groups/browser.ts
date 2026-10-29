import { Browser } from "@apexo/schema/browser"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "../errors"

const root = "/api/session/:sessionID/browser"
const error = [SessionNotFoundError, ConflictError, InvalidRequestError, ServiceUnavailableError]
const action = Schema.Struct({
  action: Browser.Action,
  pageID: Schema.optional(Browser.PageID),
  url: Schema.optional(Schema.String),
  selector: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  expectedSnapshotHash: Schema.optional(Schema.String),
  fullPage: Schema.optional(Schema.Boolean),
  destructive: Schema.optional(Schema.Boolean),
})

export const BrowserGroup = HttpApiGroup.make("server.browser").add(
  HttpApiEndpoint.get("browser.list", root, {
    params: { sessionID: SessionID },
    success: Schema.Array(Browser.Info),
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.browser.list" })),
  HttpApiEndpoint.post("browser.open", root, {
    params: { sessionID: SessionID },
    payload: Schema.Struct({ url: Schema.String, cdpUrl: Schema.optional(Schema.String) }),
    success: Browser.Info,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.browser.open" })),
  HttpApiEndpoint.post("browser.action", `${root}/:browserSessionID/action`, {
    params: { sessionID: SessionID, browserSessionID: Browser.BrowserSessionID },
    payload: action,
    success: Browser.ActionResult,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.browser.action" })),
  HttpApiEndpoint.post("browser.close", `${root}/:browserSessionID/close`, {
    params: { sessionID: SessionID, browserSessionID: Browser.BrowserSessionID },
    success: HttpApiSchema.NoContent,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.browser.close" })),
  HttpApiEndpoint.get("browser.events", `${root}/:browserSessionID/events`, {
    params: { sessionID: SessionID, browserSessionID: Browser.BrowserSessionID },
    query: {
      after: Schema.optional(Schema.NumberFromString),
      limit: Schema.optional(Schema.NumberFromString),
    },
    success: Browser.ReplayPage,
    error,
  }).annotateMerge(OpenApi.annotations({ identifier: "v2.browser.events" })),
)
