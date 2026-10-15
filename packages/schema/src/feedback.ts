export * as Feedback from "./feedback"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, optional } from "./schema"
import { SessionID } from "./session-id"

export const ID = Schema.String.check(Schema.isPattern(/^feedback_[a-zA-Z0-9-]+$/)).annotate({
  identifier: "Feedback.ID",
})
export const Type = Schema.Literals(["bug", "idea", "missing_capability"])
export const TaskCategory = Schema.Literals([
  "code_edit",
  "debug",
  "explain",
  "plan",
  "shell",
  "search",
  "review",
  "other",
])
export const FailureMode = Schema.Literals([
  "overeager",
  "stopped_early",
  "unwanted_scope",
  "didnt_ask_for_help",
  "excessive_questions",
  "subagent_overspawn",
  "over_correction",
  "ignored_instructions",
  "hallucinated",
  "sloppy_code",
  "destructive",
  "lost_context",
  "stuck_in_a_loop",
  "model_regression",
  "disputed",
  "wrong_tone",
  "unclear_output",
  "other",
])

export const Input = Schema.Struct({
  title: Schema.String.check(Schema.isMaxLength(65_536)),
  details: Schema.String.check(Schema.isMaxLength(65_536)),
  product_area: optional(Schema.String.check(Schema.isMaxLength(65_536))),
  type: Type,
  task_category: optional(TaskCategory),
  failure_mode: optional(FailureMode),
}).annotate({ identifier: "Feedback.Input" })
export interface Input extends Schema.Schema.Type<typeof Input> {}

export const ToolSave = Schema.Struct({
  ...Input.fields,
  draft_id: optional(Schema.String),
  revision: optional(PositiveInt),
}).annotate({ identifier: "Feedback.ToolSave" })
export interface ToolSave extends Schema.Schema.Type<typeof ToolSave> {}

export const MaxImages = 4
export const MaxImageBytes = 8 * 1024 * 1024
export const MaxImageTotalBytes = 16 * 1024 * 1024
export const ImageID = Schema.String.check(Schema.isPattern(/^feedback_image_[a-zA-Z0-9-]+$/)).annotate({
  identifier: "Feedback.ImageID",
})
export const ImageMime = Schema.Literals(["image/png", "image/jpeg", "image/gif"])
export const ImageSnapshot = Schema.Struct({
  data: Schema.String.check(Schema.isMaxLength(4 * Math.ceil(MaxImageBytes / 3))),
  mimeType: ImageMime,
  fileName: optional(Schema.String.check(Schema.isMaxLength(255))),
}).annotate({ identifier: "Feedback.ImageSnapshot" })
export interface ImageSnapshot extends Schema.Schema.Type<typeof ImageSnapshot> {}
export const ImageInput = Schema.Union([Schema.Struct({ id: ImageID }), ImageSnapshot]).annotate({
  identifier: "Feedback.ImageInput",
})
export type ImageInput = typeof ImageInput.Type
export const Image = Schema.Struct({
  id: ImageID,
  mimeType: ImageMime,
  fileName: Schema.String,
  size: PositiveInt,
}).annotate({ identifier: "Feedback.Image" })
export interface Image extends Schema.Schema.Type<typeof Image> {}
export const ImageContent = Schema.Struct({ ...Image.fields, data: ImageSnapshot.fields.data }).annotate({
  identifier: "Feedback.ImageContent",
})
export interface ImageContent extends Schema.Schema.Type<typeof ImageContent> {}

export const Save = Schema.Struct({
  ...ToolSave.fields,
  images: optional(Schema.Array(ImageInput).check(Schema.isMaxLength(MaxImages))),
}).annotate({ identifier: "Feedback.Save" })
export interface Save extends Schema.Schema.Type<typeof Save> {}

export const Draft = Schema.Struct({
  ...Input.fields,
  id: ID,
  sessionID: SessionID,
  revision: PositiveInt,
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
  images: optional(Schema.Array(Image).check(Schema.isMaxLength(MaxImages))),
}).annotate({ identifier: "Feedback.Draft" })
export interface Draft extends Schema.Schema.Type<typeof Draft> {}

export const Review = Schema.Struct({ revision: PositiveInt }).annotate({ identifier: "Feedback.Review" })
export const Issue = Schema.Struct({
  draft: Draft,
  title: Schema.String,
  body: Schema.String,
  url: Schema.String,
}).annotate({ identifier: "Feedback.Issue" })
