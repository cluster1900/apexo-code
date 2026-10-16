import { randomUUID } from "node:crypto"
import { GrokBuildMedia } from "./grok-build-media"
import { Cause, Clock, Effect, Exit, Schema, Scope } from "effect"
import { BackgroundJob } from "@/background/job"
import { Tool } from "./tool"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { NonNegativeInt } from "@apexo/core/schema"
import { SchedulerStore } from "@apexo/core/scheduler-store"
import { Scheduler } from "@apexo/core/scheduler"
import { MonitorEvents } from "@apexo/core/monitor-events"
import { MemorySearch } from "@apexo/core/memory-search"
import { MemoryWork } from "@apexo/schema/memory-work"
import path from "node:path"

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
  scope: Schema.optional(Schema.Literals(["global", "workspace"])).annotate({
    description:
      "workspace (default) shares repository notes across clones/worktrees; global stores cross-project preferences",
  }),
})

const MemorySearchParameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Specific terms to find in saved memory" }),
  max_results: Schema.optional(Schema.NullOr(NonNegativeInt)).annotate({
    description: "Maximum results, default 6",
  }),
  min_score: Schema.optional(Schema.NullOr(Schema.Finite)).annotate({
    description: "Minimum normalized relevance score; default 0.7",
  }),
})
const MemoryGetParameters = Schema.Struct({
  path: Schema.String,
  from: Schema.optional(Schema.NullOr(NonNegativeInt)),
  lines: Schema.optional(Schema.NullOr(NonNegativeInt)),
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
    description: "Persist across sessions; creation-only. Schedules also resume when reopening their owning session",
  }),
  fire_immediately: Schema.optional(Schema.Boolean).annotate({
    description: "Run once immediately on creation; ignored when updating an existing task",
  }),
})

const SchedulerDeleteParameters = Schema.Struct({
  task_id: Schema.String.annotate({ description: "Scheduled task ID returned by scheduler_create" }),
})

const SchedulerListParameters = Schema.Struct({})

type ExtensionOptions = {
  directory?: string
  projectID?: string
  memory?: Effect.Effect<MemorySearch.Interface, MemorySearch.MemoryError>
  memoryAccess?: (ctx: Tool.Context, operation: Effect.Effect<string>) => Effect.Effect<string>
  dream?: (ctx: Tool.Context) => Effect.Effect<MemoryWork.Result>
  background: BackgroundJob.Interface
  scheduler?: Scheduler.Interface
  shell?: Tool.Def
  task?: Tool.Def
  media?: GrokBuildMedia.Options
}

const DEFAULT_MONITOR_TIMEOUT_MS = 36_000_000
const MAX_MONITOR_TIMEOUT_MS = 36_000_000

export function createExtensions(options: ExtensionOptions): Tool.Def[] {
  return [
    memoryTool(options),
    ...memoryRetrievalTools(options),
    ...GrokBuildMedia.tools(options.media),
    ...(options.shell ? [monitorTool(options.shell, options.background)] : []),
    ...(options.task
      ? schedulerTools(options.task, options.background, options.scheduler ?? Scheduler.make(options.background))
      : []),
  ].map((tool) => ({
    ...tool,
    execute: (args, ctx) =>
      tool.execute(args, {
        ...ctx,
        extra: { ...ctx.extra, ...(options.directory ? { directory: options.directory } : {}) },
      }),
  }))
}

function memoryRetrievalTools(options: ExtensionOptions): Tool.Def[] {
  return [
    {
      id: "memory_search",
      description:
        "Search cross-session memory for relevant knowledge in global preferences, this repository's notes, and session records. Returns ranked full-text matches with source paths and line numbers. Memory is historical context; verify facts against current sources.",
      parameters: MemorySearchParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const input = yield* Schema.decodeUnknownEffect(MemorySearchParameters)(args)
          const memory = yield* options.memory ??
            MemorySearch.make({ directory: workspaceDirectory(ctx), projectID: options.projectID })
          yield* ctx.ask({
            permission: "read",
            patterns: memory.roots.map((root) => path.join(root, "**")),
            always: memory.roots.map((root) => path.join(root, "**")),
            metadata: { query: input.query },
          })
          const result = yield* memory.search(input, (paths) =>
            ctx
              .ask({
                permission: "read",
                patterns: memory.accessPaths(paths),
                always: [],
                metadata: { query: input.query },
              })
              .pipe(Effect.orDie),
          )
          const output = result.results.length
            ? `Found ${result.results.length} memory result(s):\n${result.results.map((result, index) => `\n### Result ${index + 1} (score: ${result.score.toFixed(2)}, source: ${result.source})\n**File:** ${result.path} (lines ${result.start_line}-${result.end_line})\n${result.staleness ? `${result.staleness}\n` : ""}\`\`\`\n${result.snippet}\n\`\`\`\n`).join("")}`
            : "No memory results found for query."
          return {
            title: "memory_search",
            output: `${output}${result.skipped.length ? `\n${result.skipped.length} memory file(s) disappeared while indexing; retry to refresh.` : ""}`,
            metadata: {
              results: result.results,
              skipped: result.skipped.length,
              mode: result.mode,
              ...(result.fallback ? { fallback: result.fallback } : {}),
            },
          }
        }).pipe(Effect.scoped, Effect.orDie),
    },
    {
      id: "memory_get",
      description:
        "Read a memory file from this repository or global memory, with 1-based line numbers. Use a path returned by memory_search; optional from and lines select a range. Memory is historical context, not the current plan.",
      parameters: MemoryGetParameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const input = yield* Schema.decodeUnknownEffect(MemoryGetParameters)(args)
          const memory = yield* options.memory ??
            MemorySearch.make({ directory: workspaceDirectory(ctx), projectID: options.projectID })
          const target = yield* memory.resolve(input.path)
          yield* ctx.ask({
            permission: "read",
            patterns: memory.accessPaths([target]),
            always: memory.accessPaths([target]),
            metadata: { from: input.from, lines: input.lines },
          })
          const result = yield* memory.get({ ...input, path: target })
          return {
            title: "memory_get",
            output: `**File:** ${result.path}\n**Lines:** ${result.lines} (from: ${result.from}, limit: ${input.lines ?? "all"})\n\n${result.content}`,
            metadata: { path: result.path, from: result.from, lines: result.lines },
          }
        }).pipe(Effect.scoped, Effect.orDie),
    },
  ]
}

function memoryTool(options: ExtensionOptions): Tool.Def {
  return {
    id: "memory",
    description:
      "Read, remember, flush, or consolidate durable memory. Use scope=workspace (default) for repository knowledge shared across clones/worktrees, or scope=global for cross-project preferences. Memory is stored outside the repository under ~/.grok/memory.",
    parameters: MemoryParameters,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(MemoryParameters)(args)
        const directory = workspaceDirectory(ctx)
        const location = { projectID: options.projectID, scope: input.scope ?? "workspace" }
        if (input.operation === "dream") {
          if (input.scope === "global")
            return invalidMemory("Dream consolidates repository sessions; global preferences are kept separately.")
          if (!options.dream) return invalidMemory("Dream requires an active session model.")
          const result = yield* options.dream(ctx)
          return { title: "memory", metadata: { operation: "dream", ...result }, output: JSON.stringify(result) }
        }
        const file = WorkspaceMemory.file(directory, undefined, location)
        yield* ctx.ask({
          permission: input.operation === "read" ? "read" : "edit",
          patterns: [file],
          always: [file],
          metadata: { operation: input.operation, scope: location.scope },
        })
        if (input.operation === "read") {
          const read = Effect.promise(() => WorkspaceMemory.read(directory, undefined, location))
          const current = yield* options.memoryAccess ? options.memoryAccess(ctx, read) : read
          const query = input.query?.toLowerCase()
          const output = query
            ? current
                .split("\n")
                .filter((line) => line.toLowerCase().includes(query))
                .join("\n")
            : current
          return {
            title: "memory",
            metadata: { operation: "read", path: file, scope: location.scope },
            output: output || (query ? "No matching memories." : "Memory is empty."),
          }
        }
        if (!input.content?.trim()) return invalidMemory(`${input.operation} requires content`)
        const operation = input.operation
        const write = Effect.promise(() =>
          WorkspaceMemory.update(directory, { ...input, operation }, undefined, location),
        )
        const output = yield* options.memoryAccess ? options.memoryAccess(ctx, write) : write
        return { title: "memory", metadata: { operation: input.operation, path: file, scope: location.scope }, output }
      }).pipe(Effect.orDie),
  }
}

function monitorTool(shell: Tool.Def, background: BackgroundJob.Interface): Tool.Def {
  return {
    id: "monitor",
    description:
      "Start a background monitor. Each output line notifies and wakes this session. Filter output to meaningful events; excessive output is suppressed and sustained overload stops the monitor. Use persistent=true for session-length watches and kill_task to stop.",
    parameters: MonitorParameters,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(MonitorParameters)(args)
        const timeout = input.timeout_ms ?? DEFAULT_MONITOR_TIMEOUT_MS
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
          run: monitorRun(shell, background, id, { ...input, timeout }, ctx),
        })
        return {
          title: input.description,
          metadata: {
            task_id: job.id,
            status: job.status,
            persistent: input.persistent === true,
            timeout_ms: input.persistent ? 0 : timeout,
          },
          output: `Monitor started (task ${job.id}). Events will notify this session automatically. Use kill_task to stop it; an event is not a user reply.`,
        }
      }).pipe(Effect.orDie),
  }
}

function monitorRun(
  shell: Tool.Def,
  background: BackgroundJob.Interface,
  id: string,
  input: Schema.Schema.Type<typeof MonitorParameters> & { timeout: number },
  ctx: Tool.Context,
) {
  return Effect.gen(function* () {
    const scope = yield* Scope.Scope
    const events = MonitorEvents.create()
    const abort = new AbortController()
    const pending = { lines: [] as string[], scheduled: false, batches: 0 }
    const flush = Effect.fn("Monitor.flush")(function* (completion?: {
      failed: boolean
      output: string
      exit?: number
    }) {
      const lines = pending.lines.splice(0)
      pending.scheduled = false
      if ((!lines.length && !completion) || !ctx.notifyBackground) return
      const chars = Array.from(lines.length ? lines.join("\n") : (completion?.output ?? ""))
      yield* ctx.notifyBackground({
        taskID: id,
        type: "monitor",
        status: completion ? (completion.failed ? "error" : "completed") : "event",
        exit: completion?.exit,
        title: input.description,
        output:
          chars.slice(0, MonitorEvents.BATCH_LIMIT).join("") +
          (chars.length > MonitorEvents.BATCH_LIMIT ? "\n[batch truncated]" : ""),
      })
      yield* background.report({ id, metadata: { eventBatches: ++pending.batches } })
    })
    const consume = Effect.fn("Monitor.consume")(function* (chunk: string, end = false) {
      const batch = events.push(chunk, yield* Clock.currentTimeMillis, end)
      pending.lines.push(...batch.events)
      yield* background.report({ id, metadata: { lineCount: batch.lines, rateLimited: batch.stopped } })
      if (batch.stopped) abort.abort()
      if (!pending.lines.length || pending.scheduled) return
      pending.scheduled = true
      yield* Effect.sleep(MonitorEvents.DEBOUNCE_MS).pipe(Effect.andThen(flush()), Effect.forkIn(scope))
    })
    const result = yield* shell
      .execute(
        { command: input.command, description: input.description, timeout: input.timeout },
        {
          ...ctx,
          abort: abort.signal,
          extra: { ...ctx.extra, persistentMonitor: input.persistent === true },
          onOutput: (chunk) => consume(chunk),
          metadata: (value) =>
            background.report({
              id,
              output: typeof value.metadata?.output === "string" ? value.metadata.output : undefined,
              metadata: value.metadata,
            }),
        },
      )
      .pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
            ? flush({ failed: true, output: String(Cause.squash(exit.cause)) })
            : Effect.void,
        ),
      )
    yield* background.report({ id, metadata: result.metadata })
    yield* consume("", true)
    yield* flush({
      failed: abort.signal.aborted || result.metadata.exit !== 0,
      output: result.output,
      exit: typeof result.metadata.exit === "number" ? result.metadata.exit : undefined,
    })
    return result.output
  }).pipe(Effect.scoped)
}

function schedulerTools(
  task: Tool.Def,
  background: BackgroundJob.Interface,
  scheduler: Scheduler.Interface,
): Tool.Def[] {
  const create: Tool.Def = {
    id: "scheduler_create",
    description:
      "Create or update a prompt schedule. Intervals use s/m/h/d; positive intervals below 60 seconds are raised to 60 seconds. Set recurring=false to run once. Updates preserve timing and never cancel an in-flight fire. At most 50 tasks per session. Schedules are saved and resume when the workspace reopens; they expire after 7 days. durable=true explicitly requests persistent scheduling.",
    parameters: SchedulerCreateParameters,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const input = yield* Schema.decodeUnknownEffect(SchedulerCreateParameters)(args)
        const interval = input.interval ? parseInterval(input.interval, yield* Clock.currentTimeMillis) : undefined
        if (input.interval !== undefined && interval === undefined)
          return invalidScheduler(
            "interval must be a positive duration using s, m, h, or d within the supported timestamp range",
          )
        if (input.prompt !== undefined && !input.prompt.trim()) return invalidScheduler("prompt must not be empty")
        if (input.task_id && input.prompt === undefined && interval === undefined && input.recurring === undefined)
          return invalidScheduler("provide interval, prompt, or recurring when updating a task")
        if (!input.task_id && (!input.prompt?.trim() || interval === undefined))
          return invalidScheduler("interval and prompt are required when creating a schedule")
        const description = input.prompt?.slice(0, 60) || "scheduled task"
        yield* ctx.ask({ permission: "scheduler_create", patterns: [description], always: ["*"], metadata: {} })
        const result = yield* (
          input.task_id
            ? scheduler.update({
                id: input.task_id,
                ownerSessionId: ctx.sessionID,
                prompt: input.prompt,
                intervalSeconds: interval,
                recurring: input.recurring,
              })
            : scheduler.create({
                ownerSessionId: ctx.sessionID,
                prompt: input.prompt!,
                intervalSeconds: interval!,
                recurring: input.recurring !== false,
                fireImmediately: input.fire_immediately === true,
                durable: input.durable,
                resume: ctx.extra?.scheduledModel
                  ? yield* Schema.decodeUnknownEffect(SchedulerStore.Resume)({
                      agent: ctx.agent,
                      messageID: ctx.messageID,
                      model: ctx.extra.scheduledModel,
                    })
                  : undefined,
                run: (schedule) =>
                  ctx.runScheduledTask ? ctx.runScheduledTask(schedule) : runScheduledTask(task, schedule, ctx),
              })
        ).pipe(Effect.catchTag("SchedulerError", (error) => Effect.succeed({ error: error.message })))
        if ("error" in result) return invalidScheduler(result.error)
        return {
          title: result.schedule.prompt.slice(0, 60),
          metadata: {
            task_id: result.job.id,
            status: result.job.status,
            interval: `${result.schedule.intervalSeconds}s`,
            updated: Boolean(input.task_id),
            next_fire_at: Scheduler.nextFireAt(result.schedule),
            expires_at: result.schedule.expiresAt,
          },
          output: `${input.task_id ? "Updated" : "Scheduled"} task ${result.job.id} ${result.schedule.recurring ? "every" : "once after"} ${humanInterval(result.schedule.intervalSeconds)}${!input.task_id && input.fire_immediately ? "; first run starts now" : ""}.`,
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
        const error = scheduler.recoveryError(ctx.sessionID)
        if (error)
          return {
            title: "scheduler_list",
            metadata: { status: "recovery_failed" },
            output: `Scheduler recovery failed: ${error}`,
          }
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

export function runScheduledTask(task: Tool.Def, schedule: Scheduler.Schedule, ctx: Tool.Context) {
  return task
    .execute(
      {
        description: schedule.prompt.slice(0, 60),
        prompt: schedule.prompt,
        subagent_type: "general",
        background: false,
      },
      { ...ctx, abort: new AbortController().signal, metadata: () => Effect.void },
    )
    .pipe(
      Effect.map((result) => result.output),
      Effect.onExit((exit) =>
        !ctx.notifyBackground || (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause))
          ? Effect.void
          : ctx.notifyBackground({
              taskID: schedule.id,
              type: "scheduler",
              title: schedule.prompt.slice(0, 60),
              status: Exit.isSuccess(exit) ? "completed" : "error",
              output: Exit.isSuccess(exit) ? exit.value : String(Cause.squash(exit.cause)),
            }),
      ),
    )
}

function workspaceDirectory(ctx: Tool.Context) {
  return typeof ctx.extra?.directory === "string" ? ctx.extra.directory : (process.env.APEXO_WORKDIR ?? process.cwd())
}

function parseInterval(value: string, now: number): number | undefined {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)[ ]*([smhd])$/)
  if (!match) return undefined
  const amount = Number(match[1])
  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[match[2] as "s" | "m" | "h" | "d"]
  const seconds = Math.round(amount * multiplier)
  if (!Number.isSafeInteger(seconds * 1000) || amount <= 0 || seconds * 1000 > 8_640_000_000_000_000 - now)
    return undefined
  return Math.max(60, seconds)
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
