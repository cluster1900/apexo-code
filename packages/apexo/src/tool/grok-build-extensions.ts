import { randomUUID } from "node:crypto"
import { GrokBuildMedia } from "./grok-build-media"
import { Clock, Effect, Schema } from "effect"
import { BackgroundJob } from "@/background/job"
import { Tool } from "./tool"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { NonNegativeInt } from "@apexo/core/schema"

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
    description: "Persist across process restarts; currently unsupported and rejected when true",
  }),
  fire_immediately: Schema.optional(Schema.Boolean).annotate({
    description: "Run once immediately instead of waiting for the first interval",
  }),
})

const SchedulerDeleteParameters = Schema.Struct({
  task_id: Schema.String.annotate({ description: "Scheduled task ID returned by scheduler_create" }),
})

const SchedulerListParameters = Schema.Struct({})

type ExtensionOptions = {
  directory?: string
  background: BackgroundJob.Interface
  shell?: Tool.Def
  task?: Tool.Def
  media?: GrokBuildMedia.Options
}

const DEFAULT_MONITOR_TIMEOUT_MS = 36_000_000
const MAX_MONITOR_TIMEOUT_MS = 36_000_000
const SCHEDULER_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function createExtensions(options: ExtensionOptions): Tool.Def[] {
  return [
    memoryTool(),
    ...GrokBuildMedia.tools(options.media),
    ...(options.shell ? [monitorTool(options.shell, options.background)] : []),
    ...(options.task ? schedulerTools(options.task, options.background) : []),
  ].map((tool) => ({
    ...tool,
    execute: (args, ctx) =>
      tool.execute(args, {
        ...ctx,
        extra: { ...ctx.extra, ...(options.directory ? { directory: options.directory } : {}) },
      }),
  }))
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
        const file = WorkspaceMemory.file(directory)
        yield* ctx.ask({
          permission: input.operation === "read" ? "read" : "edit",
          patterns: [file],
          always: [file],
          metadata: { operation: input.operation },
        })
        if (input.operation === "read") {
          const current = yield* Effect.promise(() => WorkspaceMemory.read(directory))
          const query = input.query?.toLowerCase()
          const output = query
            ? current
                .split("\n")
                .filter((line) => line.toLowerCase().includes(query))
                .join("\n")
            : current
          return {
            title: "memory",
            metadata: { operation: "read", path: file },
            output: output || (query ? "No matching memories." : "Memory is empty."),
          }
        }
        if (input.operation !== "dream" && !input.content?.trim())
          return invalidMemory(`${input.operation} requires content`)
        const output = yield* Effect.promise(() =>
          WorkspaceMemory.update(directory, { ...input, operation: input.operation as "remember" | "flush" | "dream" }),
        )
        return { title: "memory", metadata: { operation: input.operation, path: file }, output }
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
        const timeout = input.persistent ? 2_147_483_000 : input.timeout_ms || DEFAULT_MONITOR_TIMEOUT_MS
        if (!input.persistent && timeout > MAX_MONITOR_TIMEOUT_MS) {
          return invalidMonitor("timeout_ms cannot exceed 36,000,000 unless persistent=true")
        }
        yield* ctx.ask({ permission: "monitor", patterns: [input.command], always: ["*"], metadata: {} })
        const id = `job_${randomUUID()}`
        const job = yield* background.start({
          id,
          type: "monitor",
          title: input.description,
          metadata: {
            ownerSessionId: ctx.sessionID,
            monitor: true,
            command: input.command,
            persistent: input.persistent === true,
          },
          run: shell
            .execute(
              { command: input.command, description: input.description, timeout },
              {
                ...ctx,
                abort: new AbortController().signal,
                metadata: (value) =>
                  background.report({
                    id,
                    output: typeof value.metadata?.output === "string" ? value.metadata.output : undefined,
                    metadata: value.metadata,
                  }),
              },
            )
            .pipe(Effect.map((result) => result.output)),
        })
        return {
          title: input.description,
          metadata: {
            task_id: job.id,
            status: job.status,
            persistent: input.persistent === true,
            timeout_ms: input.persistent ? 0 : timeout,
          },
          output: `Monitor started (task ${job.id}). Use get_task_output to inspect it or kill_task to stop it.`,
        }
      }).pipe(Effect.orDie),
  }
}

function schedulerTools(task: Tool.Def, background: BackgroundJob.Interface): Tool.Def[] {
  const create: Tool.Def = {
    id: "scheduler_create",
    description:
      "Create or update a prompt schedule. Intervals use s/m/h/d and must be at least 60 seconds. Set recurring=false to run once. Schedules are process-local and expire after 7 days; durable=true is not supported.",
    parameters: SchedulerCreateParameters,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(SchedulerCreateParameters)(args)
        if (input.durable === true)
          return invalidScheduler("durable schedules are not supported by this process-local scheduler")
        const interval = input.interval ? parseInterval(input.interval) : undefined
        if (input.interval !== undefined && interval === undefined)
          return invalidScheduler("interval must be between 60 seconds and 7 days")
        if (input.prompt !== undefined && !input.prompt.trim()) return invalidScheduler("prompt must not be empty")
        if (
          input.task_id &&
          !input.prompt &&
          interval === undefined &&
          input.recurring === undefined &&
          !input.fire_immediately
        )
          return invalidScheduler("provide interval, prompt, recurring, or fire_immediately when updating a task")
        if (!input.task_id && (!input.prompt?.trim() || interval === undefined))
          return invalidScheduler("interval and prompt are required when creating a schedule")
        const existing = input.task_id ? yield* background.get(input.task_id) : undefined
        if (input.task_id && (!existing || !owns(existing, ctx.sessionID) || existing.metadata?.scheduler !== true)) {
          return invalidScheduler(`scheduled task ${input.task_id} was not found`)
        }
        const id = input.task_id ?? `job_${randomUUID()}`
        const prompt = input.prompt ?? String(existing?.metadata?.prompt ?? "")
        const seconds = interval ?? Number(existing?.metadata?.intervalSeconds ?? 0)
        const recurring = input.recurring ?? existing?.metadata?.recurring !== false
        const description = prompt.slice(0, 60) || "scheduled task"
        yield* ctx.ask({ permission: "scheduler_create", patterns: [description], always: ["*"], metadata: {} })
        if (existing) yield* background.cancel(existing.id)
        const now = yield* Clock.currentTimeMillis
        const job = yield* background.start({
          id,
          type: "scheduler",
          title: description,
          metadata: {
            ownerSessionId: ctx.sessionID,
            scheduler: true,
            prompt,
            intervalSeconds: seconds,
            durable: false,
            recurring,
            nextFireAt: now + (input.fire_immediately ? 0 : seconds * 1000),
            expiresAt: now + SCHEDULER_TTL_MS,
          },
          run: scheduledRun(
            task,
            background,
            id,
            ctx,
            prompt,
            seconds,
            input.fire_immediately === true,
            description,
            recurring,
            now + SCHEDULER_TTL_MS,
          ),
        })
        return {
          title: description,
          metadata: { task_id: job.id, status: job.status, interval: `${seconds}s`, updated: Boolean(existing) },
          output: `${existing ? "Updated" : "Scheduled"} task ${job.id} ${recurring ? "every" : "once after"} ${humanInterval(seconds)}${input.fire_immediately ? "; first run starts now" : ""}.`,
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
          return {
            title: input.task_id,
            metadata: { task_id: input.task_id, status: "not_found" },
            output: `No scheduled task ${input.task_id} found.`,
          }
        }
        const result = yield* background.cancel(input.task_id)
        return {
          title: input.task_id,
          metadata: { task_id: input.task_id, status: result?.status ?? "not_found" },
          output: `Scheduled task ${input.task_id} cancelled.`,
        }
      }).pipe(Effect.orDie),
  }
  const list: Tool.Def = {
    id: "scheduler_list",
    description: "List active scheduled tasks with their IDs, prompts, intervals, and next fire times.",
    parameters: SchedulerListParameters,
    execute: (_, ctx) =>
      Effect.gen(function* () {
        const jobs = yield* background.list()
        const active = jobs.filter(
          (job) => job.metadata?.scheduler === true && owns(job, ctx.sessionID) && job.status === "running",
        )
        const output = active.length
          ? active
              .map(
                (job) =>
                  `${job.id}: ${job.metadata?.recurring === false ? "once after" : "every"} ${humanInterval(Number(job.metadata?.intervalSeconds ?? 0))}; next ${new Date(Number(job.metadata?.nextFireAt ?? Date.now())).toISOString()}; ${String(job.metadata?.prompt ?? "")}`,
              )
              .join("\n")
          : "No active scheduled tasks."
        return {
          title: "scheduler_list",
          metadata: { count: active.length, task_ids: active.map((job) => job.id) },
          output,
        }
      }).pipe(Effect.orDie),
  }
  return [create, remove, list]
}

function scheduledRun(
  task: Tool.Def,
  background: BackgroundJob.Interface,
  id: string,
  ctx: Tool.Context,
  prompt: string,
  seconds: number,
  fireImmediately: boolean,
  description: string,
  recurring: boolean,
  deadline: number,
) {
  return Effect.gen(function* () {
    let fireAt = deadline - SCHEDULER_TTL_MS + (fireImmediately ? 0 : seconds * 1000)
    let last = ""
    // Anchor the first fire to creation, not background-fiber dispatch time.
    // Timer delay must not skip the last eligible fire at the seven-day limit.
    while (fireAt <= deadline) {
      const delay = fireAt - (yield* Clock.currentTimeMillis)
      if (delay > 0) yield* Effect.sleep(delay)
      const result = yield* task.execute(
        { description, prompt, subagent_type: "general", background: false },
        { ...ctx, abort: new AbortController().signal, metadata: () => Effect.void },
      )
      last = result.output
      const now = yield* Clock.currentTimeMillis
      fireAt = now + seconds * 1000
      yield* background.report({
        id,
        output: last,
        metadata: {
          lastFireAt: now,
          nextFireAt: fireAt,
        },
      })
      if (!recurring) return last
    }
    return last
  })
}

function workspaceDirectory(ctx: Tool.Context) {
  return typeof ctx.extra?.directory === "string" ? ctx.extra.directory : (process.env.APEXO_WORKDIR ?? process.cwd())
}

function parseInterval(value: string): number | undefined {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)[ ]*([smhd])$/)
  if (!match) return undefined
  const amount = Number(match[1])
  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[match[2] as "s" | "m" | "h" | "d"]
  const seconds = Math.round(amount * multiplier)
  if (!Number.isFinite(seconds) || seconds < 60 || seconds > SCHEDULER_TTL_MS / 1000) return undefined
  return seconds
}

function humanInterval(seconds: number) {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

function owns(job: BackgroundJob.Info, sessionID: string) {
  return (
    job.metadata?.parentSessionId === sessionID ||
    job.metadata?.sessionID === sessionID ||
    job.metadata?.ownerSessionId === sessionID
  )
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
