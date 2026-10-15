import { expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigMedia } from "@apexo/core/config/media"
import { Config } from "@apexo/core/config"
import { ConfigV1 } from "@apexo/core/v1/config/config"
import { ConfigMigrateV1 } from "@apexo/core/v1/config/migrate"
import { MediaS3 } from "@apexo/core/tool/media-s3"

const settings = {
  image_gen_model_override: "generate-config",
  image_edit_model_override: "edit-config",
  video_output: {
    type: "s3" as const,
    bucket: "examplebucket",
    endpoint: "https://s3.amazonaws.com",
    region: "us-east-1",
    key_prefix: "a b/ü!",
    expires_secs: 86400,
    read_write: { access_key_id_env: "TEST_S3_ID", secret_access_key_env: "TEST_S3_SECRET" },
  },
}
const env = { TEST_S3_ID: "AKIAIOSFODNN7EXAMPLE", TEST_S3_SECRET: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" }

test("media overrides are independent and video does not evaluate image settings", () => {
  expect(ConfigMedia.resolve(undefined, {}, "image_gen").model).toBe("grok-imagine-image-quality")
  expect(ConfigMedia.resolve(settings, {}, "image_gen").model).toBe("generate-config")
  expect(ConfigMedia.resolve(settings, {}, "image_edit").model).toBe("edit-config")
  expect(ConfigMedia.resolve(settings, { GROK_IMAGE_GEN_MODEL_OVERRIDE: "  env-gen  " }, "image_gen").model).toBe(
    "env-gen",
  )
  expect(ConfigMedia.resolve(settings, { GROK_IMAGE_GEN_MODEL_OVERRIDE: "env-gen" }, "image_edit").model).toBe(
    "edit-config",
  )
  expect(ConfigMedia.resolve(settings, { GROK_IMAGE_EDIT_MODEL_OVERRIDE: "env-edit" }, "image_edit").model).toBe(
    "env-edit",
  )
  expect(ConfigMedia.resolve(settings, { GROK_IMAGE_GEN_MODEL_OVERRIDE: "  " }, "image_gen").model).toBe(
    "generate-config",
  )
  expect(ConfigMedia.resolve(undefined, { GROK_IMAGE_GEN_MODEL_OVERRIDE: "bad\nmodel" }, "image_to_video").model).toBe(
    "grok-imagine-video-1.5",
  )
  expect(() => ConfigMedia.resolve(undefined, { GROK_IMAGE_GEN_MODEL_OVERRIDE: "bad\nmodel" }, "image_gen")).toThrow(
    "Invalid media model",
  )
})

test("native and migrated V1 documents preserve only credential references", () => {
  const native = Schema.decodeUnknownSync(Config.Info)({ media: settings })
  const legacy = Schema.decodeUnknownSync(ConfigV1.Info)({ provider: {}, media: settings })
  expect(ConfigMigrateV1.migrate(legacy).media).toEqual(native.media)
  expect(JSON.stringify(native)).not.toContain(env.TEST_S3_SECRET)
  expect(() =>
    Schema.decodeUnknownSync(ConfigMedia.Info)({ video_output: { ...settings.video_output, expires_secs: 479 } }),
  ).toThrow()
  expect(() =>
    Schema.decodeUnknownSync(ConfigMedia.Info)({ video_output: { ...settings.video_output, expires_secs: 604801 } }),
  ).toThrow()
})

test("missing credentials fail closed and captured credentials cannot change mid-invocation", () => {
  expect(() => ConfigMedia.resolve(settings, {}, "image_to_video")).toThrow("credentials are unavailable")
  const mutable = { ...env }
  const resolved = ConfigMedia.resolve(settings, mutable, "image_to_video")
  mutable.TEST_S3_SECRET = "changed"
  expect(resolved.storage?.read_write.secret_access_key).toBe(env.TEST_S3_SECRET)
  expect(() =>
    ConfigMedia.resolve(
      {
        ...settings,
        video_output: {
          ...settings.video_output,
          read_only: { access_key_id_env: "ABSENT", secret_access_key_env: "ABSENT" },
        },
      },
      env,
      "reference_to_video",
    ),
  ).toThrow("credentials are unavailable")
})

test("SigV4 PUT/GET canonical vectors match independently checked aws4 1.13.2 signatures", () => {
  const storage = ConfigMedia.resolve(settings, env, "image_to_video").storage!
  const prepared = MediaS3.prepare(storage, "test.mp4")
  const signed = MediaS3.sign(prepared, new Date("2013-05-24T00:00:00Z"))
  expect(prepared.resource).toBe("s3://examplebucket/a%20b/%C3%BC%21/test.mp4")
  expect(new URL(signed.upload).searchParams.get("X-Amz-Signature")).toBe(
    "774c26f80bc9c56a65f618076f49d86204d1043e978a6b939c51907a22a0f6c8",
  )
  expect(new URL(signed.download).searchParams.get("X-Amz-Signature")).toBe(
    "4b013b12cafc66e531a607ee3fefc2a18bfd05e786f5a3f1acf8f13311faaf70",
  )
  expect(new URL(signed.upload).searchParams.get("X-Amz-Expires")).toBe("86400")
  expect(new URL(signed.upload).searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host")
  expect(JSON.stringify(signed)).not.toContain(env.TEST_S3_SECRET)
  const readOnly = MediaS3.sign(
    MediaS3.prepare(
      { ...storage, read_only: { access_key_id: "reader", secret_access_key: "reader-secret" } },
      "test.mp4",
    ),
    new Date("2013-05-24T00:00:00Z"),
  )
  expect(new URL(readOnly.download).searchParams.get("X-Amz-Credential")).toStartWith("reader/")
  expect(readOnly.upload).toBe(signed.upload)
})

test("storage validation rejects unsafe endpoints and dot-segment keys before signing", () => {
  const storage = ConfigMedia.resolve(settings, env, "image_to_video").storage!
  for (const endpoint of [
    "http://storage.example",
    "https://user:secret@storage.example",
    "https://storage.example?token=x",
    "https://storage.example/#fragment",
  ])
    expect(() => MediaS3.prepare({ ...storage, endpoint }, "test.mp4")).toThrow()
  for (const key_prefix of ["../escaped", "a/./b", "a/../b", "bad\nkey"])
    expect(() => MediaS3.prepare({ ...storage, key_prefix }, "test.mp4")).toThrow()
  expect(() => MediaS3.prepare(storage, "../bad.mp4")).toThrow()
})

test("invalid media selection marker is internal and survives Document roundtrip", () => {
  const document = new Config.Document({ type: "document", info: new Config.Info({}), mediaInvalid: true })
  const roundtrip = Schema.decodeUnknownSync(Config.Document)(Schema.encodeSync(Config.Document)(document))
  expect(roundtrip.mediaInvalid).toBe(true)
  expect(Object.keys(roundtrip.info)).not.toContain("mediaInvalid")
  expect(JSON.stringify(roundtrip)).not.toContain("secret_access_key")
})
