import { MCP } from "@/mcp"

import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Worktree } from "@/worktree"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"
import { QueryBoolean } from "./query"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { BackgroundTask } from "@apexo/schema/background-task"
import {
  ApiNotFoundError,
  ConflictError,
  ForbiddenError,
  ServiceUnavailableError,
  InvalidRequestError,
} from "../errors"
import { MemoryNote } from "@apexo/schema/memory-note"
import { MemoryMode } from "@apexo/schema/memory-mode"
import { MemoryHealth } from "@apexo/schema/memory-health"
import { MemoryReview } from "@apexo/schema/memory-review"
import { MemoryWork } from "@apexo/schema/memory-work"
import { HostHooks } from "@apexo/schema/host-hooks"

const CapabilitiesResponse = Schema.Struct({
  backgroundSubagents: Schema.Boolean,
  memoryManagement: Schema.Boolean,
}).annotate({ identifier: "ExperimentalCapabilities" })

const ToolIDs = Schema.Array(Schema.String).annotate({ identifier: "ToolIDs" })
const ToolListItem = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  parameters: Schema.Unknown,
}).annotate({ identifier: "ToolListItem" })
const ToolList = Schema.Array(ToolListItem).annotate({ identifier: "ToolList" })
export const ToolListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  provider: ProviderV2.ID,
  model: ModelV2.ID,
  sessionID: Schema.optional(SessionID),
})

const WorktreeList = Schema.Array(Schema.String)
const WorktreeErrorName = Schema.Union([
  Schema.Literal("WorktreeNotGitError"),
  Schema.Literal("WorktreeNameGenerationFailedError"),
  Schema.Literal("WorktreeCreateFailedError"),
  Schema.Literal("WorktreeStartCommandFailedError"),
  Schema.Literal("WorktreeRemoveFailedError"),
  Schema.Literal("WorktreeResetFailedError"),
  Schema.Literal("WorktreeListFailedError"),
])
export class WorktreeApiError extends Schema.ErrorClass<WorktreeApiError>("WorktreeError")(
  {
    name: WorktreeErrorName,
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}
export const SessionListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  archived: Schema.optional(QueryBoolean),
})

export const ExperimentalPaths = {
  capabilities: "/experimental/capabilities",
  hooks: "/hooks",
  tool: "/experimental/tool",
  toolIDs: "/experimental/tool/ids",
  worktree: "/experimental/worktree",
  worktreeReset: "/experimental/worktree/reset",
  session: "/experimental/session",
  sessionBackground: "/experimental/session/:sessionID/background",
  tasks: "/experimental/session/:sessionID/task",
  task: "/experimental/session/:sessionID/task/:taskID",
  taskCancel: "/experimental/session/:sessionID/task/:taskID/cancel",
  memory: "/experimental/session/:sessionID/memory",
  memoryStatus: "/experimental/session/:sessionID/memory/status",
  memoryHealth: "/experimental/session/:sessionID/memory/health",
  memoryToggle: "/experimental/session/:sessionID/memory/toggle",
  memoryNote: "/experimental/session/:sessionID/memory/note",
  memoryForget: "/experimental/session/:sessionID/memory/forget",
  memoryRemember: "/experimental/session/:sessionID/memory/remember",
  memoryRewrite: "/experimental/session/:sessionID/memory/rewrite",
  memoryWork: "/experimental/session/:sessionID/memory/operation",
  memoryWorkCancel: "/experimental/session/:sessionID/memory/operation/cancel",
  resource: "/experimental/resource",
} as const

export const ExperimentalApi = HttpApi.make("experimental")
  .add(
    HttpApiGroup.make("experimental")
      .add(
        HttpApiEndpoint.get("hooks", ExperimentalPaths.hooks, {
          query: WorkspaceRoutingQuery,
          success: HostHooks.Inspection,
          error: ServiceUnavailableError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.hooks",
            summary: "Inspect host hook configuration without exposing executable content or secrets",
          }),
        ),
        HttpApiEndpoint.get("capabilities", ExperimentalPaths.capabilities, {
          query: WorkspaceRoutingQuery,
          success: described(CapabilitiesResponse, "Experimental capabilities"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.capabilities.get",
            summary: "Get experimental capabilities",
            description: "Get experimental features enabled on the Apexo server.",
          }),
        ),
        HttpApiEndpoint.get("tool", ExperimentalPaths.tool, {
          query: ToolListQuery,
          success: described(ToolList, "Tools"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tool.list",
            summary: "List tools",
            description:
              "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
          }),
        ),
        HttpApiEndpoint.get("toolIDs", ExperimentalPaths.toolIDs, {
          query: WorkspaceRoutingQuery,
          success: described(ToolIDs, "Tool IDs"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tool.ids",
            summary: "List tool IDs",
            description:
              "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
          }),
        ),
        HttpApiEndpoint.get("worktree", ExperimentalPaths.worktree, {
          query: WorkspaceRoutingQuery,
          success: described(WorktreeList, "List of worktree directories"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.list",
            summary: "List worktrees",
            description: "List all sandbox worktrees for the current project.",
          }),
        ),
        HttpApiEndpoint.post("worktreeCreate", ExperimentalPaths.worktree, {
          disableCodecs: true,
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, Worktree.CreateInput],
          success: described(Worktree.Info, "Worktree created"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.create",
            summary: "Create worktree",
            description: "Create a new git worktree for the current project and run any configured startup scripts.",
          }),
        ),
        HttpApiEndpoint.delete("worktreeRemove", ExperimentalPaths.worktree, {
          query: WorkspaceRoutingQuery,
          payload: Worktree.RemoveInput,
          success: described(Schema.Boolean, "Worktree removed"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.remove",
            summary: "Remove worktree",
            description: "Remove a git worktree and delete its branch.",
          }),
        ),
        HttpApiEndpoint.post("worktreeReset", ExperimentalPaths.worktreeReset, {
          query: WorkspaceRoutingQuery,
          payload: Worktree.ResetInput,
          success: described(Schema.Boolean, "Worktree reset"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.reset",
            summary: "Reset worktree",
            description: "Reset a worktree branch to the primary default branch.",
          }),
        ),
        HttpApiEndpoint.get("session", ExperimentalPaths.session, {
          query: SessionListQuery,
          success: described(Schema.Array(Session.GlobalInfo), "List of sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.list",
            summary: "List sessions",
            description:
              "Get a list of all Apexo sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.",
          }),
        ),
        HttpApiEndpoint.post("sessionBackground", ExperimentalPaths.sessionBackground, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Backgrounded foreground tasks"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.background",
            summary: "Background running tasks",
            description:
              "Continue running foreground Shell commands and enabled synchronous subagents in the background without restarting them.",
          }),
        ),
        HttpApiEndpoint.get("tasks", ExperimentalPaths.tasks, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(BackgroundTask.Summary), "Session tasks"),
        }).annotateMerge(OpenApi.annotations({ identifier: "experimental.task.list", summary: "List session tasks" })),
        HttpApiEndpoint.get("task", ExperimentalPaths.task, {
          params: { sessionID: SessionID, taskID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(BackgroundTask.Detail, "Task status and output"),
          error: ApiNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({ identifier: "experimental.task.get", summary: "Read session task output" }),
        ),
        HttpApiEndpoint.post("taskCancel", ExperimentalPaths.taskCancel, {
          params: { sessionID: SessionID, taskID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(BackgroundTask.Summary, "Cancelled or already finished task"),
          error: ApiNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({ identifier: "experimental.task.cancel", summary: "Cancel a session task" }),
        ),
        HttpApiEndpoint.get("memoryHealth", ExperimentalPaths.memoryHealth, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: MemoryHealth.Info,
          error: [ApiNotFoundError, ForbiddenError, ConflictError, ServiceUnavailableError, InvalidRequestError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.memory.health",
            summary: "Read memory health without running maintenance",
          }),
        ),
        HttpApiEndpoint.get("memoryStatus", ExperimentalPaths.memoryStatus, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: MemoryMode.Info,
          error: [ApiNotFoundError, ForbiddenError, ConflictError, ServiceUnavailableError, InvalidRequestError],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "experimental.memory.status", summary: "Read session memory state" }),
        ),
        HttpApiEndpoint.post("memoryToggle", ExperimentalPaths.memoryToggle, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: MemoryMode.Update,
          success: MemoryMode.Info,
          error: [ApiNotFoundError, ForbiddenError, ConflictError, ServiceUnavailableError, InvalidRequestError],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "experimental.memory.toggle", summary: "Set session memory state" }),
        ),
        HttpApiEndpoint.get("memory", ExperimentalPaths.memory, {
          params: { sessionID: SessionID },
          query: Schema.Struct({ ...WorkspaceRoutingQueryFields, search: Schema.optional(Schema.String) }),
          success: described(Schema.Array(MemoryNote.Summary), "Memory notes"),
          error: [ApiNotFoundError, ForbiddenError, ConflictError, ServiceUnavailableError, InvalidRequestError],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "experimental.memory.list", summary: "Browse memory notes" }),
        ),
        HttpApiEndpoint.get("memoryNote", ExperimentalPaths.memoryNote, {
          params: { sessionID: SessionID },
          query: Schema.Struct({ ...WorkspaceRoutingQueryFields, path: Schema.String }),
          success: described(MemoryNote.Detail, "Memory preview and content hash"),
          error: [ApiNotFoundError, ForbiddenError, ConflictError, ServiceUnavailableError, InvalidRequestError],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "experimental.memory.get", summary: "Preview a memory note" }),
        ),
        HttpApiEndpoint.post("memoryForget", ExperimentalPaths.memoryForget, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: MemoryNote.Forget,
          success: described(Schema.Boolean, "Memory note deleted"),
          error: [ApiNotFoundError, ForbiddenError, ConflictError, ServiceUnavailableError, InvalidRequestError],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "experimental.memory.forget", summary: "Delete an unchanged memory note" }),
        ),
        HttpApiEndpoint.post("memoryRemember", ExperimentalPaths.memoryRemember, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: MemoryReview.Save,
          success: described(MemoryReview.Saved, "Confirmed memory note saved"),
          error: [ApiNotFoundError, ForbiddenError, ConflictError, ServiceUnavailableError, InvalidRequestError],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "experimental.memory.remember", summary: "Save a reviewed memory note" }),
        ),
        HttpApiEndpoint.get("memoryWork", ExperimentalPaths.memoryWork, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: Schema.NullOr(MemoryWork.Info),
          error: [ApiNotFoundError, ForbiddenError, ConflictError, ServiceUnavailableError, InvalidRequestError],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "experimental.memory.operation", summary: "Read latest memory operation" }),
        ),
        HttpApiEndpoint.post("memoryWorkStart", ExperimentalPaths.memoryWork, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: MemoryWork.Start,
          success: MemoryWork.Info,
          error: [ApiNotFoundError, ForbiddenError, ConflictError, ServiceUnavailableError, InvalidRequestError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.memory.start",
            summary: "Start memory extraction or consolidation",
          }),
        ),
        HttpApiEndpoint.post("memoryWorkCancel", ExperimentalPaths.memoryWorkCancel, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: MemoryWork.Cancel,
          success: MemoryWork.Info,
          error: [ApiNotFoundError, ForbiddenError, ConflictError, ServiceUnavailableError, InvalidRequestError],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "experimental.memory.cancel", summary: "Cancel a memory operation" }),
        ),
        HttpApiEndpoint.post("memoryRewrite", ExperimentalPaths.memoryRewrite, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: MemoryReview.Rewrite,
          success: described(MemoryReview.Rewritten, "Unsaved rewritten draft"),
          error: [ApiNotFoundError, ForbiddenError, ConflictError, ServiceUnavailableError, InvalidRequestError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.memory.rewrite",
            summary: "Rewrite a draft without saving or adding a conversation turn",
          }),
        ),
        HttpApiEndpoint.get("resource", ExperimentalPaths.resource, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Record(Schema.String, MCP.Resource), "MCP resources"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.resource.list",
            summary: "Get MCP resources",
            description: "Get all available MCP resources from connected servers. Optionally filter by name.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "experimental",
          description: "Experimental HttpApi read-only routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "apexo experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
