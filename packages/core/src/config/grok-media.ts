export * as ConfigGrokMedia from "./grok-media"

import { Schema } from "effect"

const Credentials = Schema.Struct({ access_key_id: Schema.String, secret_access_key: Schema.String })
export const OutputS3 = Schema.Struct({
  bucket: Schema.String,
  endpoint: Schema.String,
  region: Schema.String,
  key_prefix: Schema.optional(Schema.String),
  expires_secs: Schema.optional(Schema.Int),
  read_write: Credentials,
  read_only: Schema.optional(Credentials),
})
export type OutputS3 = typeof OutputS3.Type
export const Info = Schema.Struct({ zdr_video_output_s3: Schema.optional(OutputS3) })
