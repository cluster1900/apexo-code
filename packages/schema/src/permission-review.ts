export * as PermissionReview from "./permission-review"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { Permission } from "./permission"
import { NonNegativeInt, optional } from "./schema"
import { SessionID } from "./session-id"

export const Mode = Schema.Literals(["manual", "review"]).annotate({ identifier: "PermissionReview.Mode" })
export type Mode = typeof Mode.Type
export const State = Schema.Struct({ mode: Mode, revision: NonNegativeInt }).annotate({
  identifier: "PermissionReview.State",
})
export interface State extends Schema.Schema.Type<typeof State> {}
const Fields = { sessionID: SessionID, requestID: Permission.ID, model: Schema.String.pipe(optional) }
const Started = define({ type: "permission.review.started", schema: Fields })
const Settled = define({
  type: "permission.review.settled",
  schema: {
    ...Fields,
    outcome: Schema.Literals(["allowed_once", "ask_manual", "superseded"]),
    reason: Schema.String,
  },
})
const ModeChanged = define({
  type: "permission.review.mode.changed",
  schema: { sessionID: SessionID, ...State.fields },
})
export const Event = { Started, Settled, ModeChanged, Definitions: inventory(Started, Settled, ModeChanged) }
