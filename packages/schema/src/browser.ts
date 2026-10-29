export * as Browser from "./browser"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { optional, statics } from "./schema"
import { SessionID } from "./session-id"
import { ascending } from "./identifier"

const id = (prefix: string, name: string) =>
  Schema.String.check(Schema.isStartsWith(prefix)).pipe(
    Schema.brand(name),
    statics((schema) => ({ create: () => schema.make(prefix + ascending()) })),
  )

export const BrowserSessionID = id("brw_", "Browser.SessionID")
export type BrowserSessionID = typeof BrowserSessionID.Type

export const PageID = id("page_", "Browser.PageID")
export type PageID = typeof PageID.Type

export const ActionID = id("act_", "Browser.ActionID")
export type ActionID = typeof ActionID.Type

export const ArtifactID = id("art_", "Browser.ArtifactID")
export type ArtifactID = typeof ArtifactID.Type

export const Status = Schema.Literals(["connecting", "connected", "disconnected", "closed"])
export type Status = typeof Status.Type

export const Action = Schema.Literals(["open", "observe", "click", "type", "press", "scroll", "screenshot", "close"])
export type Action = typeof Action.Type

export const Page = Schema.Struct({
  id: PageID,
  url: Schema.String,
  title: Schema.String,
  snapshotHash: Schema.String,
})
export type Page = typeof Page.Type

export const Info = Schema.Struct({
  id: BrowserSessionID,
  sessionID: SessionID,
  status: Status,
  cdpUrl: optional(Schema.String),
  page: optional(Page),
  createdAt: Schema.Int,
  lastActionAt: optional(Schema.Int),
  disconnectedReason: optional(Schema.String),
})
export type Info = typeof Info.Type

export const OpenInput = Schema.Struct({
  sessionID: SessionID,
  url: Schema.String,
  cdpUrl: optional(Schema.String),
})
export type OpenInput = typeof OpenInput.Type

export const ActionInput = Schema.Struct({
  browserSessionID: BrowserSessionID,
  action: Action,
  pageID: optional(PageID),
  url: optional(Schema.String),
  selector: optional(Schema.String),
  text: optional(Schema.String),
  key: optional(Schema.String),
  x: optional(Schema.Number),
  y: optional(Schema.Number),
  expectedSnapshotHash: optional(Schema.String),
  fullPage: optional(Schema.Boolean),
  destructive: optional(Schema.Boolean),
})
export type ActionInput = typeof ActionInput.Type

export const Artifact = Schema.Struct({
  id: ArtifactID,
  mime: Schema.String,
  relativePath: Schema.String,
  byteLength: Schema.Int,
  sensitive: Schema.Boolean,
})
export type Artifact = typeof Artifact.Type

export const ActionResult = Schema.Struct({
  browserSessionID: BrowserSessionID,
  actionID: ActionID,
  action: Action,
  output: Schema.String,
  page: optional(Page),
  artifact: optional(Artifact),
  artifactData: optional(Schema.String),
})
export type ActionResult = typeof ActionResult.Type

export const EventStarted = define({
  type: "browser.session_started",
  durable: { version: 1, aggregate: "browserSessionID" },
  schema: { browserSessionID: BrowserSessionID, sessionID: SessionID, info: Info },
})

export const EventPageChanged = define({
  type: "browser.page_changed",
  durable: { version: 1, aggregate: "browserSessionID" },
  schema: { browserSessionID: BrowserSessionID, page: Page },
})

export const EventActionStarted = define({
  type: "browser.action_started",
  durable: { version: 1, aggregate: "browserSessionID" },
  schema: {
    browserSessionID: BrowserSessionID,
    actionID: ActionID,
    action: Action,
    pageID: optional(PageID),
  },
})

export const EventActionCompleted = define({
  type: "browser.action_completed",
  durable: { version: 1, aggregate: "browserSessionID" },
  schema: {
    browserSessionID: BrowserSessionID,
    actionID: ActionID,
    action: Action,
    status: Schema.Literals(["completed", "failed"]),
    output: optional(Schema.String),
    error: optional(Schema.String),
    page: optional(Page),
    artifactID: optional(ArtifactID),
  },
})

export const EventArtifactCreated = define({
  type: "browser.artifact_created",
  durable: { version: 1, aggregate: "browserSessionID" },
  schema: {
    browserSessionID: BrowserSessionID,
    artifact: Artifact,
  },
})

export const EventApprovalRequired = define({
  type: "browser.approval_required",
  durable: { version: 1, aggregate: "browserSessionID" },
  schema: {
    browserSessionID: BrowserSessionID,
    actionID: ActionID,
    permission: Schema.String,
    resource: Schema.String,
    reason: Schema.String,
  },
})

export const EventDisconnected = define({
  type: "browser.disconnected",
  durable: { version: 1, aggregate: "browserSessionID" },
  schema: { browserSessionID: BrowserSessionID, reason: Schema.String },
})

export const EventClosed = define({
  type: "browser.closed",
  durable: { version: 1, aggregate: "browserSessionID" },
  schema: { browserSessionID: BrowserSessionID },
})

export const Event = {
  Started: EventStarted,
  PageChanged: EventPageChanged,
  ActionStarted: EventActionStarted,
  ActionCompleted: EventActionCompleted,
  ArtifactCreated: EventArtifactCreated,
  ApprovalRequired: EventApprovalRequired,
  Disconnected: EventDisconnected,
  Closed: EventClosed,
  Definitions: inventory(
    EventStarted,
    EventPageChanged,
    EventActionStarted,
    EventActionCompleted,
    EventArtifactCreated,
    EventApprovalRequired,
    EventDisconnected,
    EventClosed,
  ),
}

export const Events = Schema.Union([
  EventStarted,
  EventPageChanged,
  EventActionStarted,
  EventActionCompleted,
  EventArtifactCreated,
  EventApprovalRequired,
  EventDisconnected,
  EventClosed,
] as const)
export type Events = typeof Events.Type

export const ReplayQuery = Schema.Struct({
  browserSessionID: BrowserSessionID,
  after: Schema.optional(Schema.NumberFromString),
  limit: Schema.optional(Schema.NumberFromString),
})

export const ReplayPage = Schema.Struct({
  events: Schema.Array(Events),
  cursor: Schema.Struct({
    earliest: Schema.Int,
    head: Schema.Int,
    next: optional(Schema.String),
  }),
})
export type ReplayPage = typeof ReplayPage.Type
