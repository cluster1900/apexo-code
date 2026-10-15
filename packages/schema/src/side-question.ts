export * as SideQuestion from "./side-question"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema"
import { SessionID } from "./session-id"

export const ID = Schema.String.check(Schema.isPattern(/^btw_[a-zA-Z0-9-]+$/))
export const Image = Schema.Struct({
  mediaType: Schema.Literals(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  data: Schema.String,
})
export const Input = Schema.Struct({
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(65_536)),
  images: optional(Schema.Array(Image).check(Schema.isMaxLength(20))),
}).annotate({ identifier: "SideQuestion.Input" })
export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Entry = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  question: Schema.String,
  imageCount: NonNegativeInt,
  status: Schema.Literals(["running", "completed", "cancelled", "failed"]),
  answer: Schema.String,
  error: optional(Schema.String),
  model: Schema.String,
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
}).annotate({ identifier: "SideQuestion.Entry" })
export interface Entry extends Schema.Schema.Type<typeof Entry> {}
