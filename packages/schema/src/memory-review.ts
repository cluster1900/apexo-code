export * as MemoryReview from "./memory-review"

import { Schema } from "effect"
import { optional } from "./schema"

const Content = Schema.String.check(Schema.isPattern(/\S/u), Schema.isMaxLength(32768))

export interface Save extends Schema.Schema.Type<typeof Save> {}
export const Save = Schema.Struct({
  content: Schema.String.check(Schema.isPattern(/\S/u), Schema.isMaxLength(65536)),
  scope: optional(Schema.Literals(["global", "workspace"])),
}).annotate({ identifier: "MemoryReview.Save" })

export interface Saved extends Schema.Schema.Type<typeof Saved> {}
export const Saved = Schema.Struct({ path: Schema.String }).annotate({ identifier: "MemoryReview.Saved" })

export interface Rewrite extends Schema.Schema.Type<typeof Rewrite> {}
export const Rewrite = Schema.Struct({ content: Content }).annotate({ identifier: "MemoryReview.Rewrite" })

export interface Rewritten extends Schema.Schema.Type<typeof Rewritten> {}
export const Rewritten = Schema.Struct({ content: Content }).annotate({ identifier: "MemoryReview.Rewritten" })
