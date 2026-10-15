export * as GrokBuildMedia from "./grok-build-media"

import { Effect, Schema } from "effect"
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout } from "node:timers/promises"
import type { ConfigGrokMedia } from "@apexo/core/config/grok-media"
import { presign } from "./grok-media-s3"
import { Tool } from "./tool"
import { PositiveInt } from "@apexo/core/schema"

const AspectRatio = Schema.Literals(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"])
const Image = Schema.String.annotate({ description: "Image path, HTTPS URL, or data:image URL" })
const Keyframe = Schema.Struct({ image: Image, timestamp_s: Schema.Number })
const EditParameters = Schema.Struct({
  prompt: Schema.String,
  image: Schema.Array(Image),
  aspect_ratio: Schema.optional(Schema.String),
})
const ImageParameters = Schema.Struct({ prompt: Schema.String, aspect_ratio: Schema.optional(Schema.String) })
const VideoParameters = Schema.Struct({
  image: Image,
  prompt: Schema.optional(Schema.String),
  duration: Schema.optional(PositiveInt),
  resolution_name: Schema.optional(Schema.Literals(["480p", "720p"])),
})
const ReferenceParameters = Schema.Struct({
  prompt: Schema.String,
  images: Schema.optional(Schema.Array(Image)),
  voices: Schema.optional(Schema.Array(Schema.String)),
  first_frame: Schema.optional(Image),
  last_frame: Schema.optional(Image),
  keyframes: Schema.optional(Schema.Array(Keyframe)),
  aspect_ratio: AspectRatio,
  duration: Schema.optional(PositiveInt),
  resolution_name: Schema.optional(Schema.Literals(["480p", "720p"])),
})

export type Options = {
  outputS3?: ConfigGrokMedia.OutputS3
  key?: Effect.Effect<string | undefined>
  transport?: Effect.Effect<{ key: string; fetch?: typeof fetch; baseURL?: string } | undefined>
  baseURL?: string
  pollMs?: number
  timeoutMs?: number
}

type Media = { bytes: Buffer; mime: string; extension: string }

export function tools(options: Options = {}): Tool.Def[] {
  return [
    define("image_gen", ImageParameters, options, async (input, request) => {
      if (!input.prompt.trim()) throw new Error("image_gen requires a non-empty prompt")
      return request.image({
        model: "grok-imagine-image-quality",
        prompt: input.prompt,
        n: 1,
        aspect_ratio: input.aspect_ratio ?? "auto",
        resolution: "1k",
        response_format: "b64_json",
      })
    }),
    define(
      "image_to_video",
      VideoParameters,
      options,
      async (input, request) => {
        if (input.duration !== undefined && ![6, 10].includes(input.duration))
          throw new Error("image_to_video duration must be 6 or 10 seconds")
        return request.video({
          model: "grok-imagine-video-1.5",
          prompt: input.prompt ?? "",
          image: await request.reference(input.image),
          duration: input.duration ?? 6,
          resolution: input.resolution_name ?? "480p",
        })
      },
      (input) => [input.image],
    ),
    define(
      "reference_to_video",
      ReferenceParameters,
      options,
      async (input, request) => {
        const images = input.images ?? []
        const voices = input.voices ?? []
        const keyframes = input.keyframes ?? []
        const duration = input.duration ?? 6
        if (!input.prompt.trim()) throw new Error("reference_to_video requires a non-empty prompt")
        if (!images.length && !voices.length && !input.first_frame && !input.last_frame && !keyframes.length)
          throw new Error("At least one reference image, voice, or pinned frame is required")
        if (voices.some((voice) => !voice.trim())) throw new Error("Voice identifiers must not be empty")
        if (images.length > 14 || voices.length > 3 || keyframes.length > 4)
          throw new Error("Maximum references: 14 images, 3 voices, 4 keyframes")
        if (duration < 1 || duration > 15) throw new Error("reference_to_video duration must be 1–15 seconds")
        const times = keyframes.map((frame) => Math.round(frame.timestamp_s * 3)).toSorted((a, b) => a - b)
        if (
          times.some(
            (time, index) => !Number.isFinite(time) || time <= 0 || time >= duration * 3 || time === times[index - 1],
          )
        )
          throw new Error("Keyframes must be distinct on the 1/3-second grid and strictly inside the clip")
        return request.video({
          model: "grok-imagine-video-1.5",
          prompt: input.prompt,
          duration,
          resolution: input.resolution_name ?? "480p",
          aspect_ratio: input.aspect_ratio,
          ...(images.length ? { reference_images: await Promise.all(images.map(request.reference)) } : {}),
          ...(voices.length ? { reference_audios: voices.map((voice_id) => ({ voice_id })) } : {}),
          ...(input.first_frame ? { image: await request.reference(input.first_frame) } : {}),
          ...(input.last_frame ? { last_frame: await request.reference(input.last_frame) } : {}),
          ...(keyframes.length
            ? {
                keyframes: await Promise.all(
                  keyframes.map(async (frame) => ({
                    image: await request.reference(frame.image),
                    timestamp_s: Math.round(frame.timestamp_s * 3) / 3,
                  })),
                ),
              }
            : {}),
        })
      },
      (input) => [
        ...(input.images ?? []),
        ...(input.first_frame ? [input.first_frame] : []),
        ...(input.last_frame ? [input.last_frame] : []),
        ...(input.keyframes ?? []).map((frame) => frame.image),
      ],
    ),
    define(
      "image_edit",
      EditParameters,
      options,
      async (input, request) => {
        if (!input.prompt.trim()) throw new Error("image_edit requires a non-empty prompt")
        if (!input.image.length) throw new Error("image_edit requires at least one reference image")
        const images = await Promise.all(input.image.map(request.reference))
        return request.image(
          {
            model: "grok-imagine-image-quality",
            prompt: input.prompt,
            n: 1,
            resolution: "1k",
            response_format: "b64_json",
            ...(images.length === 1 ? { image: images[0] } : { images, aspect_ratio: input.aspect_ratio ?? "auto" }),
          },
          "/images/edits",
        )
      },
      (input) => [...input.image],
    ),
  ]
}

function define<S extends Schema.Decoder<unknown>>(
  id: string,
  parameters: S,
  options: Options,
  generate: (input: S["Type"], request: ReturnType<typeof client>) => Promise<Media>,
  references: (input: S["Type"]) => string[] = () => [],
): Tool.Def {
  return {
    id,
    description: `Generate ${id === "image_gen" || id === "image_edit" ? "an image" : "a video"} using xAI Imagine. Save it in this session's .grok folder and return a preview attachment. Requires xAI credentials.`,
    parameters,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(parameters)(args)
        const transport = options.transport ? yield* options.transport : undefined
        const key =
          transport?.key ??
          (yield* options.key ?? Effect.sync(() => process.env.XAI_API_KEY ?? process.env.GROK_API_KEY))
        if (!key)
          return {
            title: id,
            metadata: { status: "configuration_required" },
            output: "Connect xAI in provider settings, or configure XAI_API_KEY/GROK_API_KEY, then retry.",
          }
        const directory = typeof ctx.extra?.directory === "string" ? ctx.extra.directory : process.cwd()
        const folder = path.join(
          directory,
          ".grok",
          "sessions",
          ctx.sessionID.replace(/[^a-zA-Z0-9_-]/g, "_"),
          id === "image_gen" || id === "image_edit" ? "images" : "videos",
        )
        const name = randomUUID()
        const targets = new Map(
          (id === "image_gen" || id === "image_edit" ? ["png", "jpg"] : ["mp4"]).map((extension) => [
            extension,
            path.join(folder, `${name}.${extension}`),
          ]),
        )
        yield* ctx.ask({ permission: id, patterns: [id], always: [id], metadata: {} })
        // Authorize actual candidate resources before billed work. A directory
        // wildcard is a saved-policy pattern, not the output being authorized.
        yield* ctx.ask({
          permission: "edit",
          patterns: [...targets.values()],
          always: [...targets.values()],
          metadata: {},
        })
        const local = references(input)
          .map((value) => attachment(value, ctx))
          .filter((value) => !value.startsWith("https://") && !/^data:image\//.test(value))
        for (const value of new Set(local)) {
          const file = yield* Effect.promise(() => realpath(path.resolve(directory, value)))
          const relative = path.relative(directory, file)
          if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            yield* ctx.ask({
              permission: "external_directory",
              patterns: [path.join(path.dirname(file), "*")],
              always: [path.join(path.dirname(file), "*")],
              metadata: { filepath: file },
            })
          }
          yield* ctx.ask({ permission: "read", patterns: [file], always: [file], metadata: { filepath: file } })
        }
        const result = yield* Effect.tryPromise({
          try: async (signal) => {
            const abort = AbortSignal.any([signal, ctx.abort, AbortSignal.timeout(options.timeoutMs ?? 300_000)])
            const request = client(
              { ...options, baseURL: transport?.baseURL ?? options.baseURL },
              key,
              directory,
              abort,
              transport?.fetch,
              (value) => attachment(value, ctx),
            )
            const media = await generate(input, request)
            abort.throwIfAborted()
            const file = targets.get(media.extension)
            if (!file) throw new Error("Media API returned an unsupported output format")
            await mkdir(folder, { recursive: true })
            const filename = path.basename(file)
            await writeFile(file, media.bytes)
            return {
              title: id,
              metadata: { status: "completed", path: file },
              output: `Saved ${id} output to ${file}.`,
              attachments: [
                {
                  type: "file" as const,
                  filename,
                  mime: media.mime,
                  url: `data:${media.mime};base64,${media.bytes.toString("base64")}`,
                },
              ],
            }
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }).pipe(
          Effect.catch((error) => Effect.succeed({ title: id, metadata: { status: "error" }, output: error.message })),
        )
        return result
      }).pipe(Effect.orDie),
  }
}

function client(
  options: Options,
  key: string,
  directory: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  resolve: (value: string) => string = (value) => value,
) {
  const baseURL = (options.baseURL ?? process.env.XAI_BASE_URL ?? "https://api.x.ai/v1").replace(/\/$/, "")
  const json = async (endpoint: string, body?: unknown): Promise<unknown> => {
    const response = await request(`${baseURL}${endpoint}`, {
      signal,
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) throw new Error(`xAI media API returned HTTP ${response.status}`)
    return response.json()
  }
  const download = async (url: string, storage = false) => {
    const target = new URL(url)
    if (
      target.protocol !== "https:" &&
      !(
        target.protocol === "http:" &&
        (target.origin === new URL(baseURL).origin ||
          (storage && options.outputS3 && target.origin === new URL(options.outputS3.endpoint).origin))
      )
    )
      throw new Error("Media download URL must use HTTPS")
    // Media URLs are usually signed CDN URLs. Never forward the API key there.
    const response = await fetch(target, { signal, redirect: "error" })
    if (!response.ok) throw new Error(`Media download failed with HTTP ${response.status}`)
    const size = Number(response.headers.get("content-length") ?? 0)
    if (size > 100 * 1024 * 1024) throw new Error("Generated media exceeds the 100 MB limit")
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 100 * 1024 * 1024) throw new Error("Generated media exceeds the 100 MB limit")
    return bytes
  }
  return {
    reference: async (reference: string) => {
      const value = resolve(reference)
      if (value.startsWith("https://") || /^data:image\/(png|jpeg|webp);base64,/.test(value)) return { url: value }
      const file = path.resolve(directory, value)
      const extension = path.extname(file).toLowerCase()
      const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg"
      return { url: `data:${mime};base64,${(await readFile(file)).toString("base64")}` }
    },
    image: async (body: unknown, endpoint = "/images/generations"): Promise<Media> => {
      const response = await json(endpoint, body)
      const data = field(response, "data")
      const item = Array.isArray(data) ? data[0] : undefined
      const b64 = field(item, "b64_json")
      const url = field(item, "url")
      const bytes =
        typeof b64 === "string" ? Buffer.from(b64, "base64") : typeof url === "string" ? await download(url) : undefined
      if (!bytes?.length) throw new Error("Image API returned no image data")
      const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      return { bytes, mime: png ? "image/png" : "image/jpeg", extension: png ? "png" : "jpg" }
    },
    video: async (body: Record<string, unknown>): Promise<Media> => {
      const storage = options.outputS3 ? presign(options.outputS3) : undefined
      const started = await json("/videos/generations", {
        ...body,
        ...(storage ? { output: { upload_url: storage.upload } } : {}),
      })
      const requestID = field(started, "request_id")
      if (typeof requestID !== "string") throw new Error("Video API returned no request_id")
      while (true) {
        signal.throwIfAborted()
        const status = await json(`/videos/${encodeURIComponent(requestID)}`)
        const state = field(status, "status")
        if (state === "done" || state === "completed") {
          const url = storage?.download ?? field(field(status, "video"), "url")
          if (typeof url !== "string") throw new Error("Video API returned no video.url")
          return { bytes: await download(url, !!storage), mime: "video/mp4", extension: "mp4" }
        }
        if (state !== "pending" && state !== "processing" && state !== "queued" && state !== "in_progress")
          throw new Error(`Video generation failed: ${String(state)}`)
        await setTimeout(options.pollMs ?? 2000, undefined, { signal })
      }
    },
  }
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined
  return Reflect.get(value, key)
}

function attachment(value: string, ctx: Tool.Context) {
  const match = value.match(/^\[Image #(\d+)\]$/i)
  if (!match) return value
  const images = ctx.messages
    .filter((message) => message.info.role === "user")
    .flatMap((message) => message.parts.filter((part) => part.type === "file" && part.mime.startsWith("image/")))
  const part = images[Number(match[1]) - 1]
  if (!part || part.type !== "file")
    throw new Error(`Missing attachment ${value}; ask the user to attach the image again`)
  if (part.url.startsWith("file://")) return fileURLToPath(part.url)
  return part.url
}
