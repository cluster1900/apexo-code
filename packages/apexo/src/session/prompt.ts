import { SessionCommandSandbox } from "@apexo/core/session/command-sandbox"
import { SessionManagedChild } from "@apexo/core/session/managed-child"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { Location } from "@apexo/core/location"
import { AbsolutePath } from "@apexo/schema/schema"
import { CompatHookSnapshotLocation } from "@/plugin/hook-snapshot-location"
import { HostHookSnapshot } from "@/plugin/host-hook-snapshot"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { PermissionV1 } from "@apexo/core/v1/permission"
import path from "path"
import { SessionV1 } from "@apexo/core/v1/session"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { SessionRevert } from "./revert"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"

import { type Tool as AITool, tool, jsonSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import { MAX_STEPS_PROMPT } from "@apexo/core/session/runner/max-steps"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { SessionMemory } from "./memory"
import { SessionMemoryFlush } from "./memory-flush"
import { SessionMemoryContext } from "./memory-context"
import { SessionMemoryBackend } from "./memory-backend"
import { SessionMemoryCapture } from "./memory-capture"
import { NamedError } from "@apexo/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Scheduler } from "@apexo/core/scheduler"
import { runScheduledTask } from "@/tool/grok-build-extensions"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@apexo/core/shell"
import { ShellID } from "@/tool/shell/id"
import { FSUtil } from "@apexo/core/fs-util"
import { Truncate } from "@/tool/truncate"
import { Image } from "@/image/image"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema, Types } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@apexo/core/database/database"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { eq } from "drizzle-orm"
import { SessionTable } from "@apexo/core/session/sql"
import { SessionReminders } from "./reminders"
import { SessionTools } from "./tools"
import { McpToolIndex } from "@/mcp/tool-index"

// Last MCP server fingerprint seen per session, for Grok-style connect/update/disconnect reminders.
const mcpFingerprints = new Map<string, McpToolIndex.Fingerprint>()
import { LLMEvent } from "@apexo/llm"
import { Goal } from "@apexo/schema/goal"
import { HookObserver } from "@apexo/core/hook-observer"
import { SessionHookStop } from "@apexo/core/session/hook-stop"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalCleanup } from "@apexo/core/session/goal-cleanup"
import { SessionGoalUsage } from "@apexo/core/session/goal-usage"
import { SessionGoalModel } from "./goal-review"
import { SessionGoalRole } from "./goal-role"
import { SessionGoalRun } from "./goal-run"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const decodeMessageInfo = Schema.decodeUnknownExit(SessionV1.Info)
const decodeMessagePart = Schema.decodeUnknownExit(SessionV1.Part)
const MAX_MCP_RESOURCE_BLOB_BYTES = 10 * 1024 * 1024
const SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

function mcpResourceBase64Size(value: string) {
  const trimmed = value.replace(/\s/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

function formatMcpResourceBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${Math.ceil(value / (1024 * 1024))} MB`
}

function isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
  // cleanup() marks abandoned tool_use blocks this way after retries/aborts.
  // They are not pending work and must not trigger an assistant-prefill request.
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}

export function isWorkflowOwned(metadata: Record<string, string> | undefined) {
  return Boolean(metadata?.workflowHost || metadata?.workflowChild)
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts>
  readonly runGoal: (
    target: SessionGoal.Target,
    admitted?: Effect.Effect<void>,
    prepare?: Effect.Effect<void>,
  ) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
  readonly shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
  readonly command: (input: CommandInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/SessionPrompt") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const policies = yield* SessionCommandSandbox.Service
    const lifecycle = yield* SessionLifecycle.Service
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const hookSnapshots = yield* CompatHookSnapshotLocation.Service
    const hostHooks = yield* HostHookSnapshot.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* FSUtil.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const locationGuard = yield* LocationRuntimeGuard.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const memory = yield* SessionMemory.Service
    const memoryFlush = yield* SessionMemoryFlush.Service
    const memoryContext = yield* SessionMemoryContext.Service
    const memoryBackend = yield* SessionMemoryBackend.Service
    const memoryCapture = yield* SessionMemoryCapture.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const background = yield* BackgroundJob.Service
    const backgroundState = yield* InstanceState.make(() =>
      Effect.map(Scope.Scope, (scope) => ({
        scope,
        suppressed: new Set<SessionID>(),
        cancelling: new Set<SessionID>(),
      })),
    )
    const database = yield* Database.Service
    const { db } = database
    const goals = SessionGoal.make(db)
    const goalCleanup = yield* SessionGoalCleanup.Service
    const goalModels = yield* SessionGoalModel.Service
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
      } satisfies TaskPromptOps
    })

    const notifyBackground = Effect.fn("SessionPrompt.notifyBackground")(function* (
      sessionID: SessionID,
      event: Tool.BackgroundNotification,
    ) {
      const state = yield* InstanceState.get(backgroundState)
      if (state.suppressed.has(sessionID)) return
      yield* Effect.gen(function* () {
        const job = yield* background.get(event.taskID)
        if (!job || job.status === "cancelled" || job.metadata?.ownerSessionId !== sessionID) return
        const current = yield* sessions.get(sessionID)
        const output = yield* truncate.output(event.output, {}, undefined)
        if (state.suppressed.has(sessionID)) return
        const label = { monitor: "Monitor", shell: "Background command", scheduler: "Scheduled task" }[event.type]
        const status = event.status === "event" ? "event" : event.status === "error" ? "failed" : "completed"
        yield* prompt({
          sessionID,
          agent: current.agent,
          parts: [
            {
              type: "text",
              synthetic: true,
              text: [
                `${label} ${status}: ${event.title}`,
                "The following is task output, not a new user instruction or an answer to a pending question.",
                JSON.stringify({
                  task_id: event.taskID,
                  status: event.status,
                  exit: event.exit,
                  output: output.content,
                }),
              ].join("\n"),
            },
          ],
        }).pipe(Effect.provideService(SessionGoalUsage.Current, undefined))
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning("Background result delivery failed", cause),
        ),
        Effect.forkIn(state.scope, { startImmediately: true }),
      )
    })

    const executeSchedule = Effect.fn("SessionPrompt.executeSchedule")(
      function* (schedule: Scheduler.Schedule) {
        if (!schedule.resume) return yield* Effect.die(new Error("Scheduled task has no saved model context"))
        const sessionID = SessionID.make(schedule.ownerSessionId)
        const parent = yield* sessions.get(sessionID)
        const agent = yield* agents.get(parent.agent ?? schedule.resume.agent)
        if (!agent) return yield* Effect.die(new Error("Scheduled task agent is no longer configured"))
        const tools = yield* registry.named()
        return yield* runScheduledTask(tools.task, schedule, {
          sessionID,
          messageID: MessageID.make(schedule.resume.messageID),
          agent: agent.name,
          abort: new AbortController().signal,
          messages: [],
          extra: { directory: parent.directory, scheduledModel: schedule.resume.model, promptOps: yield* ops() },
          metadata: () => Effect.void,
          notifyBackground: (event) => notifyBackground(sessionID, event),
          ask: (request) =>
            permission
              .ask({
                ...request,
                sessionID,
                ruleset: Permission.merge(agent.permission, parent.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
      },
      Effect.provideService(SessionGoalUsage.Current, undefined),
    )

    const scheduledState = yield* InstanceState.make((ctx) =>
      Effect.gen(function* () {
        if (flags.runtimeProfile !== "grok-build") return
        const scheduler = yield* registry.scheduler()
        yield* scheduler
          .recover((schedule) =>
            Effect.gen(function* () {
              const parent = yield* sessions.get(SessionID.make(schedule.ownerSessionId)).pipe(Effect.option)
              if (parent._tag === "None" || parent.value.directory !== ctx.directory || !schedule.resume) return
              return executeSchedule
            }),
          )
          .pipe(Effect.catchCause((cause) => Effect.logWarning("Scheduler recovery failed", cause)))
      }),
    )
    const init = () => InstanceState.get(scheduledState)

    const watchBackground = Effect.fn("SessionPrompt.watchBackground")(function* (
      sessionID: SessionID,
      taskID: string,
    ) {
      const state = yield* InstanceState.get(backgroundState)
      // A tool's completion watcher survives the provider turn's abort scope.
      yield* Effect.gen(function* () {
        const result = yield* background.wait({ id: taskID })
        const job = result.info
        if (!job || (job.status !== "completed" && job.status !== "error")) return
        const exit = typeof job.metadata?.exit === "number" ? job.metadata.exit : undefined
        yield* notifyBackground(sessionID, {
          taskID,
          title: job.title ?? taskID,
          type: "shell",
          status: job.status === "error" || (exit !== undefined && exit !== 0) ? "error" : "completed",
          output: job.error ?? job.output ?? "",
          exit,
        })
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logWarning("Background completion watcher failed", cause),
        ),
        Effect.forkIn(state.scope, { startImmediately: true }),
      )
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      const goal = yield* goals.get(sessionID).pipe(Effect.orDie)
      if (goal?.status === "active")
        yield* goals.pause({ sessionID, goalID: goal.id }, "user_paused").pipe(Effect.orDie)
      yield* memoryFlush.cancel(sessionID)
      const notifications = yield* InstanceState.get(backgroundState)
      notifications.suppressed.add(sessionID)
      yield* Effect.logInfo("cancel", { "session.id": sessionID })
      notifications.cancelling.add(sessionID)
      yield* state
        .cancel(sessionID)
        .pipe(Effect.ensuring(Effect.sync(() => notifications.cancelling.delete(sessionID))))
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)

          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: SessionV1.WithParts[]
      providerID: ProviderV2.ID
      modelID: ModelV2.ID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: SessionV1.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findLastIndex(real)
      if (idx === -1) return
      const hadSuccess = input.history.some(
        (m) => m.info.role === "assistant" && !m.info.error && m.info.time.completed,
      )
      if (input.history.filter(real).length > 1 && hadSuccess) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is SessionV1.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.providerID)) ??
          (yield* provider.getModel(input.providerID, input.modelID)))
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl)
      const fallback = firstUser.parts
        .filter((p): p is SessionV1.TextPart => p.type === "text" && !p.synthetic)
        .map((p) => p.text)
        .join("\n")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      const text = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.catchCause(() => Effect.succeed("")),
        )
      const cleaned =
        text
          .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
          .replace(/<think>[\s\S]*$/g, "")
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? fallback
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => Effect.logError("failed to generate title", { error: Cause.squash(cause) })))
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: SessionV1.SubtaskPart
      model: Provider.Model
      lastUser: SessionV1.User
      sessionID: SessionID
      session: Session.Info
      msgs: SessionV1.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      const { task: taskTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: SessionV1.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: SessionV1.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies SessionV1.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            return Effect.logError("subtask execution failed", {
              error,
              agent: task.agent,
              description: task.description,
            })
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies SessionV1.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: SessionV1.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      yield* sessions.updateMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies SessionV1.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
            const userMsg: SessionV1.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: SessionV1.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: SessionV1.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.updateMessage(msg)
            const started = Date.now()
            const part: SessionV1.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: ShellID.ToolID,
              callID: ulid(),
              state: {
                status: "running",
                time: { start: started },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            return { msg, part, cwd: ctx.directory }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          let output = ""
          let aborted = false

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (aborted) {
                output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
              }
              const completed = Date.now()
              if (!msg.time.completed) {
                msg.time.completed = completed
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = {
                  status: "completed",
                  time: { ...part.state.time, end: completed },
                  input: part.state.input,
                  title: "",
                  metadata: { output },
                  output,
                }
                yield* sessions.updatePart(part)
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, callID: part.callID },
                { env: {} },
              )
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              })
              const handle = yield* spawner.spawn(cmd)
              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                Effect.gen(function* () {
                  output += chunk
                  if (part.state.status === "running") {
                    part.state.metadata = { output }
                    yield* sessions.updatePart(part)
                  }
                }),
              )
              yield* handle.exitCode
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
            aborted = true
          }
          yield* finish

          if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
            return yield* Effect.failCause(exit.cause)
          }

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
        yield* events.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint} Run \`apexo models\` to list available models.`,
          }).toObject(),
        })
      }
      return yield* Effect.die(err)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = yield* db
        .select({ model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (current?.model) {
        return {
          providerID: ProviderV2.ID.make(current.model.providerID),
          modelID: ModelV2.ID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel().pipe(Effect.orDie)
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)
      const windowModel = input.contextWindow
        ? (full ??
          (yield* provider
            .getModel(model.providerID, model.modelID)
            .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))))
        : undefined

      const info: SessionV1.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
          ...(input.contextWindow && windowModel?.limit.context_options?.includes(input.contextWindow)
            ? { contextWindow: input.contextWindow }
            : {}),
        },
        system: input.system,
        format: input.format,
      }

      const current = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      if (
        current.agent !== info.agent ||
        current.model?.providerID !== info.model.providerID ||
        current.model?.id !== info.model.modelID ||
        (current.model?.variant === "default" ? undefined : current.model?.variant) !== info.model.variant
      ) {
        yield* sessions.setAgentModel({
          sessionID: input.sessionID,
          agent: info.agent,
          model: {
            id: info.model.modelID,
            providerID: info.model.providerID,
            variant: info.model.variant ?? "default",
          },
          time: info.time.created,
        })
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends SessionV1.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<SessionV1.Part>): SessionV1.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<SessionV1.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            yield* Effect.logInfo("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<SessionV1.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if (!c || typeof c !== "object") continue
                if ("text" in c && typeof c.text === "string" && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && typeof c.blob === "string" && c.blob) {
                  const mime = "mimeType" in c && typeof c.mimeType === "string" ? c.mimeType : part.mime
                  const filename = "uri" in c && typeof c.uri === "string" ? c.uri : part.filename
                  const size = mcpResourceBase64Size(c.blob)
                  if (!SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(mime)) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary MCP resource omitted: ${filename ?? uri} (${mime}, ${formatMcpResourceBytes(size)}) is not a supported attachment type]`,
                    })
                    continue
                  }
                  if (size > MAX_MCP_RESOURCE_BLOB_BYTES) {
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `[Binary MCP resource omitted: ${filename ?? uri} (${mime}, ${formatMcpResourceBytes(size)}) exceeds ${formatMcpResourceBytes(MAX_MCP_RESOURCE_BLOB_BYTES)}]`,
                    })
                    continue
                  }
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary MCP resource attached: ${filename ?? uri} (${mime})]`,
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "file",
                    mime,
                    filename,
                    url: `data:${mime};base64,${c.blob}`,
                  })
                }
              }
            } else {
              const error = Cause.squash(exit.cause)
              yield* Effect.logError("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              break
            case "file:": {
              yield* Effect.logInfo("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<SessionV1.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("failed to read file", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  yield* Effect.logError("failed to read directory", { error, filepath })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    `data:${mime};base64,` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                  mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts: resolvedParts },
      )

      const parts = yield* Effect.forEach(resolvedParts, (part) =>
        part.type === "file" && part.mime.startsWith("image/")
          ? image.normalize(part).pipe(
              Effect.catchIf(
                (error) => error instanceof Image.ResizerUnavailableError,
                () => Effect.succeed(part),
              ),
            )
          : Effect.succeed(part),
      )

      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
      if (Exit.isFailure(parsed)) {
        yield* Effect.logError("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause),
        })
      }
      for (const [index, part] of parts.entries()) {
        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
        if (Exit.isSuccess(p)) continue
        yield* Effect.logError("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part,
        })
      }

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)

      return { info, parts }
    }, Effect.scoped)

    const assertLegacy = Effect.fn("SessionPrompt.assertLegacy")(function* (sessionID: SessionID) {
      if (yield* SessionManagedChild.managed(db, sessionID).pipe(Effect.orDie))
        return yield* Effect.die(new Error("Managed children only accept their owner's input"))
      const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
      yield* policies.assertLegacy(sessionID).pipe(Effect.orDie)
      if (isWorkflowOwned(session.metadata))
        return yield* Effect.die(new Error("Native Workflow Sessions are read-only through compatibility execution"))
    })

    const prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error> = Effect.fn(
      "SessionPrompt.prompt",
    )(function* (input: PromptInput) {
      yield* assertLegacy(input.sessionID)
      yield* init()
      if (input.parts.some((part) => !("synthetic" in part && part.synthetic))) {
        const notifications = yield* InstanceState.get(backgroundState)
        notifications.suppressed.delete(input.sessionID)
      }
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* memoryBackend.get(input.sessionID)
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(input)
      yield* sessions.touch(input.sessionID)

      const permissions: PermissionV1.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = Permission.merge(session.permission ?? [], permissions)
        yield* sessions.setPermission({ sessionID: session.id, permission: session.permission })
      }

      if (input.noReply === true) return message
      if (input.parts.some((part) => !("synthetic" in part && part.synthetic)))
        yield* BackgroundJob.promoteSession(background, input.sessionID, false)
      return yield* loop({ sessionID: input.sessionID })
    })

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const runLoop: (
      sessionID: SessionID,
      goalID?: Goal.ID,
      admitted?: Effect.Effect<void>,
    ) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.run")(function* (
      sessionID: SessionID,
      goalID?: Goal.ID,
      admitted?: Effect.Effect<void>,
    ) {
      const ctx = yield* InstanceState.context
      let step = 0
      const stopState = { userID: "", count: 0, reason: "", messageID: "", forceStop: false }
      // Keep the original request across steers and compaction, only for this active run.
      let initialUser: SessionV1.WithParts | undefined
      let steered = false
      const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
      const goalRole = yield* SessionGoalRole.Current
      const goal = goalID
        ? yield* SessionGoalRun.open(
            { sessionID, goalID },
            goals,
            goalModels,
            goalCleanup,
            { prompt, cancel },
            (yield* config.get()).goal?.report_retention_days,
          ).pipe(Effect.orDie)
        : undefined
      if (goalID && !goal) return yield* lastAssistant(sessionID)
      if (goal && admitted) yield* admitted
      yield* hookSnapshots.capture(sessionID).pipe(Effect.orDie)

      const hasPendingUser = Effect.fnUntraced(function* (userID: string) {
        const fresh = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
          Effect.provideService(Database.Service, database),
        )
        const user = MessageV2.latest(fresh).user
        // A steer can land after this iteration already decided to stop.
        // Continue so that message is not left without a provider turn.
        return user !== undefined && user.id !== userID
      })

      const awaitGoalChildren = Effect.fnUntraced(function* (userID: string) {
        const attempt = goal?.attempt
        if (!attempt) return true
        while (true) {
          if (yield* hasPendingUser(userID)) return false
          const pending = (yield* background.list()).filter(
            (job) =>
              job.type === "task" && job.status === "running" && job.metadata?.goalAttemptID === attempt.attemptID,
          )
          if (!pending.length) return true
          const active = yield* goals.check(attempt).pipe(Effect.result)
          if (active._tag === "Failure") {
            if (active.failure instanceof SessionGoal.StorageError) return yield* Effect.die(active.failure)
            yield* Effect.forEach(pending, (job) => background.cancel(job.id), {
              concurrency: "unbounded",
              discard: true,
            })
            return true
          }
          yield* Effect.forEach(pending, (job) => background.wait({ id: job.id, timeout: 1000 }), {
            concurrency: "unbounded",
            discard: true,
          })
        }
      })

      const stopGate = Effect.fnUntraced(function* (
        assistant: SessionV1.Assistant,
        parts: SessionV1.Part[],
        budgetEnded = false,
      ) {
        if (
          flags.runtimeProfile !== "grok-build" ||
          goalRole ||
          session.parentID ||
          budgetEnded ||
          assistant.error ||
          assistant.finish !== "stop"
        )
          return false
        if (goal?.attempt) {
          const eligible = yield* goals.check(goal.attempt).pipe(Effect.result)
          if (eligible._tag === "Failure") return false
        }
        const hooks = yield* hookSnapshots.get(sessionID)
        const decision = yield* SessionHookStop.evaluate(database.db, {
          engine: "v1",
          sessionID,
          messageID: assistant.id,
          directory: ctx.directory,
          enabled: true,
          continuations: stopState.count,
          registry: hooks?.registry,
          selection: hooks?.selection,
          lastAssistantMessage: parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
        }).pipe(Effect.orDie)
        stopState.forceStop = decision.forceStop
        if (!decision.continue) return false
        stopState.count++
        stopState.reason = decision.reason ?? ""
        stopState.messageID = assistant.id
        return true
      })

      while (true) {
        let structured: unknown
        yield* status.set(sessionID, { type: "busy" })
        yield* Effect.logInfo("loop", { "session.id": sessionID, step })

        yield* state.controls(sessionID)
        let msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
          Effect.provideService(Database.Service, database),
        )

        const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = MessageV2.latest(msgs)

        if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

        if (stopState.userID !== lastUser.id) {
          if (stopState.messageID) yield* SessionHookStop.consume(database.db, sessionID, stopState.messageID, "v1")
          stopState.userID = lastUser.id
          stopState.count = 0
          stopState.reason = ""
          stopState.messageID = ""
        }
        const userMessage = msgs.find((message) => message.info.id === lastUser.id)!
        if (flags.runtimeProfile === "grok-build")
          yield* hostHooks.prompt(
            { sessionID, messageID: lastUser.id },
            { message: lastUser, parts: userMessage.parts },
          )
        initialUser ??= userMessage
        steered ||=
          initialUser.info.id !== lastUser.id &&
          userMessage.parts.some(
            (part) => part.type === "file" || (part.type === "text" && !part.synthetic && !part.ignored),
          )

        const lastAssistantMsg = msgs.findLast(
          (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
        )
        // Some providers return "stop" even when the assistant message contains
        // tool calls. Keep the loop running so tool results can be sent back to
        // the model, but ignore cleanup-marked interrupted orphans.
        const hasToolCalls =
          lastAssistantMsg?.parts.some(
            (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
          ) ?? false

        if (
          !stopState.messageID &&
          lastAssistant?.finish &&
          !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
          !hasToolCalls &&
          lastAssistant.parentID === lastUser.id &&
          (!goal || goal.worked)
        ) {
          const orphan = lastAssistantMsg?.parts.find(
            (part): part is SessionV1.ToolPart => part.type === "tool" && isOrphanedInterruptedTool(part),
          )
          if (orphan) {
            yield* Effect.logWarning("loop exit with orphaned interrupted tool", {
              "session.id": sessionID,
              messageID: lastAssistant.id,
              tool: orphan.tool,
              callID: orphan.callID,
            })
          }
          if (yield* hasPendingUser(lastUser.id)) continue
          if (goal && !(yield* awaitGoalChildren(lastUser.id))) continue
          const stopAgent = yield* agents.get(lastUser.agent)
          if (yield* stopGate(lastAssistant, lastAssistantMsg?.parts ?? [], step >= (stopAgent?.steps ?? Infinity)))
            continue
          if (stopState.forceStop) break
          if (goal) {
            if (!(yield* awaitGoalChildren(lastUser.id))) continue
            if (
              !(yield* goal
                .finish(lastAssistant.error ? JSON.stringify(lastAssistant.error).slice(0, 2048) : undefined)
                .pipe(Effect.orDie))
            )
              break
            step = 0
            continue
          }
          yield* Effect.logInfo("exiting loop", { "session.id": sessionID })
          yield* memoryCapture.schedule(sessionID)
          break
        }

        if (goal) {
          const children = goal.attempt
            ? []
            : yield* Effect.forEach(
                [
                  ...new Set(
                    (yield* background.list()).flatMap((job) =>
                      job.type === "task" &&
                      job.metadata &&
                      job.metadata.goalID === goalID &&
                      typeof job.metadata.sessionId === "string"
                        ? [SessionID.make(job.metadata.sessionId)]
                        : [],
                    ),
                  ),
                ],
                (sessionID) => sessions.messages({ sessionID }).pipe(Effect.orDie),
                { concurrency: 2 },
              )
          if (!(yield* goal.prepare(msgs, children.flat()).pipe(Effect.orDie))) break
        }
        const goalAttempt = goal?.attempt ?? (yield* SessionGoalUsage.Current)
        if (!goal && goalAttempt) {
          const activeGoal = yield* SessionGoal.make(database.db)
            .check(goalAttempt)
            .pipe(Effect.orElseSucceed(() => undefined))
          if (!activeGoal) break
        }
        step++
        if (step === 1)
          yield* title({
            session,
            modelID: lastUser.model.modelID,
            providerID: lastUser.model.providerID,
            history: msgs,
          }).pipe(Effect.provideService(SessionGoalUsage.Current, undefined), Effect.ignore, Effect.forkIn(scope))

        const resolved = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
        // /context-window: the session's chosen size is the effective limit for overflow and auto-compaction.
        const window = lastUser.model.contextWindow
        const model =
          window && resolved.limit.context_options?.includes(window)
            ? { ...resolved, limit: { ...resolved.limit, context: window } }
            : resolved
        const task = tasks.pop()

        if (task?.type === "subtask") {
          goal?.markWorked()
          yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs }).pipe(
            Effect.provideService(SessionGoalUsage.Current, goalAttempt),
          )
          continue
        }

        if (task?.type === "compaction") {
          const result = yield* compaction
            .process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            .pipe(Effect.provideService(SessionGoalUsage.Current, goalAttempt))
          if (result === "stop") {
            if (yield* hasPendingUser(lastUser.id)) continue
            break
          }
          continue
        }

        if (
          lastFinished &&
          lastFinished.summary !== true &&
          (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
        ) {
          yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
          continue
        }

        const agent = yield* agents.get(lastUser.agent)
        if (!agent) {
          const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
          const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
          const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
          yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
          throw error
        }
        const maxSteps = agent.steps ?? Infinity
        if (goalRole && step > maxSteps) throw new Error("Goal reviewer exceeded its provider-turn limit")
        const isLastStep = step >= maxSteps
        msgs = yield* SessionReminders.apply({ messages: msgs, agent, session }).pipe(
          Effect.provideService(RuntimeFlags.Service, flags),
          Effect.provideService(FSUtil.Service, fsys),
          Effect.provideService(Session.Service, sessions),
        )

        // Grok Build deferred MCP: the connected-server list rides as its own system reminder every turn, and
        // connect / update / disconnect deltas are recorded once on the turn where they are first seen.
        const mcpServers = flags.mcpEagerTools
          ? []
          : McpToolIndex.summaries(
              SessionTools.mcpEntries(
                Permission.visibleTools(
                  yield* mcp.tools(),
                  Permission.merge(agent.permission, session.permission ?? []),
                ),
              ),
            )
        const mcpReminder = McpToolIndex.fullReminder(mcpServers)
        const mcpPrevious = mcpFingerprints.get(sessionID)
        mcpFingerprints.set(sessionID, McpToolIndex.fingerprint(mcpServers))
        const mcpDelta = mcpPrevious ? McpToolIndex.deltaReminder(mcpPrevious, mcpServers) : undefined
        const deltaUser = mcpDelta ? msgs.findLast((item) => item.info.role === "user") : undefined
        if (mcpDelta && deltaUser) {
          const part = yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: deltaUser.info.id,
            sessionID,
            type: "text",
            text: `<system-reminder>\n${mcpDelta}\n</system-reminder>`,
            synthetic: true,
          })
          deltaUser.parts.push(part)
        }

        const msg: SessionV1.Assistant = {
          id: MessageID.ascending(),
          parentID: lastUser.id,
          role: "assistant",
          mode: agent.name,
          agent: agent.name,
          variant: lastUser.model.variant,
          path: { cwd: ctx.directory, root: ctx.worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
          sessionID,
        }
        yield* sessions.updateMessage(msg)

        const finalizeInterruptedAssistant = Effect.gen(function* () {
          if (msg.time.completed) return
          msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
            providerID: msg.providerID,
            aborted: true,
          })
          msg.time.completed = Date.now()
          yield* sessions.updateMessage(msg)
        })

        const handle = yield* processor
          .create({
            assistantMessage: msg,
            sessionID,
            model,
          })
          .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))

        const outcome: "break" | "continue" = yield* Effect.gen(function* () {
          const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
          const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
          const promptOps = yield* ops()

          const tools = yield* SessionTools.resolve({
            agent,
            session,
            model,
            processor: handle,
            bypassAgentCheck,
            messages: msgs,
            promptOps,
            watchBackground: (taskID) => watchBackground(sessionID, taskID),
            notifyBackground: (event) => notifyBackground(sessionID, event),
            runScheduledTask: executeSchedule,
            recordMemoryRead: (path) => memoryContext.recordRead({ sessionID, path, agent }),
          }).pipe(
            Effect.provideService(Plugin.Service, plugin),
            Effect.provideService(Permission.Service, permission),
            Effect.provideService(ToolRegistry.Service, registry),
            Effect.provideService(MCP.Service, mcp),
            Effect.provideService(Truncate.Service, truncate),
            Effect.provideService(RuntimeFlags.Service, flags),
          )

          if (lastUser.format?.type === "json_schema") {
            tools["StructuredOutput"] = createStructuredOutputTool({
              schema: lastUser.format.schema,
              onSuccess(output) {
                structured = output
              },
            })
          }

          if (step === 1 && !goalRole)
            yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

          yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

          const [skills, env, instructions, mcpInstructions, modelMsgs, recalled] = yield* Effect.all([
            sys.skills(agent),
            sys.environment(model),
            instruction.system().pipe(Effect.orDie),
            sys.mcp(agent, session.permission),
            MessageV2.toModelMessagesEffect(msgs, model),
            memoryContext.context({ sessionID, messages: msgs, agent }),
          ])
          // An independent review starts another worker turn, not an assistant prefill.
          // Gemini rejects histories ending in a model response even when system guidance changes.
          const goalContinuation = goal && modelMsgs.at(-1)?.role === "assistant" ? goal.system() : undefined
          const system = [
            ...env,
            ...instructions,
            ...(stopState.reason ? [SessionHookStop.render(stopState.reason)] : []),
            ...(recalled ? [recalled] : []),
            ...(mcpInstructions ? [mcpInstructions] : []),
            ...(mcpReminder ? [`<system-reminder>\n${mcpReminder}\n</system-reminder>`] : []),
            ...(skills ? [skills] : []),
            ...(goal && !goalContinuation ? [goal.system()] : []),
            ...(goalRole ? [goalRole.system, `Original goal objective: ${goalRole.objective}`] : []),
          ]
          const format = lastUser.format ?? { type: "text" as const }
          if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
          goal?.markWorked()
          const result = yield* handle.process({
            user: lastUser,
            agent,
            permission: session.permission,
            sessionID,
            parentSessionID: session.parentID,
            system,
            messages: [
              ...modelMsgs,
              ...(goalContinuation ? [{ role: "user" as const, content: goalContinuation }] : []),
              ...(steered && initialUser
                ? [{ role: "user" as const, content: SessionReminders.steering(initialUser) }]
                : []),
              ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS_PROMPT }] : []),
            ],
            tools,
            model,
            toolChoice: format.type === "json_schema" ? "required" : undefined,
            outputSchema: goalRole?.outputSchema,
          })
          if (stopState.messageID) {
            yield* SessionHookStop.consume(database.db, sessionID, stopState.messageID, "v1")
            stopState.messageID = ""
            stopState.reason = ""
          }
          yield* memoryFlush.flush(sessionID, "threshold")

          if (structured !== undefined) {
            handle.message.structured = structured
            handle.message.finish = handle.message.finish ?? "stop"
            yield* sessions.updateMessage(handle.message)
            return "break" as const
          }

          const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
          if (finished && !handle.message.error) {
            // Surface any content-filter finish (e.g. Anthropic stop_reason:
            // refusal) as an error. These turns may have produced no visible
            // output at all — previously the session went idle silently — or
            // partial text that was cut off by the provider's filter.
            if (handle.message.finish === "content-filter") {
              handle.message.error = new SessionV1.ContentFilterError({
                message: "The response was blocked by the provider's content filter",
              }).toObject()
              yield* sessions.updateMessage(handle.message)
              yield* events.publish(Session.Event.Error, { sessionID, error: handle.message.error })
              return "break" as const
            }
            if (format.type === "json_schema") {
              handle.message.error = new SessionV1.StructuredOutputError({
                message: "Model did not produce structured output",
                retries: 0,
              }).toObject()
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }
          }

          if (result === "stop") return "break" as const
          if (result === "compact") {
            yield* compaction.create({
              sessionID,
              agent: lastUser.agent,
              model: lastUser.model,
              auto: true,
              overflow: !handle.message.finish,
            })
          }
          return "continue" as const
        }).pipe(
          Effect.provideService(SessionGoalUsage.Current, goalAttempt),
          Effect.ensuring(instruction.clear(handle.message.id)),
          Effect.onInterrupt(() => finalizeInterruptedAssistant),
        )
        if (outcome === "break") {
          if (!(yield* hasPendingUser(lastUser.id))) {
            if (goal && !(yield* awaitGoalChildren(lastUser.id))) continue
            const completed = yield* sessions
              .findMessage(sessionID, (message) => message.info.id === handle.message.id)
              .pipe(Effect.orDie)
            if (yield* stopGate(handle.message, Option.isSome(completed) ? completed.value.parts : [], isLastStep))
              continue
            if (stopState.forceStop) break
          }
          yield* memoryCapture.schedule(sessionID)
          if (yield* hasPendingUser(lastUser.id)) continue
          if (goal) {
            if (!(yield* awaitGoalChildren(lastUser.id))) continue
            const failure = handle.message.error
              ? JSON.stringify(handle.message.error).slice(0, 2048)
              : !handle.message.finish || ["tool-calls", "unknown"].includes(handle.message.finish)
                ? "Execution stopped before completing the worker round"
                : undefined
            if (yield* goal.finish(failure).pipe(Effect.orDie)) {
              step = 0
              continue
            }
          }
          break
        }
        continue
      }

      yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
      return yield* lastAssistant(sessionID)
    }, Effect.scoped)

    const managedLoop = (sessionID: SessionID, goalID?: Goal.ID, admitted?: Effect.Effect<void>) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        return yield* locationGuard.use(
          Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }),
          runLoop(sessionID, goalID, admitted),
        )
      }).pipe(
        Effect.tap(() => memoryFlush.schedule(sessionID)),
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            yield* memoryCapture.schedule(sessionID, true)
            const notifications = yield* InstanceState.get(backgroundState)
            if (!notifications.cancelling.has(sessionID) || flags.runtimeProfile !== "grok-build") return
            const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
            if (session.parentID) return
            const ctx = yield* InstanceState.context
            const hooks = yield* hookSnapshots.get(sessionID)
            yield* HookObserver.observe({
              registry: hooks?.registry,
              selection: hooks?.selection,
              directory: ctx.directory,
              sessionID,
              event: "StopCancelled",
              enabled: true,
              matcher: "user_interrupt",
              payload: { reason: "user_interrupt", cancelledBy: "user", cancelTrigger: "stop_gesture" },
            })
          }),
        ),
        Effect.ensuring(memory.checkpoint(sessionID)),
        Effect.ensuring(
          goalID
            ? goalCleanup
                .terminal(sessionID)
                .pipe(
                  Effect.catchCause((cause) => Effect.logWarning("Goal terminal cleanup failed", { sessionID, cause })),
                )
            : Effect.void,
        ),
      )

    const loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.loop")(function* (
      input: LoopInput,
    ) {
      yield* assertLegacy(input.sessionID)
      yield* memoryFlush.cancel(input.sessionID)
      return yield* state.ensureRunning(input.sessionID, lastAssistant(input.sessionID), managedLoop(input.sessionID))
    })

    const runGoal = Effect.fn("SessionPrompt.runGoal")(function* (
      target: SessionGoal.Target,
      admitted?: Effect.Effect<void>,
      prepare: Effect.Effect<void> = Effect.void,
    ) {
      yield* assertLegacy(target.sessionID)
      yield* memoryFlush.cancel(target.sessionID)
      return yield* state.startGoal(
        target.sessionID,
        target.goalID,
        lastAssistant(target.sessionID),
        prepare.pipe(Effect.andThen(managedLoop(target.sessionID, target.goalID, admitted))),
      )
    })

    const shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError> = Effect.fn(
      "SessionPrompt.shell",
    )(function* (input: ShellInput) {
      yield* assertLegacy(input.sessionID)
      yield* memoryFlush.cancel(input.sessionID)
      const ready = yield* Latch.make()
      return yield* state.startShell(
        input.sessionID,
        lastAssistant(input.sessionID),
        shellImpl(input, ready).pipe(
          Effect.tap(() => memoryFlush.schedule(input.sessionID)),
          Effect.ensuring(memory.checkpoint(input.sessionID)),
        ),
        ready,
      )
    })

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* assertLegacy(input.sessionID)
      yield* Effect.logInfo("command", {
        "session.id": input.sessionID,
        command: input.command,
        agent: input.agent,
      })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* currentModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* resolvePromptParts(template)
      const inputFiles = new Set(
        input.parts?.filter((part) => new URL(part.url).protocol === "file:").map((part) => fileURLToPath(part.url)),
      )
      const uniqueTemplateParts = templateParts.filter(
        (part) => part.type !== "file" || !inputFiles.has(fileURLToPath(part.url)),
      )
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const skillCommandText =
        cmd.source === "skill" || Boolean(cmd.template)
          ? `/${input.command}${input.arguments.trim() ? ` ${input.arguments.trim()}` : ""}`
          : undefined
      const parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [
            ...(skillCommandText ? [{ type: "text" as const, text: skillCommandText }] : []),
            ...uniqueTemplateParts.map((part) =>
              skillCommandText && part.type === "text" ? { ...part, synthetic: true } : part,
            ),
            ...(input.parts ?? []),
          ]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
      })
      yield* events.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    const owned = <A, E>(id: SessionID, effect: Effect.Effect<A, E>) =>
      lifecycle.read(id, effect).pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.interrupt))
    return Service.of({
      runGoal: (target, admitted, prepare) => owned(target.sessionID, runGoal(target, admitted, prepare)),
      init,
      cancel: (id) => owned(id, cancel(id)),
      prompt: (input) => owned(input.sessionID, prompt(input)),
      loop: (input) => owned(input.sessionID, loop(input)),
      shell: (input) => owned(input.sessionID, shell(input)),
      command: (input) => owned(input.sessionID, command(input)),
      resolvePromptParts,
    })
  }),
)

const ModelRef = Schema.Struct({
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(SessionV1.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  contextWindow: Schema.optional(Schema.Finite),
  parts: Schema.Array(
    Schema.Union([
      SessionV1.TextPartInput,
      SessionV1.FilePartInput,
      SessionV1.AgentPartInput,
      SessionV1.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
})
export type PromptInput = Schema.Schema.Type<typeof PromptInput>

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
}) {}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
})
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  // Inlined (no identifier annotation) to keep the original SDK output — the
  // PromptInput call site below references FilePartInput by ref via the
  // Schema export in message-v2.ts.
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(SessionV1.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    SessionLifecycle.node,
    SessionCommandSandbox.node,
    CompatHookSnapshotLocation.node,
    HostHookSnapshot.node,
    LocationRuntimeGuard.node,
    SessionGoalModel.node,
    SessionGoalCleanup.node,
    BackgroundJob.node,
    SessionMemory.node,
    SessionMemoryFlush.node,
    SessionMemoryContext.node,
    SessionMemoryBackend.node,
    SessionMemoryCapture.node,
    SessionStatus.node,
    Session.node,
    Agent.node,
    Provider.node,
    SessionProcessor.node,
    SessionCompaction.node,
    Plugin.node,
    Command.node,
    Config.node,
    Permission.node,
    FSUtil.node,
    MCP.node,
    LSP.node,
    ToolRegistry.node,
    Truncate.node,
    Image.node,
    CrossSpawnSpawner.node,
    Instruction.node,
    SessionRunState.node,
    SessionRevert.node,
    SessionSummary.node,
    SystemPrompt.node,
    LLM.node,
    EventV2Bridge.node,
    RuntimeFlags.node,
    Database.node,
  ],
})

export * as SessionPrompt from "./prompt"
