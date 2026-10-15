import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Worktree } from "@/worktree"
import { Effect } from "effect"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { SessionListQuery, ToolListQuery, WorktreeApiError } from "../groups/experimental"
import { notFound, ConflictError, ForbiddenError, ServiceUnavailableError, InvalidRequestError } from "../errors"
import { MemoryManagement } from "@/session/memory-management"
import { SessionMemoryWork } from "@/session/memory-work"
import { MemoryCatalog } from "@apexo/core/memory-catalog"
import { HostHooks } from "@apexo/core/hooks"

function mapWorktreeError<A, R>(self: Effect.Effect<A, Worktree.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => new WorktreeApiError({ name: error._tag, data: { message: error.message } })),
  )
}

export const experimentalHandlers = HttpApiBuilder.group(InstanceHttpApi, "experimental", (handlers) =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const mcp = yield* MCP.Service
    const project = yield* Project.Service
    const registry = yield* ToolRegistry.Service
    const worktreeSvc = yield* Worktree.Service
    const sessions = yield* Session.Service
    const background = yield* BackgroundJob.Service
    const flags = yield* RuntimeFlags.Service
    const memory = yield* MemoryManagement.Service
    const memoryWork = yield* SessionMemoryWork.Service

    const capabilities = Effect.fn("ExperimentalHttpApi.capabilities")(function* () {
      return {
        backgroundSubagents: flags.experimentalBackgroundSubagents,
        memoryManagement: flags.runtimeProfile === "grok-build" && flags.grokMemory !== false,
      }
    })

    const tool = Effect.fn("ExperimentalHttpApi.tool")(function* (ctx: { query: typeof ToolListQuery.Type }) {
      const session = ctx.query.sessionID
        ? yield* sessions.get(ctx.query.sessionID).pipe(Effect.mapError(() => notFound("Session not found")))
        : undefined
      const location = yield* InstanceState.context
      if (
        session &&
        (session.projectID !== location.project.id ||
          (location.project.id === "global" && session.directory !== location.directory))
      )
        return yield* notFound("Session not found")
      const agent = session?.agent ? yield* agents.get(session.agent) : yield* agents.defaultInfo()
      const list = yield* registry.tools({
        providerID: ctx.query.provider,
        modelID: ctx.query.model,
        agent,
        permission: session?.permission,
        sessionID: session?.id,
      })
      const hidden = session
        ? Permission.disabled(
            list.map((item) => item.id),
            Permission.merge(agent.permission, session.permission ?? []),
          )
        : new Set<string>()
      return list
        .filter((item) => !hidden.has(item.id))
        .map((item) => ({
          id: item.id,
          description: item.description,
          parameters: ToolJsonSchema.fromTool(item),
        }))
    })

    const toolIDs = Effect.fn("ExperimentalHttpApi.toolIDs")(function* () {
      return yield* registry.ids()
    })

    const worktree = Effect.fn("ExperimentalHttpApi.worktree")(function* () {
      const ctx = yield* InstanceState.context
      return yield* project.sandboxes(ctx.project.id)
    })

    const worktreeCreate = Effect.fn("ExperimentalHttpApi.worktreeCreate")(function* (ctx: {
      payload: typeof Worktree.CreateInput.Type | void
    }) {
      return yield* mapWorktreeError(worktreeSvc.create(ctx.payload ?? undefined))
    })

    const worktreeRemove = Effect.fn("ExperimentalHttpApi.worktreeRemove")(function* (input: {
      payload: Worktree.RemoveInput
    }) {
      const ctx = yield* InstanceState.context
      yield* mapWorktreeError(worktreeSvc.remove(input.payload))
      yield* project.removeSandbox(ctx.project.id, input.payload.directory)
      return true
    })

    const worktreeReset = Effect.fn("ExperimentalHttpApi.worktreeReset")(function* (ctx: {
      payload: Worktree.ResetInput
    }) {
      yield* mapWorktreeError(worktreeSvc.reset(ctx.payload))
      return true
    })

    const session = Effect.fn("ExperimentalHttpApi.session")(function* (ctx: { query: typeof SessionListQuery.Type }) {
      const limit = ctx.query.limit ?? 100
      const directory = ctx.query.directory ? yield* InstanceState.directory : undefined
      const all = yield* sessions.listGlobal({
        directory,
        roots: ctx.query.roots,
        start: ctx.query.start,
        cursor: ctx.query.cursor,
        search: ctx.query.search,
        limit: limit + 1,
        archived: ctx.query.archived,
      })
      const list = all.length > limit ? all.slice(0, limit) : all
      return HttpServerResponse.jsonUnsafe(list, {
        headers:
          all.length > limit && list.length > 0
            ? { "x-next-cursor": String(list[list.length - 1].time.updated) }
            : undefined,
      })
    })

    const sessionBackground = Effect.fn("ExperimentalHttpApi.sessionBackground")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      return yield* BackgroundJob.promoteSession(
        background,
        ctx.params.sessionID,
        flags.experimentalBackgroundSubagents,
      )
    })

    const resource = Effect.fn("ExperimentalHttpApi.resource")(function* () {
      return yield* mcp.resources()
    })

    const tasks = Effect.fn("ExperimentalHttpApi.tasks")(function* (ctx: { params: { sessionID: SessionID } }) {
      return (yield* background.list())
        .filter((job) => BackgroundJob.owns(job, ctx.params.sessionID))
        .map((job) => BackgroundJob.summary(job, ctx.params.sessionID))
        .toSorted(
          (a, b) => Number(b.status === "running") - Number(a.status === "running") || b.started_at - a.started_at,
        )
    })

    const task = Effect.fn("ExperimentalHttpApi.task")(function* (ctx: {
      params: { sessionID: SessionID; taskID: string }
    }) {
      const job = yield* background.get(ctx.params.taskID)
      if (!job || !BackgroundJob.owns(job, ctx.params.sessionID)) return yield* notFound("Task not found")
      return { ...BackgroundJob.summary(job, ctx.params.sessionID), output: job.output ?? "", error: job.error }
    })

    const taskCancel = Effect.fn("ExperimentalHttpApi.taskCancel")(function* (ctx: {
      params: { sessionID: SessionID; taskID: string }
    }) {
      const job = yield* background.get(ctx.params.taskID)
      if (!job || !BackgroundJob.owns(job, ctx.params.sessionID)) return yield* notFound("Task not found")
      const cancelled = yield* background.cancel(job.id)
      return BackgroundJob.summary(cancelled ?? job, ctx.params.sessionID)
    })

    return handlers
      .handle("hooks", () =>
        Effect.gen(function* () {
          const directory = yield* InstanceState.directory
          const inspection = yield* Effect.tryPromise({
            try: () => HostHooks.inspect(directory),
            catch: () =>
              new ServiceUnavailableError({ message: "Hook configuration is unavailable", service: "hooks" }),
          })
          if (flags.runtimeProfile === "grok-build") return inspection
          return {
            ...inspection,
            diagnostics: [...inspection.diagnostics, "Grok host hooks are inactive in the Apexo runtime profile."],
            hooks: inspection.hooks.map((hook) => ({ ...hook, supported: false })),
          }
        }),
      )
      .handle("capabilities", capabilities)
      .handle("tool", tool)
      .handle("toolIDs", toolIDs)
      .handle("worktree", worktree)
      .handle("worktreeCreate", worktreeCreate)
      .handle("worktreeRemove", worktreeRemove)
      .handle("worktreeReset", worktreeReset)
      .handle("session", session)
      .handle("sessionBackground", sessionBackground)
      .handle("tasks", tasks)
      .handle("task", task)
      .handle("taskCancel", taskCancel)
      .handle("memory", (ctx) => memory.list(ctx.params.sessionID, ctx.query.search).pipe(Effect.mapError(memoryError)))
      .handle("memoryStatus", (ctx) => memory.status(ctx.params.sessionID).pipe(Effect.mapError(memoryError)))
      .handle("memoryHealth", (ctx) => memory.health(ctx.params.sessionID).pipe(Effect.mapError(memoryError)))
      .handle("memoryToggle", (ctx) =>
        memory.toggle(ctx.params.sessionID, ctx.payload.enabled).pipe(Effect.mapError(memoryError)),
      )
      .handle("memoryNote", (ctx) =>
        memory.preview(ctx.params.sessionID, ctx.query.path).pipe(Effect.mapError(memoryError)),
      )
      .handle("memoryForget", (ctx) =>
        memory.forget(ctx.params.sessionID, ctx.payload).pipe(Effect.mapError(memoryError)),
      )
      .handle("memoryRemember", (ctx) =>
        memory.remember(ctx.params.sessionID, ctx.payload).pipe(Effect.mapError(memoryError)),
      )
      .handle("memoryRewrite", (ctx) =>
        memory.rewrite(ctx.params.sessionID, ctx.payload).pipe(Effect.mapError(memoryError)),
      )
      .handle("memoryWork", (ctx) => memoryWork.get(ctx.params.sessionID).pipe(Effect.mapError(memoryError)))
      .handle("memoryWorkStart", (ctx) =>
        memoryWork.start(ctx.params.sessionID, ctx.payload.kind).pipe(Effect.mapError(memoryError)),
      )
      .handle("memoryWorkCancel", (ctx) =>
        memoryWork.cancel(ctx.params.sessionID, ctx.payload.id).pipe(Effect.mapError(memoryError)),
      )
      .handle("resource", resource)
  }),
)

function memoryError(error: MemoryCatalog.Error) {
  if (error.reason === "invalid") return new InvalidRequestError({ message: error.message, kind: "memory" })
  if (error.reason === "not_found") return notFound(error.message)
  if (error.reason === "forbidden" || error.reason === "not_deletable")
    return new ForbiddenError({ message: error.message })
  if (error.reason === "changed") return new ConflictError({ message: error.message, resource: "memory" })
  return new ServiceUnavailableError({ message: error.message, service: "memory" })
}
