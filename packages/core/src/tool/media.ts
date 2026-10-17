export * as MediaTools from "./media"

import { ToolFailure } from "@apexo/llm"
import { DateTime, Duration, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { CommandSandbox } from "../command-sandbox"
import { Config } from "../config"
import { ConfigMedia } from "../config/media"
import { MediaS3 } from "./media-s3"
import { Catalog } from "../catalog"
import { makeLocationNode } from "../effect/app-node"
import { LayerNodePlatform } from "../effect/app-node-platform"
import { FileMutation } from "../file-mutation"
import { Image } from "../image"
import { Integration } from "../integration"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { ProviderV2 } from "../provider"
import { AbsolutePath } from "../schema"
import { SessionLifecycle } from "../session/lifecycle"
import { SessionStore } from "../session/store"
import { collectBoundedResponseBody } from "./http-body"
import { ReadToolFileSystem } from "./read-filesystem"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

const Prompt = Schema.String.check(Schema.isMinLength(1))
const Aspect = Schema.Literals(["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"])
const Resolution = Schema.Literals(["480p", "720p"])
const Reference = Schema.String
const Keyframe = Schema.Struct({ image: Reference, timestamp_s: Schema.Finite })
export const ImageInput = Schema.Struct({ prompt: Prompt, aspect_ratio: Schema.optional(Aspect) })
export const EditInput = Schema.Struct({
  ...ImageInput.fields,
  image: Schema.Array(Reference).check(Schema.isMinLength(1)),
})
export const VideoInput = Schema.Struct({
  image: Reference,
  prompt: Schema.optional(Schema.String),
  duration: Schema.optional(Schema.Literals([6, 10])),
  resolution_name: Schema.optional(Resolution),
})
export const ReferenceInput = Schema.Struct({
  prompt: Prompt,
  images: Schema.optional(Schema.Array(Reference).check(Schema.isMaxLength(14))),
  voices: Schema.optional(Schema.Array(Prompt).check(Schema.isMaxLength(3))),
  first_frame: Schema.optional(Reference),
  last_frame: Schema.optional(Reference),
  keyframes: Schema.optional(Schema.Array(Keyframe).check(Schema.isMaxLength(4))),
  aspect_ratio: Schema.Literals(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]),
  duration: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(15))),
  resolution_name: Schema.optional(Resolution),
})
const Output = Schema.Struct({
  path: Schema.String,
  mime: Schema.String,
  preview: Schema.optional(Schema.String),
  previewMime: Schema.optional(Schema.String),
})
const Structured = Schema.Struct({ path: Schema.String, mime: Schema.String })
type Request =
  | { kind: "image_gen"; input: typeof ImageInput.Type }
  | { kind: "image_edit"; input: typeof EditInput.Type }
  | { kind: "image_to_video"; input: typeof VideoInput.Type }
  | { kind: "reference_to_video"; input: typeof ReferenceInput.Type }
const IMAGE_BYTES = 20 * 1024 * 1024
const VIDEO_BYTES = 100 * 1024 * 1024
const fail = (message: string) => new ToolFailure({ message })

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const catalog = yield* Catalog.Service
    const integrations = yield* Integration.Service
    const http = yield* HttpClient.HttpClient
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const reader = yield* ReadToolFileSystem.Service
    const images = yield* Image.Service
    const lifecycle = yield* SessionLifecycle.Service
    const sessions = yield* SessionStore.Service
    const config = yield* Config.Service
    const sandbox = yield* CommandSandbox.Service

    const execute = (request: Request, context: Tool.Context) =>
      Effect.gen(function* () {
        const claim = yield* lifecycle.capture(context.sessionID)
        yield* sandbox.assertNetwork(context.sessionID)
        const selection = (yield* config.entries()).findLast(
          (entry) => entry.type === "document" && (entry.mediaInvalid || entry.info.media !== undefined),
        )
        if (selection?.type === "document" && selection.mediaInvalid)
          return yield* fail("Invalid explicit media configuration; correct the selected configuration before retrying")
        const settings = selection?.type === "document" ? selection.info.media : undefined
        const provider = (yield* catalog.provider.available()).find((item) => item.id === ProviderV2.ID.make("xai"))
        const providerReasons = [
          ...(Array.isArray(provider?.request.body.team_blocked_reasons)
            ? provider.request.body.team_blocked_reasons.filter((item): item is string => typeof item === "string")
            : []),
          ...(Array.isArray(provider?.api.settings?.team_blocked_reasons)
            ? provider.api.settings.team_blocked_reasons.filter((item): item is string => typeof item === "string")
            : []),
        ]
        const providerClaims = {
          disable_zdr_incompatible_tools:
            provider?.request.body.disable_zdr_incompatible_tools === true ||
            provider?.api.settings?.disable_zdr_incompatible_tools === true,
          team_blocked_reasons: providerReasons,
        }
        const options = yield* Effect.try({
          try: () => ConfigMedia.resolve(settings, process.env, request.kind, providerClaims),
          catch: (error) =>
            error instanceof Error && error.message.includes("Zero Data Retention")
              ? fail(error.message)
              : fail("Invalid media configuration or unavailable storage credentials"),
        })
        if (request.kind !== "image_to_video" && !request.input.prompt.trim())
          return yield* fail("Media generation requires a non-empty prompt")
        if (request.kind === "reference_to_video") {
          const input = request.input
          if (
            !input.images?.length &&
            !input.voices?.length &&
            !input.first_frame &&
            !input.last_frame &&
            !input.keyframes?.length
          )
            return yield* fail("At least one image, voice or pinned frame is required")
          if (input.voices?.some((voice) => !voice.trim())) return yield* fail("Voice identifiers must not be empty")
          const ticks = (input.keyframes ?? []).map((frame) => Math.round(frame.timestamp_s * 3))
          if (
            ticks.some((tick) => tick <= 0 || tick >= (input.duration ?? 6) * 3) ||
            new Set(ticks).size !== ticks.length
          )
            return yield* fail("Keyframes must be distinct on the 1/3-second grid and strictly inside the clip")
        }
        const source = { type: "tool" as const, messageID: context.assistantMessageID, callID: context.toolCallID }
        const authorize = (action: string, resources: string[], save = resources) =>
          permission.assert({ action, resources, save, sessionID: context.sessionID, agent: context.agent, source })
        yield* authorize(request.kind, [request.kind])
        const video = request.kind === "image_to_video" || request.kind === "reference_to_video"
        const folder = `.grok/sessions/${encodeURIComponent(context.sessionID)}/${video ? "videos" : "images"}`
        const destination = yield* mutation.resolve({ path: folder, kind: "directory" })
        if (destination.externalDirectory)
          yield* authorize(
            "external_directory",
            [destination.externalDirectory.resource],
            [destination.externalDirectory.save],
          )
        const name = randomUUID()
        // The returned image format is unknown until the response. Authorize every
        // exact candidate before billed work; a deny on any candidate fails closed.
        const targets = yield* Effect.forEach(video ? ["mp4"] : ["png", "jpg", "webp"], (extension) =>
          Effect.gen(function* () {
            const target = yield* mutation.resolve({ path: `${folder}/${name}.${extension}`, kind: "file" })
            if (!target.canonical.startsWith(`${destination.canonical}/`))
              return yield* fail("Media output directory changed before generation")
            yield* authorize("edit", [target.resource])
            return { extension, target }
          }),
        )

        const storageConfig = options.storage
        const storage = storageConfig
          ? yield* Effect.try({
              try: () => MediaS3.prepare(storageConfig, `${name}.mp4`),
              catch: () => fail("Invalid video storage configuration"),
            })
          : undefined
        if (storage) yield* authorize("media_upload", [storage.resource])

        const reference = (value: string): Effect.Effect<{ url: string }, ToolFailure> =>
          Effect.gen(function* () {
            const match = value.match(/^\[Image #(\d+)\]$/i)
            const attachments = match
              ? (yield* sessions.context(context.sessionID)).flatMap((message) =>
                  message.type === "user" ? (message.files ?? []).filter((file) => file.mime.startsWith("image/")) : [],
                )
              : []
            const resolved = match ? attachments[Number(match[1]) - 1]?.uri : value
            if (!resolved) return yield* fail(`Missing attachment ${value}; attach the image again`)
            if (resolved.startsWith("https://")) {
              yield* Effect.try({ try: () => new URL(resolved), catch: () => fail("Invalid image URL") })
              return { url: resolved }
            }
            if (resolved.startsWith("data:")) {
              if (
                !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(resolved) ||
                resolved.length > (IMAGE_BYTES * 4) / 3 + 128
              )
                return yield* fail("Reference must be a bounded PNG, JPEG or WebP data URL")
              return { url: resolved }
            }
            if (/^[a-z]+:\/\//i.test(resolved) && !resolved.startsWith("file://"))
              return yield* fail("Reference URL must use HTTPS")
            const path = yield* Effect.try({
              try: () => (resolved.startsWith("file://") ? fileURLToPath(resolved) : resolved),
              catch: () => fail("Invalid reference path"),
            })
            yield* sandbox.assertRead(context.sessionID, path, path)
            const target = yield* mutation.resolve({ path, kind: "file" })
            yield* sandbox.assertRead(context.sessionID, target.canonical, path)
            if (target.externalDirectory)
              yield* authorize(
                "external_directory",
                [target.externalDirectory.resource],
                [target.externalDirectory.save],
              )
            yield* authorize("read", [target.resource])
            const content = yield* reader.read(AbsolutePath.make(target.canonical), target.resource)
            if (
              !("encoding" in content) ||
              content.encoding !== "base64" ||
              !["image/png", "image/jpeg", "image/webp"].includes(content.mime)
            )
              return yield* fail("Local references must be PNG, JPEG or WebP images")
            return { url: `data:${content.mime};base64,${content.content}` }
          }).pipe(
            Effect.mapError((error) => (error instanceof ToolFailure ? error : fail("Unable to read media reference"))),
          )

        const body = yield* Effect.gen(function* () {
          if (request.kind === "image_gen")
            return {
              model: options.model,
              prompt: request.input.prompt,
              n: 1,
              aspect_ratio: request.input.aspect_ratio ?? "auto",
              resolution: "1k",
              response_format: "b64_json",
            }
          if (request.kind === "image_edit") {
            const refs = yield* Effect.forEach(request.input.image, reference)
            return {
              model: options.model,
              prompt: request.input.prompt,
              n: 1,
              resolution: "1k",
              response_format: "b64_json",
              ...(refs.length === 1
                ? { image: refs[0] }
                : { images: refs, aspect_ratio: request.input.aspect_ratio ?? "auto" }),
            }
          }
          if (request.kind === "image_to_video")
            return {
              model: options.model,
              image: yield* reference(request.input.image),
              prompt: request.input.prompt ?? "",
              duration: request.input.duration ?? 6,
              resolution: request.input.resolution_name ?? "480p",
            }
          const input = request.input
          return {
            model: options.model,
            prompt: input.prompt,
            duration: input.duration ?? 6,
            resolution: input.resolution_name ?? "480p",
            aspect_ratio: input.aspect_ratio,
            ...(input.images?.length ? { reference_images: yield* Effect.forEach(input.images, reference) } : {}),
            ...(input.voices?.length ? { reference_audios: input.voices.map((voice_id) => ({ voice_id })) } : {}),
            ...(input.first_frame ? { image: yield* reference(input.first_frame) } : {}),
            ...(input.last_frame ? { last_frame: yield* reference(input.last_frame) } : {}),
            ...(input.keyframes?.length
              ? {
                  keyframes: yield* Effect.forEach(input.keyframes, (frame) =>
                    reference(frame.image).pipe(
                      Effect.map((image) => ({ image, timestamp_s: Math.round(frame.timestamp_s * 3) / 3 })),
                    ),
                  ),
                }
              : {}),
          }
        })
        if (!provider || provider.disabled) return yield* fail("Connect an enabled xAI provider to generate media")
        const connection = yield* integrations.connection.active(provider.integrationID ?? Integration.ID.make("xai"))
        const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
        const key =
          credential?.type === "key" ? credential.key : (provider.request.body.apiKey ?? provider.api.settings?.apiKey)
        if (typeof key !== "string" || !key) return yield* fail("Configure an xAI API key to generate media")
        const base = yield* Effect.try({
          try: () => new URL(provider.api.url ?? "https://api.x.ai/v1"),
          catch: () => fail("Invalid xAI media endpoint"),
        })
        if (
          base.protocol !== "https:" &&
          !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
        )
          return yield* fail("Media endpoint must use HTTPS")
        const endpoint = base.toString().replace(/\/$/, "")
        const response = (url: string, payload?: unknown) =>
          Effect.gen(function* () {
            const request =
              payload === undefined
                ? HttpClientRequest.get(url)
                : yield* HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(payload))
            const response = yield* http.execute(
              request.pipe(
                HttpClientRequest.setHeaders({ ...provider.request.headers, authorization: `Bearer ${key}` }),
              ),
            )
            if (response.status < 200 || response.status >= 300)
              return yield* fail(`Media API returned HTTP ${response.status}`)
            const bytes = yield* collectBoundedResponseBody(
              response,
              video ? 1024 * 1024 : Math.ceil((IMAGE_BYTES * 4) / 3) + 1024 * 1024,
              () => fail("Media response exceeds the size limit"),
            )
            return yield* Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)(new TextDecoder().decode(bytes))
          }).pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }))
        const download = (url: string, storageOrigin?: string) =>
          Effect.gen(function* () {
            const target = yield* Effect.try({
              try: () => new URL(url),
              catch: () => fail("Invalid media download URL"),
            })
            if (
              target.protocol !== "https:" &&
              !(target.protocol === "http:" && (target.origin === base.origin || target.origin === storageOrigin))
            )
              return yield* fail("Media download URL must use HTTPS")
            // Signed download URLs never inherit provider credentials or configured headers.
            const response = yield* http.execute(HttpClientRequest.get(target.toString()))
            if (response.status < 200 || response.status >= 300)
              return yield* fail(`Media download returned HTTP ${response.status}`)
            return yield* collectBoundedResponseBody(response, video ? VIDEO_BYTES : IMAGE_BYTES, () =>
              fail("Generated media exceeds the size limit"),
            )
          }).pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }))
        const media = yield* Effect.gen(function* () {
          if (!video) {
            const result = yield* response(
              `${endpoint}${request.kind === "image_edit" ? "/images/edits" : "/images/generations"}`,
              body,
            )
            const data = field(result, "data")
            const item = Array.isArray(data) ? data[0] : undefined
            const encoded = field(item, "b64_json")
            const url = field(item, "url")
            const bytes =
              typeof encoded === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
                ? Buffer.from(encoded, "base64")
                : typeof url === "string"
                  ? yield* download(url)
                  : undefined
            if (!bytes?.length || bytes.length > IMAGE_BYTES)
              return yield* fail("Image API returned invalid or oversized image data")
            const format = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              ? { mime: "image/png", extension: "png" }
              : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
                ? { mime: "image/jpeg", extension: "jpg" }
                : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
                  ? { mime: "image/webp", extension: "webp" }
                  : undefined
            if (!format) return yield* fail("Image API returned an unsupported image format")
            const preview = yield* images.normalize("generated image", {
              uri: "",
              content: bytes.toString("base64"),
              encoding: "base64",
              mime: format.mime,
            })
            return {
              bytes,
              ...format,
              preview: preview.content,
              previewMime: preview.mime,
            }
          }
          const uploadUrl = storage ? MediaS3.signUpload(storage, yield* DateTime.nowAsDate) : undefined
          const started = yield* response(`${endpoint}/videos/generations`, {
            ...body,
            ...(uploadUrl ? { output: { upload_url: uploadUrl } } : {}),
          })
          const id = field(started, "request_id")
          if (typeof id !== "string" || !id) return yield* fail("Video API returned no request identifier")
          while (true) {
            const result = yield* response(`${endpoint}/videos/${encodeURIComponent(id)}`)
            const status = field(result, "status")
            if (status === "done" || status === "completed") {
              const url = storage
                ? MediaS3.signDownload(storage, yield* DateTime.nowAsDate)
                : field(field(result, "video"), "url")
              if (typeof url !== "string") return yield* fail("Video API returned no output URL")
              const bytes = yield* download(url, storage?.url.origin)
              if (bytes.length < 12 || bytes.subarray(4, 8).toString() !== "ftyp")
                return yield* fail("Video API returned invalid MP4 data")
              return { bytes, mime: "video/mp4", extension: "mp4", preview: undefined, previewMime: undefined }
            }
            if (!["pending", "processing", "queued", "in_progress"].includes(String(status)))
              return yield* fail("Video generation failed")
            yield* Effect.sleep(Duration.seconds(2))
          }
        }).pipe(
          Effect.timeoutOrElse({
            duration: Duration.minutes(5),
            orElse: () => Effect.fail(fail("Media generation timed out")),
          }),
        )
        const reserved = targets.find((candidate) => candidate.extension === media.extension)
        if (!reserved) return yield* fail("Media API returned an unsupported output format")
        const target = yield* mutation.resolve({ path: `${folder}/${name}.${media.extension}`, kind: "file" })
        if (target.canonical !== reserved.target.canonical || target.resource !== reserved.target.resource)
          return yield* fail("Media output directory changed during generation")
        yield* lifecycle.owned(claim, lifecycle.use(context.sessionID, files.create({ target, content: media.bytes })))
        return { path: target.canonical, mime: media.mime, preview: media.preview, previewMime: media.previewMime }
      }).pipe(Effect.mapError((error) => (error instanceof ToolFailure ? error : fail("Media operation failed"))))

    const projection = {
      output: Output,
      structured: Structured,
      toStructuredOutput: ({ output }: { output: typeof Output.Type }) => ({ path: output.path, mime: output.mime }),
      toModelOutput: ({ output }: { output: typeof Output.Type }): readonly Tool.Content[] => [
        { type: "text", text: `Saved media to ${output.path}` },
        ...(output.preview
          ? [
              {
                type: "file" as const,
                data: output.preview,
                mime: output.previewMime ?? output.mime,
                name: output.path,
              },
            ]
          : []),
      ],
    }
    yield* tools
      .register({
        image_gen: Tool.make({
          ...projection,
          description:
            "Generate one image from a text prompt using xAI Imagine. Saves the image and returns a preview.",
          input: ImageInput,
          execute: (input, context) => execute({ kind: "image_gen", input }, context),
        }),
        image_edit: Tool.make({
          ...projection,
          description:
            "Edit one or more images using xAI Imagine. References may be local image paths, HTTPS URLs, data URLs or [Image #N] user attachments.",
          input: EditInput,
          execute: (input, context) => execute({ kind: "image_edit", input }, context),
        }),
        image_to_video: Tool.make({
          ...projection,
          description: "Animate one image into a 6 or 10 second video. Saves an MP4 and returns its path.",
          input: VideoInput,
          execute: (input, context) => execute({ kind: "image_to_video", input }, context),
        }),
        reference_to_video: Tool.make({
          ...projection,
          description:
            "Generate a video from reference images, preset voices or pinned frames. Requires at least one reference. Saves an MP4 and returns its path.",
          input: ReferenceInput,
          execute: (input, context) => execute({ kind: "reference_to_video", input }, context),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined
}

export const node = makeLocationNode({
  name: "tool/media",
  layer,
  deps: [
    ToolRegistry.node,
    PermissionV2.node,
    Catalog.node,
    Config.node,
    Integration.node,
    LayerNodePlatform.httpClient,
    LocationMutation.node,
    FileMutation.node,
    ReadToolFileSystem.node,
    Image.node,
    SessionLifecycle.node,
    SessionStore.node,
    CommandSandbox.node,
  ],
})
