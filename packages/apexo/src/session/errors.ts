import { Schema } from "effect"
import { SessionID } from "./schema"

export class BusyError extends Schema.TaggedErrorClass<BusyError>()("SessionBusyError", {
  sessionID: SessionID,
}) {}
