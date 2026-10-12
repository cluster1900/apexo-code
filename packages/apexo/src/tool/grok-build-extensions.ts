import { Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BackgroundJob } from "@/background/job"
import type * as Tool from "./tool"
import { NonNegativeInt, PositiveInt } from "@apexo/core/schema"

const MemoryParameters = Schema.Struct({
  operation: Schema.Literals(["read", "remember", "flush", "dream"]).annotate({
    description: "Memory operation to perform",
  }),
  content: Schema.optional(Schema.String).annotate({
    description: "The note to remember or append during flush",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Optional text filter for read",
  }),
})

const MonitorParameters = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command or script to monitor" }),
  description: Schema.String.annotate({ description: "Short description shown with monitor events" }),
  timeout_ms: Schema.optional(NonNegativeInt).annotate({
    description: "Stop after this many milliseconds; defaults to 10 hours",
  }),
  persistent: Schema.optional(Schema.Boolean).annotate({
    description: "Run until kill_task or the session ends",
  }),
})

const SchedulerCreateParameters = Schema.Struct({
  task_id: Schema.optional(Schema.String).annotate({ description: "Existing scheduled task to update" }),
  interval: Schema.optional(Schema.String).annotate({ description: "Interval such as 5m, 2h, or 1d" }),
  prompt: Schema.optional(Schema.String).annotate({ description: "Prompt to run on each scheduled fire" }),
  recurring: Schema.optional(Schema.Boolean).annotate({ description: "Whether to repeat; defaults to true" }),
  durable: Schema.optional(Schema.Boolean).annotate({
    description: "Keep the schedule metadata across future session turns",
  }),
  fire_immediately: Schema.optional(Schema.Boolean).annotate({
    description: "Run once immediately instead of waiting for the first interval",
  }),
})

const SchedulerDeleteParameters = Schema.Struct({
  task_id: Schema.String.annotate({ description: "Scheduled task ID returned by scheduler_create" }),
})

const SchedulerListParameters = Schema.Struct({})

const ImageGenParameters = Schema.Struct({
  prompt: Schema.String.annotate({ description: "Text description of the image to generate" }),
  aspect_ratio: Schema.optional(
    Schema.Literals(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]),
  ).annotate({ description: "Image aspect ratio" }),
})

const ImageToVideoParameters = Schema.Struct({
  image: Schema.String.annotate({ description: "Absolute image path or data URL to animate" }),
  prompt: Schema.optional(Schema.String).annotate({ description: "Motion or camera direction" }),
  duration: Schema.optional(PositiveInt).annotate({ description: "Video duration in seconds" }),
  resolution_name: Schema.optional(Schema.Literals(["480p", "720p"])).annotate({
    description: "Video resolution",
  }),
})

const Keyframe = Schema.Struct({
  image: Schema.String.annotate({ description: "Absolute image path or data URL" }),
  timestamp_s: Schema.Number.annotate({ description: "Keyframe timestamp in seconds" }),
})

const ReferenceToVideoParameters = Schema.Struct({
  prompt: Schema.String.annotate({ description: "Description of the desired video" }),
  images: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Reference image paths or data URLs" }),
  voices: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Preset voice identifiers" }),
  first_frame: Schema.optional(Schema.String).annotate({ description: "Pinned first-frame image" }),
  last_frame: Schema.optional(Schema.String).annotate({ description: "Pinned last-frame image" }),
  keyframes: Schema.optional(Schema.Array(Keyframe)).annotate({ description: "Pinned intermediate frames" }),
  aspect_ratio: Schema.optional(
    Schema.Literals(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]),
  ),
  duration: Schema.optional(PositiveInt),
  resolution_name: Schema.optional(Schema.Literals(["480p", "720p"])),
})

type ExtensionOptions = {
  background: BackgroundJob.Interface
  shell?: Tool.Def
  task?: Tool.Def
}

const DEFAULT_MONITOR_TIMEOUT_MS = 36_000_000
const MAX_MONITOR_TIMEOUT_MS = 36_000_000
const SCHEDULER_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function createExtensions(options: ExtensionOptions): Tool.Def[] {
  return [memoryTool(), mediaTool("image_gen", ImageGenParameters), mediaTool("image_to_video", ImageToVideoParameters), mediaTool("reference_to_video", ReferenceToVideoParameters), ...(options.shell ? [monitorTool(options.shell, options.background)] : []), ...(options.task ? schedulerTools(options.task, options.background) : [])]
}

function memoryTool(): Tool.Def {
  return {
    id: "memory",
    description:
      "Read, remember, flush, or consolidate durable workspace memory. Memory is stored outside the repository under ~/.grok/memory.",
    parameters: MemoryParameters,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(MemoryParameters)(args)
        const directory = workspaceDirectory(ctx)
        const file = memoryFile(directory)
        const current = yield* readText(file)
        if (input.operation === "read") {
          const output = input.query ? current.split("\n").filter((line) => line.toLowerCase().includes(input.query!.toLowerCase())).join("\n") : current
          return { title: "memory", metadata: { operation: "read", path: file }, output: output || "Memory is empty." }
        }
        if (input.operation === "remember") {
          if (!input.content?.trim()) return invalidMemory("remember requires content")
          const note = `- ${new Date().toISOString()} — ${input.content.trim()}`
          const next = current.trim() ? `${current.trim()}\n${note}\n` : `# Memory\n\n${note}\n`
          yield* writeText(file, next)
          return { title: "memory", metadata: { operation: "remember", path: file }, output: `Remembered in ${file}.` }
        }
        if (input.operation === "flush") {
          if (input.content?.trim()) {
            const note = `- ${new Date().toISOString()} — ${input.content.trim()}`
            yield* writeText(file, current.trim() ? `${current.trim()}\n${note}\n` : `# Memory\n\n${note}\n`)
          }
          return { title: "memory", metadata: { operation: "flush", path: file }, output: `Memory flushed to ${file}.` }
        }
        const lines = current.split("\n")
        const unique = Array.from(new Set(lines.filter((line) => line.trim())))
        const next = unique.length ? `${unique.join("\n")}\n` : "# Memory\n\n"
        yield* writeText(file, next)
        return { title: "memory", metadata: { operation: "dream", path: file }, output: `Memory consolidated in ${file}.` }
      }).pipe(Effect.orDie),
  }
}

function monitorTool(shell: Tool.Def, background: BackgroundJob.Interface): Tool.Def {
  return {
    id: "monitor",
    description:
      "Start a background monitor that runs a shell command. Use persistent=true for session-length watches and get_task_output or kill_task for lifecycle control.",
    parameters: MonitorParameters,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(MonitorParameters)(args)
        const timeout = input.persistent ? 365 * 24 * 60 * 60 * 1000 : (input.timeout_ms ?? DEFAULT_MONITOR_TIMEOUT_MS)
        if (!input.persistent && timeout > MAX_MONITOR_TIMEOUT_MS) {
          return invalidMonitor("timeout_ms cannot exceed 36,000,000 unless persistent=true")
        }
        yield* ctx.ask({ permission: "monitor", patterns: [input.command], always: ["*"], metadata: {} })
        const job = yield* background.start({
          type: "monitor",
          title: input.description,
          metadata: { ownerSessionId: ctx.sessionID, monitor: true, command: input.command, persistent: input.persistent === true },
          run: shell.execute(
            { command: input.command, timeout },
            { ...ctx, ask: () => Effect.void, metadata: () => Effect.void },
          ).pipe(Effect.map((result) => result.output)),
        })
        return {
          title: input.description,
          metadata: { task_id: job.id, status: job.status, persistent: input.persistent === true, timeout_ms: input.persistent ? 0 : timeout },
          output: `Monitor started (task ${job.id}). Use get_task_output to inspect it or kill_task to stop it.`,
        }
      }).pipe(Effect.orDie),
  }
}

function schedulerTools(task: Tool.Def, background: BackgroundJob.Interface): Tool.Def[] {
  const create: Tool.Def = {
    id: "scheduler_create",
    description:
      "Create or update a recurring prompt schedule. Intervals use s/m/h/d and must be at least 60 seconds. Schedules are process-local and expire after 7 days.",
    parameters: SchedulerCreateParameters,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(SchedulerCreateParameters)(args)
        if (input.recurring === false) return invalidScheduler("one-shot schedules are not supported; use a background command")
        const interval = input.interval ? parseInterval(input.interval) : undefined
        if (input.task_id && !input.prompt && interval === undefined) return invalidScheduler("provide interval and/or prompt when updating a task")
        if (!input.task_id && (!input.prompt?.trim() || interval === undefined)) return invalidScheduler("interval and prompt are required when creating a schedule")
        const existing = input.task_id ? yield* background.get(input.task_id) : undefined
        if (input.task_id && (!existing || !owns(existing, ctx.sessionID) || existing.metadata?.scheduler !== true)) {
          return invalidScheduler(`scheduled task ${input.task_id} was not found`)
        }
        if (existing) yield* background.cancel(existing.id)
        const id = input.task_id
        const prompt = input.prompt ?? String(existing?.metadata?.prompt ?? "")
        const seconds = interval ?? Number(existing?.metadata?.intervalSeconds ?? 0)
        const description = prompt.slice(0, 60) || "scheduled task"
        yield* ctx.ask({ permission: "scheduler_create", patterns: [description], always: ["*"], metadata: {} })
        const job = yield* background.start({
          id,
          type: "scheduler",
          title: description,
          metadata: {
            ownerSessionId: ctx.sessionID,
            scheduler: true,
            prompt,
            intervalSeconds: seconds,
            durable: input.durable === true,
            nextFireAt: Date.now() + (input.fire_immediately ? 0 : seconds * 1000),
            expiresAt: Date.now() + SCHEDULER_TTL_MS,
          },
          run: scheduledRun(task, ctx, prompt, seconds, input.fire_immediately === true, description),
        })
        return {
          title: description,
          metadata: { task_id: job.id, status: job.status, interval: `${seconds}s`, updated: Boolean(existing) },
          output: `${existing ? "Updated" : "Scheduled"} task ${job.id} every ${humanInterval(seconds)}${input.fire_immediately ? "; first run starts now" : ""}.`,
        }
      }).pipe(Effect.orDie),
  }
  const remove: Tool.Def = {
    id: "scheduler_delete",
    description: "Cancel a scheduled task by ID.",
    parameters: SchedulerDeleteParameters,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(SchedulerDeleteParameters)(args)
        const job = yield* background.get(input.task_id)
        if (!job || !owns(job, ctx.sessionID) || job.metadata?.scheduler !== true) {
          return { title: input.task_id, metadata: { task_id: input.task_id, status: "not_found" }, output: `No scheduled task ${input.task_id} found.` }
        }
        const result = yield* background.cancel(input.task_id)
        return { title: input.task_id, metadata: { task_id: input.task_id, status: result?.status ?? "not_found" }, output: `Scheduled task ${input.task_id} cancelled.` }
      }).pipe(Effect.orDie),
  }
  const list: Tool.Def = {
    id: "scheduler_list",
    description: "List active scheduled tasks with their IDs, prompts, intervals, and next fire times.",
    parameters: SchedulerListParameters,
    execute: (_, ctx) =>
      Effect.gen(function* () {
        const jobs = yield* background.list()
        const active = jobs.filter((job) => job.metadata?.scheduler === true && owns(job, ctx.sessionID) && job.status === "running")
        const output = active.length
          ? active.map((job) => `${job.id}: every ${humanInterval(Number(job.metadata?.intervalSeconds ?? 0))}; next ${new Date(Number(job.metadata?.nextFireAt ?? Date.now())).toISOString()}; ${String(job.metadata?.prompt ?? "")}`).join("\n")
          : "No active scheduled tasks."
        return { title: "scheduler_list", metadata: { count: active.length, task_ids: active.map((job) => job.id) }, output }
      }).pipe(Effect.orDie),
  }
  return [create, remove, list]
}

function scheduledRun(task: Tool.Def, ctx: Tool.Context, prompt: string, seconds: number, fireImmediately: boolean, description: string) {
  return Effect.gen(function* () {
    let first = fireImmediately
    let last = ""
    const deadline = Date.now() + SCHEDULER_TTL_MS
    while (Date.now() < deadline) {
      if (!first) yield* Effect.sleep(`${seconds * 1000} millis`)
      first = false
      const result = yield* task.execute(
        { description, prompt, subagent_type: "general", background: false },
        { ...ctx, ask: () => Effect.void, metadata: () => Effect.void },
      )
      last = result.output
      if (ctx.abort.aborted) return last
    }
    return last
  })
}

function mediaTool(id: "image_gen" | "image_to_video" | "reference_to_video", parameters: Schema.Decoder<unknown>): Tool.Def {
  return {
    id,
    description:
      id === "image_gen"
        ? "Generate an image from a text prompt and save it under .grok/images."
        : id === "image_to_video"
          ? "Generate a video from one source image and save it under .grok/videos."
          : "Generate a video from reference images, frames, and voices and save it under .grok/videos.",
    parameters,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(parameters)(args)
        const key = process.env.XAI_API_KEY ?? process.env.GROK_API_KEY
        if (!key) {
          return {
            title: id,
            metadata: { status: "configuration_required", tool: id },
            output: `${id} requires XAI_API_KEY (or GROK_API_KEY). Configure the key and retry.`,
          }
        }
        const validation = validateMediaInput(id, input)
        if (validation) return { title: id, metadata: { status: "invalid_request", tool: id }, output: validation }
        const directory = workspaceDirectory(ctx)
        const output = yield* Effect.tryPromise({
          try: () =>
            id === "image_gen"
              ? generateImage(directory, key, input as Schema.Schema.Type<typeof ImageGenParameters>)
              : generateVideo(directory, key, id, input),
          catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
        })
        return { title: id, metadata: { status: "completed", path: output }, output: `Saved ${id} output to ${output}.` }
      }).pipe(Effect.orDie),
  }
}

async function generateImage(directory: string, key: string, input: Schema.Schema.Type<typeof ImageGenParameters>) {
  const body = await requestJson(`${mediaBaseUrl()}/images/generations`, key, {
    model: "grok-imagine-image-quality",
    prompt: input.prompt,
    n: 1,
    aspect_ratio: input.aspect_ratio ?? "1:1",
    response_format: "b64_json",
  })
  const data = await mediaBytes(body, key)
  return saveMedia(directory, "images", "jpg", data)
}

async function generateVideo(directory: string, key: string, id: string, input: unknown) {
  const value = input as Record<string, unknown>
  const body: Record<string, unknown> = {
    model: "grok-imagine-video-1.5",
    prompt: typeof value.prompt === "string" ? value.prompt : "",
    duration: typeof value.duration === "number" ? value.duration : 6,
    resolution: typeof value.resolution_name === "string" ? value.resolution_name : "480p",
  }
  if (id === "image_to_video") body.image = await mediaReference(value.image)
  else {
    const images = Array.isArray(value.images) ? value.images : []
    const voices = Array.isArray(value.voices) ? value.voices : []
    body.images = await Promise.all(images.map((item) => mediaReference(String(item))))
    body.voices = voices
    if (value.first_frame) body.first_frame = await mediaReference(String(value.first_frame))
    if (value.last_frame) body.last_frame = await mediaReference(String(value.last_frame))
    const keyframes = Array.isArray(value.keyframes) ? value.keyframes : []
    if (keyframes.length > 0) body.keyframes = await Promise.all(keyframes.map(async (item) => ({ image: await mediaReference(String((item as Record<string, unknown>).image)), timestamp_s: (item as Record<string, unknown>).timestamp_s })))
    if (images.length === 0 && voices.length === 0 && !body.first_frame && !body.last_frame && keyframes.length === 0) throw new Error("reference_to_video requires images, voices, frames, or keyframes")
  }
  const started = await requestJson(`${mediaBaseUrl()}/videos/generations`, key, body)
  const requestID = stringField(started, "request_id") ?? stringField(started, "id")
  if (!requestID) throw new Error("Video API did not return a request_id")
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    const status = await requestJson(`${mediaBaseUrl()}/videos/${encodeURIComponent(requestID)}`, key, undefined, "GET")
    const state = stringField(status, "status")
    if (state === "done" || state === "completed") return saveMedia(directory, "videos", "mp4", await mediaBytes(status, key))
    if (state === "failed" || state === "error") throw new Error(stringField(status, "error") ?? "Video generation failed")
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error("Video generation timed out after 5 minutes")
}

function mediaBaseUrl() {
  return (process.env.XAI_BASE_URL ?? "https://api.x.ai/v1").replace(/\/$/, "")
}

function validateMediaInput(id: "image_gen" | "image_to_video" | "reference_to_video", input: unknown) {
  if (typeof input !== "object" || input === null) return "Media input must be an object."
  const value = input as Record<string, unknown>
  if (id === "image_gen") return typeof value.prompt !== "string" || !value.prompt.trim() ? "image_gen requires a non-empty prompt." : undefined
  if (id === "image_to_video") {
    if (typeof value.image !== "string" || !value.image.trim()) return "image_to_video requires an image path or data URL."
    if (value.duration !== undefined && value.duration !== 6 && value.duration !== 10) return "image_to_video duration must be 6 or 10 seconds."
    return undefined
  }
  const images = Array.isArray(value.images) ? value.images : []
  const voices = Array.isArray(value.voices) ? value.voices : []
  const keyframes = Array.isArray(value.keyframes) ? value.keyframes : []
  if (typeof value.prompt !== "string" || !value.prompt.trim()) return "reference_to_video requires a non-empty prompt."
  if (images.length === 0 && voices.length === 0 && !value.first_frame && !value.last_frame && keyframes.length === 0) return "reference_to_video requires images, voices, frames, or keyframes."
  if (images.length > 14) return "reference_to_video accepts at most 14 images."
  if (voices.length > 3) return "reference_to_video accepts at most 3 voices."
  if (keyframes.length > 4) return "reference_to_video accepts at most 4 keyframes."
  if (value.duration !== undefined && (typeof value.duration !== "number" || value.duration < 1 || value.duration > 15)) return "reference_to_video duration must be between 1 and 15 seconds."
  return undefined
}

async function requestJson(url: string, key: string, body?: unknown, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let value: unknown
  try {
    value = text ? JSON.parse(text) : {}
  } catch {
    value = { error: text }
  }
  if (!response.ok) throw new Error(`Media API ${response.status}: ${stringField(value, "error") ?? text.slice(0, 240)}`)
  return value
}

async function mediaBytes(value: unknown, key: string) {
  const item = Array.isArray((value as { data?: unknown })?.data) ? ((value as { data: unknown[] }).data[0] as Record<string, unknown> | undefined) : undefined
  const b64 = stringField(item, "b64_json")
  if (b64) return Buffer.from(b64, "base64")
  const url = stringField(item, "url") ?? stringField(value, "video_url") ?? stringField(value, "url")
  if (!url) throw new Error("Media API returned no media data")
  const response = await fetch(url, { headers: { authorization: `Bearer ${key}` } })
  if (!response.ok) throw new Error(`Media download failed with HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function mediaReference(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Media reference must be a non-empty path or data URL")
  if (value.startsWith("data:")) return value
  const bytes = await readFile(value)
  const extension = path.extname(value).toLowerCase()
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg"
  return `data:${mime};base64,${bytes.toString("base64")}`
}

async function saveMedia(directory: string, folder: string, extension: string, bytes: Uint8Array) {
  const target = path.join(directory, ".grok", folder)
  await mkdir(target, { recursive: true })
  const name = `${Date.now()}-${createHash("sha1").update(bytes).digest("hex").slice(0, 8)}.${extension}`
  const file = path.join(target, name)
  await writeFile(file, bytes)
  return file
}

function stringField(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) return undefined
  const result = (value as Record<string, unknown>)[key]
  return typeof result === "string" ? result : undefined
}

function workspaceDirectory(ctx: Tool.Context) {
  return typeof ctx.extra?.directory === "string" ? ctx.extra.directory : (process.env.APEXO_WORKDIR ?? process.cwd())
}

function memoryFile(directory: string) {
  const name = `${path.basename(directory).replace(/[^a-zA-Z0-9._-]/g, "-") || "workspace"}-${createHash("sha256").update(directory).digest("hex").slice(0, 8)}`
  return path.join(os.homedir(), ".grok", "memory", name, "MEMORY.md")
}

function readText(file: string) {
  return Effect.promise(() => readFile(file, "utf8").catch(() => ""))
}

function writeText(file: string, content: string) {
  return Effect.promise(() => mkdir(path.dirname(file), { recursive: true }).then(() => writeFile(file, content)))
}

function parseInterval(value: string): number | undefined {
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)[ ]*([smhd])$/)
  if (!match) return undefined
  const amount = Number(match[1])
  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[match[2] as "s" | "m" | "h" | "d"]
  const seconds = Math.round(amount * multiplier)
  if (seconds < 60) return undefined
  return seconds
}

function humanInterval(seconds: number) {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

function owns(job: BackgroundJob.Info, sessionID: string) {
  return job.metadata?.parentSessionId === sessionID || job.metadata?.sessionID === sessionID || job.metadata?.ownerSessionId === sessionID
}

function invalidMemory(output: string) {
  return { title: "memory", metadata: { status: "invalid_request" }, output }
}

function invalidMonitor(output: string) {
  return { title: "monitor", metadata: { status: "invalid_request" }, output }
}

function invalidScheduler(output: string) {
  return { title: "scheduler_create", metadata: { status: "invalid_request" }, output }
}
