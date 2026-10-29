export * as Computer from "./computer"

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

export const ComputerSessionID = id("cmp_", "Computer.SessionID")
export type ComputerSessionID = typeof ComputerSessionID.Type

export const ActionID = id("cact_", "Computer.ActionID")
export type ActionID = typeof ActionID.Type

export const ArtifactID = id("cart_", "Computer.ArtifactID")
export type ArtifactID = typeof ArtifactID.Type

export const Status = Schema.Literals(["ready", "permission_required", "unavailable", "closed"])
export type Status = typeof Status.Type

export const Action = Schema.Literals(["open", "observe", "click", "type", "press", "scroll", "screenshot", "close"])
export type Action = typeof Action.Type

export const Snapshot = Schema.Struct({
  hash: Schema.String,
  activeApp: optional(Schema.String),
  window: optional(Schema.String),
  text: optional(Schema.String),
})
export type Snapshot = typeof Snapshot.Type

export const Info = Schema.Struct({
  id: ComputerSessionID,
  sessionID: SessionID,
  status: Status,
  backend: Schema.String,
  createdAt: Schema.Int,
  lastActionAt: optional(Schema.Int),
  snapshot: optional(Snapshot),
  unavailableReason: optional(Schema.String),
})
export type Info = typeof Info.Type

export const OpenInput = Schema.Struct({ sessionID: SessionID, backend: Schema.optional(Schema.Literals(["auto", "native", "fixture"])) })
export type OpenInput = typeof OpenInput.Type

export const ActionInput = Schema.Struct({
  computerSessionID: ComputerSessionID,
  action: Action,
  x: optional(Schema.Number),
  y: optional(Schema.Number),
  text: optional(Schema.String),
  key: optional(Schema.String),
  target: optional(Schema.String),
  expectedSnapshotHash: optional(Schema.String),
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
  computerSessionID: ComputerSessionID,
  actionID: ActionID,
  action: Action,
  output: Schema.String,
  snapshot: optional(Snapshot),
  artifact: optional(Artifact),
  artifactData: optional(Schema.String),
})
export type ActionResult = typeof ActionResult.Type

export const EventStarted = define({
  type: "computer.session_started",
  durable: { version: 1, aggregate: "computerSessionID" },
  schema: { computerSessionID: ComputerSessionID, sessionID: SessionID, info: Info },
})

export const EventActionStarted = define({
  type: "computer.action_started",
  durable: { version: 1, aggregate: "computerSessionID" },
  schema: { computerSessionID: ComputerSessionID, actionID: ActionID, action: Action },
})

export const EventActionCompleted = define({
  type: "computer.action_completed",
  durable: { version: 1, aggregate: "computerSessionID" },
  schema: {
    computerSessionID: ComputerSessionID,
    actionID: ActionID,
    action: Action,
    status: Schema.Literals(["completed", "failed"]),
    output: optional(Schema.String),
    error: optional(Schema.String),
    snapshot: optional(Snapshot),
    artifactID: optional(ArtifactID),
  },
})

export const EventArtifactCreated = define({
  type: "computer.artifact_created",
  durable: { version: 1, aggregate: "computerSessionID" },
  schema: { computerSessionID: ComputerSessionID, artifact: Artifact },
})

export const EventApprovalRequired = define({
  type: "computer.approval_required",
  durable: { version: 1, aggregate: "computerSessionID" },
  schema: {
    computerSessionID: ComputerSessionID,
    actionID: ActionID,
    permission: Schema.String,
    resource: Schema.String,
    reason: Schema.String,
  },
})

export const EventClosed = define({
  type: "computer.closed",
  durable: { version: 1, aggregate: "computerSessionID" },
  schema: { computerSessionID: ComputerSessionID },
})

export const Event = {
  Started: EventStarted,
  ActionStarted: EventActionStarted,
  ActionCompleted: EventActionCompleted,
  ArtifactCreated: EventArtifactCreated,
  ApprovalRequired: EventApprovalRequired,
  Closed: EventClosed,
  Definitions: inventory(EventStarted, EventActionStarted, EventActionCompleted, EventArtifactCreated, EventApprovalRequired, EventClosed),
}

export const Events = Schema.Union([
  EventStarted,
  EventActionStarted,
  EventActionCompleted,
  EventArtifactCreated,
  EventApprovalRequired,
  EventClosed,
] as const)
export type Events = typeof Events.Type

export const ReplayQuery = Schema.Struct({
  computerSessionID: ComputerSessionID,
  after: Schema.optional(Schema.NumberFromString),
  limit: Schema.optional(Schema.NumberFromString),
})

export const ReplayPage = Schema.Struct({
  events: Schema.Array(Events),
  cursor: Schema.Struct({ earliest: Schema.Int, head: Schema.Int, next: optional(Schema.String) }),
})
export type ReplayPage = typeof ReplayPage.Type
