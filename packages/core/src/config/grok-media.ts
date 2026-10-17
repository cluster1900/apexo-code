export * as ConfigGrokMedia from "./grok-media"

import { Schema } from "effect"

const Credentials = Schema.Struct({ access_key_id: Schema.String, secret_access_key: Schema.String })
export const OutputS3 = Schema.Struct({
  bucket: Schema.String,
  endpoint: Schema.String,
  region: Schema.String,
  key_prefix: Schema.optional(Schema.String),
  expires_secs: Schema.optional(Schema.Int),
  zdr_only: Schema.optional(Schema.Boolean),
  read_write: Credentials,
  read_only: Schema.optional(Credentials),
})
export type OutputS3 = typeof OutputS3.Type
export const Info = Schema.Struct({
  image_gen_model_override: Schema.optional(Schema.String),
  image_edit_model_override: Schema.optional(Schema.String),
  disable_zdr_incompatible_tools: Schema.optional(Schema.Boolean),
  team_blocked_reasons: Schema.optional(Schema.Array(Schema.String)),
  zdr_video_output_s3: Schema.optional(OutputS3),
})

