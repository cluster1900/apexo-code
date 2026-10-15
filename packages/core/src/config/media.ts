export * as ConfigMedia from "./media"

import { Schema } from "effect"

const EnvironmentName = Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/))
const Credentials = Schema.Struct({
  access_key_id_env: EnvironmentName,
  secret_access_key_env: EnvironmentName,
})
export const S3 = Schema.Struct({
  type: Schema.Literal("s3"),
  bucket: Schema.String,
  endpoint: Schema.String,
  region: Schema.String,
  key_prefix: Schema.optional(Schema.String),
  expires_secs: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(480), Schema.isLessThanOrEqualTo(604800)),
  ),
  read_write: Credentials,
  read_only: Schema.optional(Credentials),
})
export const Info = Schema.Struct({
  image_gen_model_override: Schema.optional(Schema.String),
  image_edit_model_override: Schema.optional(Schema.String),
  video_output: Schema.optional(Schema.Union([Schema.Struct({ type: Schema.Literal("provider") }), S3])),
})
export type Info = typeof Info.Type

// Capture only the selected values; never retain the environment or resolved secrets in public configuration.
export function resolve(
  info: Info | undefined,
  env: Readonly<Record<string, string | undefined>>,
  kind: "image_gen" | "image_edit" | "image_to_video" | "reference_to_video",
) {
  const model = (configured: string | undefined, variable: string) => {
    const value = env[variable]?.trim() || configured?.trim() || "grok-imagine-image-quality"
    if (value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Invalid media model override")
    return value
  }
  const credentials = (names: typeof Credentials.Type) => {
    const access_key_id = env[names.access_key_id_env]
    const secret_access_key = env[names.secret_access_key_env]
    if (!access_key_id?.trim() || !secret_access_key?.trim())
      throw new Error("Video storage credentials are unavailable")
    return { access_key_id, secret_access_key }
  }
  const video = kind === "image_to_video" || kind === "reference_to_video"
  const output = video && info?.video_output?.type === "s3" ? info.video_output : undefined
  return {
    model:
      kind === "image_gen"
        ? model(info?.image_gen_model_override, "GROK_IMAGE_GEN_MODEL_OVERRIDE")
        : kind === "image_edit"
          ? model(info?.image_edit_model_override, "GROK_IMAGE_EDIT_MODEL_OVERRIDE")
          : "grok-imagine-video-1.5",
    storage: output
      ? {
          ...output,
          read_write: credentials(output.read_write),
          read_only: output.read_only ? credentials(output.read_only) : undefined,
        }
      : undefined,
  }
}
export type Storage = NonNullable<ReturnType<typeof resolve>["storage"]>
