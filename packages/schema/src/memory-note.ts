export * as MemoryNote from "./memory-note"

import { Schema } from "effect"
import { NonNegativeInt } from "./schema"

export interface Summary extends Schema.Schema.Type<typeof Summary> {}
export const Summary = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  source: Schema.Literals(["global", "workspace", "session"]),
  size: NonNegativeInt,
  modified: Schema.Finite,
  deletable: Schema.Boolean,
}).annotate({ identifier: "MemoryNote.Summary" })

export interface Detail extends Schema.Schema.Type<typeof Detail> {}
export const Detail = Schema.Struct({
  ...Summary.fields,
  content: Schema.String,
  hash: Schema.NullOr(Schema.String),
  truncated: Schema.Boolean,
}).annotate({ identifier: "MemoryNote.Detail" })

export interface Forget extends Schema.Schema.Type<typeof Forget> {}
export const Forget = Schema.Struct({
  path: Schema.String,
  hash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
}).annotate({ identifier: "MemoryNote.Forget" })
