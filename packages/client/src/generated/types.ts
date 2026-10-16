import type { ApexoEventEncoded } from "@apexo/protocol/groups/event"

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

export type UnauthorizedError = { readonly _tag: "UnauthorizedError"; readonly message: string }
export const isUnauthorizedError = (value: unknown): value is UnauthorizedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError"

export type InvalidRequestError = {
  readonly _tag: "InvalidRequestError"
  readonly message: string
  readonly kind?: string | undefined
  readonly field?: string | undefined
}
export const isInvalidRequestError = (value: unknown): value is InvalidRequestError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidRequestError"

export type ServiceUnavailableError = {
  readonly _tag: "ServiceUnavailableError"
  readonly message: string
  readonly service?: string | undefined
}
export const isServiceUnavailableError = (value: unknown): value is ServiceUnavailableError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ServiceUnavailableError"

export type InvalidCursorError = { readonly _tag: "InvalidCursorError"; readonly message: string }
export const isInvalidCursorError = (value: unknown): value is InvalidCursorError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidCursorError"

export type ConflictError = {
  readonly _tag: "ConflictError"
  readonly message: string
  readonly resource?: string | undefined
}
export const isConflictError = (value: unknown): value is ConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ConflictError"

export type SessionNotFoundError = {
  readonly _tag: "SessionNotFoundError"
  readonly sessionID: string
  readonly message: string
}
export const isSessionNotFoundError = (value: unknown): value is SessionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SessionNotFoundError"

export type MessageNotFoundError = {
  readonly _tag: "MessageNotFoundError"
  readonly sessionID: string
  readonly messageID: string
  readonly message: string
}
export const isMessageNotFoundError = (value: unknown): value is MessageNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "MessageNotFoundError"

export type UnknownError = {
  readonly _tag: "UnknownError"
  readonly message: string
  readonly ref?: string | undefined
}
export const isUnknownError = (value: unknown): value is UnknownError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnknownError"

export type GoalReportNotFoundError = { readonly _tag: "GoalReportNotFoundError"; readonly message: string }
export const isGoalReportNotFoundError = (value: unknown): value is GoalReportNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "GoalReportNotFoundError"

export type ForbiddenError = { readonly _tag: "ForbiddenError"; readonly message: string }
export const isForbiddenError = (value: unknown): value is ForbiddenError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ForbiddenError"

export type TaskNotFoundError = { readonly _tag: "TaskNotFoundError"; readonly message: string }
export const isTaskNotFoundError = (value: unknown): value is TaskNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "TaskNotFoundError"

export type ProcessNotFoundError = { readonly _tag: "ProcessNotFoundError"; readonly message: string }
export const isProcessNotFoundError = (value: unknown): value is ProcessNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProcessNotFoundError"

export type ScheduleNotFoundError = { readonly _tag: "ScheduleNotFoundError"; readonly message: string }
export const isScheduleNotFoundError = (value: unknown): value is ScheduleNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ScheduleNotFoundError"

export type FeedbackNotFoundError = { readonly _tag: "FeedbackNotFoundError"; readonly message: string }
export const isFeedbackNotFoundError = (value: unknown): value is FeedbackNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FeedbackNotFoundError"

export type MemoryForbiddenError = { readonly _tag: "MemoryForbiddenError"; readonly message: string }
export const isMemoryForbiddenError = (value: unknown): value is MemoryForbiddenError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "MemoryForbiddenError"

export type MemoryOperationNotFoundError = { readonly _tag: "MemoryOperationNotFoundError"; readonly message: string }
export const isMemoryOperationNotFoundError = (value: unknown): value is MemoryOperationNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "MemoryOperationNotFoundError"

export type McpServerNotFoundError = {
  readonly _tag: "McpServerNotFoundError"
  readonly server: string
  readonly message: string
}
export const isMcpServerNotFoundError = (value: unknown): value is McpServerNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "McpServerNotFoundError"

export type McpAttachmentForbidden = { readonly _tag: "McpAttachmentForbidden"; readonly message: string }
export const isMcpAttachmentForbidden = (value: unknown): value is McpAttachmentForbidden =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "McpAttachmentForbidden"

export type WorkflowNotFoundError = { readonly _tag: "WorkflowNotFoundError"; readonly message: string }
export const isWorkflowNotFoundError = (value: unknown): value is WorkflowNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "WorkflowNotFoundError"

export type ProviderNotFoundError = {
  readonly _tag: "ProviderNotFoundError"
  readonly providerID: string
  readonly message: string
}
export const isProviderNotFoundError = (value: unknown): value is ProviderNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProviderNotFoundError"

export type PermissionNotFoundError = {
  readonly _tag: "PermissionNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isPermissionNotFoundError = (value: unknown): value is PermissionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PermissionNotFoundError"

export type PtyNotFoundError = { readonly _tag: "PtyNotFoundError"; readonly ptyID: string; readonly message: string }
export const isPtyNotFoundError = (value: unknown): value is PtyNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PtyNotFoundError"

export type QuestionNotFoundError = {
  readonly _tag: "QuestionNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isQuestionNotFoundError = (value: unknown): value is QuestionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "QuestionNotFoundError"

export type ProjectCopyError = {
  readonly name: "ProjectCopyError"
  readonly data: { readonly message: string; readonly forceRequired?: boolean | undefined }
}
export const isProjectCopyError = (value: unknown): value is ProjectCopyError =>
  typeof value === "object" && value !== null && "name" in value && value["name"] === "ProjectCopyError"

export type HealthGetOutput = { readonly healthy: true }

export type ServerProjectListOutput = ReadonlyArray<{
  readonly id: string
  readonly worktree: string
  readonly vcs?: "git"
  readonly name?: string
  readonly icon?: { readonly url?: string; readonly override?: string; readonly color?: string }
  readonly commands?: { readonly start?: string }
  readonly time: { readonly created: number; readonly updated: number; readonly initialized?: number }
  readonly sandboxes: ReadonlyArray<string>
}>

export type ServerProjectCurrentInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerProjectCurrentOutput = { readonly id: string; readonly directory: string }

export type LocationGetInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type LocationGetOutput = {
  readonly directory: string
  readonly workspaceID?: string
  readonly project: { readonly id: string; readonly directory: string }
}

export type AgentsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type AgentsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
    readonly system?: string
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string | "primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info"
    readonly steps?: number
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }>
  }>
}

export type SessionsListInput = {
  readonly workspace?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["workspace"]
  readonly limit?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["limit"]
  readonly order?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["order"]
  readonly search?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["search"]
  readonly directory?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["directory"]
  readonly project?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["project"]
  readonly subpath?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["subpath"]
  readonly cursor?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["cursor"]
}

export type SessionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }>
  readonly cursor: { readonly previous?: string | null; readonly next?: string | null }
}

export type SessionsCreateInput = {
  readonly id?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
    readonly commandSandbox?: string
  }["id"]
  readonly agent?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
    readonly commandSandbox?: string
  }["agent"]
  readonly model?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
    readonly commandSandbox?: string
  }["model"]
  readonly location?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
    readonly commandSandbox?: string
  }["location"]
  readonly commandSandbox?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
    readonly commandSandbox?: string
  }["commandSandbox"]
}

export type SessionsCreateOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }
}["data"]

export type SessionsSandboxInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsSandboxOutput = {
  readonly scope: "native_commands"
  readonly stored: boolean
  readonly profile?: string
  readonly revision?: string
  readonly backend: {
    readonly kind: "seatbelt" | "bwrap" | "none"
    readonly availability: "unchecked" | "available" | "unsupported" | "unavailable"
  }
  readonly network?: "off" | "unrestricted"
  readonly latestExecution?: {
    readonly id: string
    readonly revision: string
    readonly backend: "seatbelt" | "bwrap"
    readonly confirmedAt: number
    readonly outcome: "exited"
    readonly exitCode: number
  }
  readonly failure?: {
    readonly code:
      | "invalid_policy"
      | "unsupported_platform"
      | "unavailable"
      | "identity_conflict"
      | "unsafe_path"
      | "missing_inheritance"
    readonly message: string
  }
}

export type SessionsActiveOutput = { readonly data: { readonly [x: string]: { readonly type: "running" } } }["data"]

export type SessionsGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsGetOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }
}["data"]

export type SessionsRemoveInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsRemoveOutput = void

export type SessionsSwitchAgentInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly agent: { readonly agent: string }["agent"]
}

export type SessionsSwitchAgentOutput = void

export type SessionsSwitchModelInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly model: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
  }["model"]
}

export type SessionsSwitchModelOutput = void

export type SessionsPromptInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly executionPolicy?: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" } | null
    readonly resume?: boolean | null
  }["id"]
  readonly prompt: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly executionPolicy?: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" } | null
    readonly resume?: boolean | null
  }["prompt"]
  readonly delivery?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly executionPolicy?: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" } | null
    readonly resume?: boolean | null
  }["delivery"]
  readonly executionPolicy?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly executionPolicy?: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" } | null
    readonly resume?: boolean | null
  }["executionPolicy"]
  readonly resume?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly executionPolicy?: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" } | null
    readonly resume?: boolean | null
  }["resume"]
}

export type SessionsPromptOutput = {
  readonly data: {
    readonly admittedSeq: number
    readonly id: string
    readonly sessionID: string
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly mime: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery: "steer" | "queue"
    readonly executionPolicy?: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" }
    readonly timeCreated: number
    readonly promotedSeq?: number
    readonly withdrawnSeq?: number
  }
}["data"]

export type SessionsInputExecutionInput = {
  readonly sessionID: { readonly sessionID: string; readonly inputID: string }["sessionID"]
  readonly inputID: { readonly sessionID: string; readonly inputID: string }["inputID"]
}

export type SessionsInputExecutionOutput = {
  readonly data: {
    readonly id: string
    readonly sessionID: string
    readonly policy: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" }
    readonly status: "admitted" | "active" | "completed" | "failed" | "interrupted" | "superseded"
    readonly admittedSeq: number
    readonly promotedSeq?: number
    readonly startedSeq?: number
    readonly endedSeq?: number
    readonly reason?:
      | "completed"
      | "provider_error"
      | "turn_limit"
      | "interrupted"
      | "process_restart"
      | "superseded"
      | "withdrawn"
      | "unavailable"
    readonly finish?: string
    readonly usageIncomplete: boolean
  }
}["data"]

export type SessionsInputWaitInput = {
  readonly sessionID: { readonly sessionID: string; readonly inputID: string }["sessionID"]
  readonly inputID: { readonly sessionID: string; readonly inputID: string }["inputID"]
  readonly timeoutMs?: { readonly timeoutMs?: number | undefined }["timeoutMs"]
}

export type SessionsInputWaitOutput = {
  readonly data: {
    readonly execution: {
      readonly id: string
      readonly sessionID: string
      readonly policy: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" }
      readonly status: "admitted" | "active" | "completed" | "failed" | "interrupted" | "superseded"
      readonly admittedSeq: number
      readonly promotedSeq?: number
      readonly startedSeq?: number
      readonly endedSeq?: number
      readonly reason?:
        | "completed"
        | "provider_error"
        | "turn_limit"
        | "interrupted"
        | "process_restart"
        | "superseded"
        | "withdrawn"
        | "unavailable"
      readonly finish?: string
      readonly usageIncomplete: boolean
    }
    readonly timedOut: boolean
  }
}["data"]

export type SessionsInputInterruptInput = {
  readonly sessionID: { readonly sessionID: string; readonly inputID: string }["sessionID"]
  readonly inputID: { readonly sessionID: string; readonly inputID: string }["inputID"]
}

export type SessionsInputInterruptOutput = {
  readonly data: {
    readonly id: string
    readonly sessionID: string
    readonly policy: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" }
    readonly status: "admitted" | "active" | "completed" | "failed" | "interrupted" | "superseded"
    readonly admittedSeq: number
    readonly promotedSeq?: number
    readonly startedSeq?: number
    readonly endedSeq?: number
    readonly reason?:
      | "completed"
      | "provider_error"
      | "turn_limit"
      | "interrupted"
      | "process_restart"
      | "superseded"
      | "withdrawn"
      | "unavailable"
    readonly finish?: string
    readonly usageIncomplete: boolean
  }
}["data"]

export type SessionsCompactInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsCompactOutput = void

export type SessionsRestoreInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsRestoreOutput = {
  readonly sessionID: string
  readonly schedules: ReadonlyArray<{
    readonly id: string
    readonly reason:
      | "restored"
      | "already_active"
      | "paused"
      | "stopped"
      | "expired"
      | "deleted"
      | "permission_required"
      | "denied"
      | "unavailable"
      | "goal_active"
      | "plan_pending"
      | "headless_input"
      | "unfinished_owner"
      | "changed"
  }>
}

export type SessionsWaitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsWaitOutput = void

export type SessionsStageInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID: { readonly messageID: string; readonly files?: boolean | undefined }["messageID"]
  readonly files?: { readonly messageID: string; readonly files?: boolean | undefined }["files"]
}

export type SessionsStageOutput = {
  readonly data: {
    readonly messageID: string
    readonly partID?: string
    readonly snapshot?: string
    readonly diff?: string
    readonly files?: ReadonlyArray<{
      readonly path: string
      readonly status: "added" | "modified" | "deleted"
      readonly additions: number
      readonly deletions: number
      readonly patch: string
    }>
  }
}["data"]

export type SessionsClearInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsClearOutput = void

export type SessionsCommitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsCommitOutput = void

export type SessionsContextInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsContextOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string
          readonly description?: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string
                      readonly description?: string
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: string
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: "unknown"; readonly message: string }
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
  >
}["data"]

export type SessionsHistoryInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: { readonly limit?: number | undefined; readonly after?: number | undefined }["limit"]
  readonly after?: { readonly limit?: number | undefined; readonly after?: number | undefined }["after"]
}

export type SessionsHistoryOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.history.copy.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly source: { readonly sessionID: string; readonly created: string; readonly revision: number }
          readonly count: number
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.history.copy.message"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly source: { readonly sessionID: string; readonly created: string; readonly revision: number }
          readonly sourceMessageID: string
          readonly message:
            | {
                readonly id: string
                readonly metadata?: { readonly [x: string]: JsonValue }
                readonly time: { readonly created: number }
                readonly type: "agent-switched"
                readonly agent: string
              }
            | {
                readonly id: string
                readonly metadata?: { readonly [x: string]: JsonValue }
                readonly time: { readonly created: number }
                readonly type: "model-switched"
                readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
              }
            | {
                readonly id: string
                readonly metadata?: { readonly [x: string]: JsonValue }
                readonly time: { readonly created: number }
                readonly text: string
                readonly files?: ReadonlyArray<{
                  readonly uri: string
                  readonly mime: string
                  readonly name?: string
                  readonly description?: string
                  readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                }>
                readonly agents?: ReadonlyArray<{
                  readonly name: string
                  readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                }>
                readonly type: "user"
              }
            | {
                readonly id: string
                readonly metadata?: { readonly [x: string]: JsonValue }
                readonly time: { readonly created: number }
                readonly sessionID: string
                readonly text: string
                readonly type: "synthetic"
              }
            | {
                readonly id: string
                readonly metadata?: { readonly [x: string]: JsonValue }
                readonly time: { readonly created: number }
                readonly type: "system"
                readonly text: string
              }
            | {
                readonly id: string
                readonly metadata?: { readonly [x: string]: JsonValue }
                readonly time: { readonly created: number; readonly completed?: number }
                readonly type: "shell"
                readonly callID: string
                readonly command: string
                readonly output: string
              }
            | {
                readonly id: string
                readonly metadata?: { readonly [x: string]: JsonValue }
                readonly time: { readonly created: number; readonly completed?: number }
                readonly type: "assistant"
                readonly agent: string
                readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
                readonly content: ReadonlyArray<
                  | { readonly type: "text"; readonly id: string; readonly text: string }
                  | {
                      readonly type: "reasoning"
                      readonly id: string
                      readonly text: string
                      readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                      readonly time?: { readonly created: number; readonly completed?: number }
                    }
                  | {
                      readonly type: "tool"
                      readonly id: string
                      readonly name: string
                      readonly provider?: {
                        readonly executed: boolean
                        readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                        readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                      }
                      readonly state:
                        | { readonly status: "pending"; readonly input: string }
                        | {
                            readonly status: "running"
                            readonly input: { readonly [x: string]: JsonValue }
                            readonly structured: { readonly [x: string]: JsonValue }
                            readonly content: ReadonlyArray<
                              | { readonly type: "text"; readonly text: string }
                              | {
                                  readonly type: "file"
                                  readonly uri: string
                                  readonly mime: string
                                  readonly name?: string
                                }
                            >
                          }
                        | {
                            readonly status: "completed"
                            readonly input: { readonly [x: string]: JsonValue }
                            readonly attachments?: ReadonlyArray<{
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string
                              readonly description?: string
                              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                            }>
                            readonly content: ReadonlyArray<
                              | { readonly type: "text"; readonly text: string }
                              | {
                                  readonly type: "file"
                                  readonly uri: string
                                  readonly mime: string
                                  readonly name?: string
                                }
                            >
                            readonly outputPaths?: ReadonlyArray<string>
                            readonly structured: { readonly [x: string]: JsonValue }
                            readonly result?: JsonValue
                          }
                        | {
                            readonly status: "error"
                            readonly input: { readonly [x: string]: JsonValue }
                            readonly content: ReadonlyArray<
                              | { readonly type: "text"; readonly text: string }
                              | {
                                  readonly type: "file"
                                  readonly uri: string
                                  readonly mime: string
                                  readonly name?: string
                                }
                            >
                            readonly structured: { readonly [x: string]: JsonValue }
                            readonly error: { readonly type: "unknown"; readonly message: string }
                            readonly result?: JsonValue
                          }
                      readonly time: {
                        readonly created: number
                        readonly ran?: number
                        readonly completed?: number
                        readonly pruned?: number
                      }
                    }
                >
                readonly snapshot?: {
                  readonly start?: string
                  readonly end?: string
                  readonly files?: ReadonlyArray<string>
                }
                readonly finish?: string
                readonly cost?: number
                readonly tokens?: {
                  readonly input: number
                  readonly output: number
                  readonly reasoning: number
                  readonly cache: { readonly read: number; readonly write: number }
                }
                readonly error?: { readonly type: "unknown"; readonly message: string }
              }
            | {
                readonly type: "compaction"
                readonly reason: "auto" | "manual"
                readonly summary: string
                readonly recent: string
                readonly id: string
                readonly metadata?: { readonly [x: string]: JsonValue }
                readonly time: { readonly created: number }
              }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.history.copy.completed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly source: { readonly sessionID: string; readonly created: string; readonly revision: number }
          readonly count: number
          readonly todos: ReadonlyArray<{
            readonly content: string
            readonly status: string
            readonly priority: string
          }>
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.agent.switched"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly agent: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.model.switched"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.moved"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly location: { readonly directory: string; readonly workspaceID?: string }
          readonly subdirectory?: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.prompted"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly prompt: {
            readonly text: string
            readonly files?: ReadonlyArray<{
              readonly uri: string
              readonly mime: string
              readonly name?: string
              readonly description?: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
            readonly agents?: ReadonlyArray<{
              readonly name: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
          }
          readonly delivery: "steer" | "queue"
          readonly executionPolicy?: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.prompt.admitted"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly prompt: {
            readonly text: string
            readonly files?: ReadonlyArray<{
              readonly uri: string
              readonly mime: string
              readonly name?: string
              readonly description?: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
            readonly agents?: ReadonlyArray<{
              readonly name: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
          }
          readonly delivery: "steer" | "queue"
          readonly executionPolicy?: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.prompt.withdrawn"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: { readonly timestamp: number; readonly sessionID: string; readonly messageID: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.input.execution.settled"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly status: "completed" | "failed" | "interrupted" | "superseded"
          readonly reason:
            | "completed"
            | "provider_error"
            | "turn_limit"
            | "interrupted"
            | "process_restart"
            | "superseded"
            | "withdrawn"
            | "unavailable"
          readonly finish?: string
          readonly usageIncomplete: boolean
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.context.updated"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.synthetic"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.shell.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly callID: string
          readonly command: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.shell.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly callID: string
          readonly output: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.step.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly agent: string
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly snapshot?: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.step.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly finish: string
          readonly cost: number
          readonly tokens: {
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
          readonly snapshot?: string
          readonly files?: ReadonlyArray<string>
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.step.failed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly error: { readonly type: "unknown"; readonly message: string }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.text.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly textID: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.text.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly textID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.input.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly name: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.input.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.called"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly tool: string
          readonly input: { readonly [x: string]: JsonValue }
          readonly provider: {
            readonly executed: boolean
            readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.progress"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly structured: { readonly [x: string]: JsonValue }
          readonly content: ReadonlyArray<
            | { readonly type: "text"; readonly text: string }
            | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
          >
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.success"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly structured: { readonly [x: string]: JsonValue }
          readonly content: ReadonlyArray<
            | { readonly type: "text"; readonly text: string }
            | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
          >
          readonly outputPaths?: ReadonlyArray<string>
          readonly result?: JsonValue
          readonly provider: {
            readonly executed: boolean
            readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.failed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly error: { readonly type: "unknown"; readonly message: string }
          readonly result?: JsonValue
          readonly provider: {
            readonly executed: boolean
            readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.reasoning.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly reasoningID: string
          readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.reasoning.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly reasoningID: string
          readonly text: string
          readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.retried"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly attempt: number
          readonly error: {
            readonly message: string
            readonly statusCode?: number
            readonly isRetryable: boolean
            readonly responseHeaders?: { readonly [x: string]: string }
            readonly responseBody?: string
            readonly metadata?: { readonly [x: string]: string }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.compaction.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly reason: "auto" | "manual"
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.compaction.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly reason: "auto" | "manual"
          readonly text: string
          readonly recent: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.revert.staged"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly revert: {
            readonly messageID: string
            readonly partID?: string
            readonly snapshot?: string
            readonly diff?: string
            readonly files?: ReadonlyArray<{
              readonly path: string
              readonly status: "added" | "modified" | "deleted"
              readonly additions: number
              readonly deletions: number
              readonly patch: string
            }>
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.revert.cleared"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: { readonly timestamp: number; readonly sessionID: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.revert.committed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: { readonly timestamp: number; readonly sessionID: string; readonly messageID: string }
      }
  >
  readonly hasMore: boolean
}

export type SessionsEventsInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly after?: { readonly after?: number | undefined }["after"]
}

export type SessionsEventsOutput =
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.history.copy.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly source: { readonly sessionID: string; readonly created: string; readonly revision: number }
        readonly count: number
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.history.copy.message"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly source: { readonly sessionID: string; readonly created: string; readonly revision: number }
        readonly sourceMessageID: string
        readonly message:
          | {
              readonly id: string
              readonly metadata?: { readonly [x: string]: unknown }
              readonly time: { readonly created: number }
              readonly type: "agent-switched"
              readonly agent: string
            }
          | {
              readonly id: string
              readonly metadata?: { readonly [x: string]: unknown }
              readonly time: { readonly created: number }
              readonly type: "model-switched"
              readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
            }
          | {
              readonly id: string
              readonly metadata?: { readonly [x: string]: unknown }
              readonly time: { readonly created: number }
              readonly text: string
              readonly files?: ReadonlyArray<{
                readonly uri: string
                readonly mime: string
                readonly name?: string
                readonly description?: string
                readonly source?: { readonly start: number; readonly end: number; readonly text: string }
              }>
              readonly agents?: ReadonlyArray<{
                readonly name: string
                readonly source?: { readonly start: number; readonly end: number; readonly text: string }
              }>
              readonly type: "user"
            }
          | {
              readonly id: string
              readonly metadata?: { readonly [x: string]: unknown }
              readonly time: { readonly created: number }
              readonly sessionID: string
              readonly text: string
              readonly type: "synthetic"
            }
          | {
              readonly id: string
              readonly metadata?: { readonly [x: string]: unknown }
              readonly time: { readonly created: number }
              readonly type: "system"
              readonly text: string
            }
          | {
              readonly id: string
              readonly metadata?: { readonly [x: string]: unknown }
              readonly time: { readonly created: number; readonly completed?: number }
              readonly type: "shell"
              readonly callID: string
              readonly command: string
              readonly output: string
            }
          | {
              readonly id: string
              readonly metadata?: { readonly [x: string]: unknown }
              readonly time: { readonly created: number; readonly completed?: number }
              readonly type: "assistant"
              readonly agent: string
              readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly content: ReadonlyArray<
                | { readonly type: "text"; readonly id: string; readonly text: string }
                | {
                    readonly type: "reasoning"
                    readonly id: string
                    readonly text: string
                    readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
                    readonly time?: { readonly created: number; readonly completed?: number }
                  }
                | {
                    readonly type: "tool"
                    readonly id: string
                    readonly name: string
                    readonly provider?: {
                      readonly executed: boolean
                      readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
                      readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
                    }
                    readonly state:
                      | { readonly status: "pending"; readonly input: string }
                      | {
                          readonly status: "running"
                          readonly input: { readonly [x: string]: unknown }
                          readonly structured: { readonly [x: string]: unknown }
                          readonly content: ReadonlyArray<
                            | { readonly type: "text"; readonly text: string }
                            | {
                                readonly type: "file"
                                readonly uri: string
                                readonly mime: string
                                readonly name?: string
                              }
                          >
                        }
                      | {
                          readonly status: "completed"
                          readonly input: { readonly [x: string]: unknown }
                          readonly attachments?: ReadonlyArray<{
                            readonly uri: string
                            readonly mime: string
                            readonly name?: string
                            readonly description?: string
                            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                          }>
                          readonly content: ReadonlyArray<
                            | { readonly type: "text"; readonly text: string }
                            | {
                                readonly type: "file"
                                readonly uri: string
                                readonly mime: string
                                readonly name?: string
                              }
                          >
                          readonly outputPaths?: ReadonlyArray<string>
                          readonly structured: { readonly [x: string]: unknown }
                          readonly result?: unknown
                        }
                      | {
                          readonly status: "error"
                          readonly input: { readonly [x: string]: unknown }
                          readonly content: ReadonlyArray<
                            | { readonly type: "text"; readonly text: string }
                            | {
                                readonly type: "file"
                                readonly uri: string
                                readonly mime: string
                                readonly name?: string
                              }
                          >
                          readonly structured: { readonly [x: string]: unknown }
                          readonly error: { readonly type: "unknown"; readonly message: string }
                          readonly result?: unknown
                        }
                    readonly time: {
                      readonly created: number
                      readonly ran?: number
                      readonly completed?: number
                      readonly pruned?: number
                    }
                  }
              >
              readonly snapshot?: {
                readonly start?: string
                readonly end?: string
                readonly files?: ReadonlyArray<string>
              }
              readonly finish?: string
              readonly cost?: number
              readonly tokens?: {
                readonly input: number
                readonly output: number
                readonly reasoning: number
                readonly cache: { readonly read: number; readonly write: number }
              }
              readonly error?: { readonly type: "unknown"; readonly message: string }
            }
          | {
              readonly type: "compaction"
              readonly reason: "auto" | "manual"
              readonly summary: string
              readonly recent: string
              readonly id: string
              readonly metadata?: { readonly [x: string]: unknown }
              readonly time: { readonly created: number }
            }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.history.copy.completed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly source: { readonly sessionID: string; readonly created: string; readonly revision: number }
        readonly count: number
        readonly todos: ReadonlyArray<{ readonly content: string; readonly status: string; readonly priority: string }>
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.agent.switched"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly agent: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.model.switched"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.moved"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly location: { readonly directory: string; readonly workspaceID?: string }
        readonly subdirectory?: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.prompted"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly prompt: {
          readonly text: string
          readonly files?: ReadonlyArray<{
            readonly uri: string
            readonly mime: string
            readonly name?: string
            readonly description?: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly agents?: ReadonlyArray<{
            readonly name: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
        }
        readonly delivery: "steer" | "queue"
        readonly executionPolicy?: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.prompt.admitted"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly prompt: {
          readonly text: string
          readonly files?: ReadonlyArray<{
            readonly uri: string
            readonly mime: string
            readonly name?: string
            readonly description?: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly agents?: ReadonlyArray<{
            readonly name: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
        }
        readonly delivery: "steer" | "queue"
        readonly executionPolicy?: { readonly mode: "headless"; readonly permissions: "reject" | "approve_once" }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.prompt.withdrawn"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly timestamp: number; readonly sessionID: string; readonly messageID: string }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.input.execution.settled"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly status: "completed" | "failed" | "interrupted" | "superseded"
        readonly reason:
          | "completed"
          | "provider_error"
          | "turn_limit"
          | "interrupted"
          | "process_restart"
          | "superseded"
          | "withdrawn"
          | "unavailable"
        readonly finish?: string
        readonly usageIncomplete: boolean
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.context.updated"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.synthetic"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.shell.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly callID: string
        readonly command: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.shell.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly callID: string
        readonly output: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.step.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly snapshot?: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.step.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly finish: string
        readonly cost: number
        readonly tokens: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly snapshot?: string
        readonly files?: ReadonlyArray<string>
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.step.failed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly error: { readonly type: "unknown"; readonly message: string }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.text.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly textID: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.text.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly textID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.input.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly name: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.input.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.called"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly tool: string
        readonly input: { readonly [x: string]: unknown }
        readonly provider: {
          readonly executed: boolean
          readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.progress"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly structured: { readonly [x: string]: unknown }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
        >
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.success"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly structured: { readonly [x: string]: unknown }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
        >
        readonly outputPaths?: ReadonlyArray<string>
        readonly result?: unknown
        readonly provider: {
          readonly executed: boolean
          readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.failed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly error: { readonly type: "unknown"; readonly message: string }
        readonly result?: unknown
        readonly provider: {
          readonly executed: boolean
          readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.reasoning.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly reasoningID: string
        readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.reasoning.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly reasoningID: string
        readonly text: string
        readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.retried"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly attempt: number
        readonly error: {
          readonly message: string
          readonly statusCode?: number
          readonly isRetryable: boolean
          readonly responseHeaders?: { readonly [x: string]: string }
          readonly responseBody?: string
          readonly metadata?: { readonly [x: string]: string }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.compaction.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly reason: "auto" | "manual"
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.compaction.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly reason: "auto" | "manual"
        readonly text: string
        readonly recent: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.revert.staged"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly revert: {
          readonly messageID: string
          readonly partID?: string
          readonly snapshot?: string
          readonly diff?: string
          readonly files?: ReadonlyArray<{
            readonly path: string
            readonly status: "added" | "modified" | "deleted"
            readonly additions: number
            readonly deletions: number
            readonly patch: string
          }>
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.revert.cleared"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly timestamp: number; readonly sessionID: string }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.revert.committed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly timestamp: number; readonly sessionID: string; readonly messageID: string }
    }

export type SessionsInterruptInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsInterruptOutput = void

export type SessionsMessageInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type SessionsMessageOutput = {
  readonly data:
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string
          readonly description?: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string
                      readonly description?: string
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: string
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: "unknown"; readonly message: string }
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
}["data"]

export type ServerGoalGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ServerGoalGetOutput = {
  readonly id: string
  readonly sessionID: string
  readonly objective: string
  readonly status:
    | "active"
    | "user_paused"
    | "back_off_paused"
    | "no_progress_paused"
    | "infra_paused"
    | "blocked"
    | "budget_limited"
    | "complete"
  readonly launch?: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
    readonly messageID: string
  }
  readonly phase: "idle" | "planning" | "executing" | "evaluating" | "verifying"
  readonly tokenBudget?: number
  readonly tokensUsed: number
  readonly usageIncomplete?: boolean
  readonly elapsedMs: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly revision: number
  readonly workerRounds: number
  readonly verificationRounds: number
  readonly message?: string
  readonly plan?: string
  readonly planProgress?: { readonly completed: ReadonlyArray<number>; readonly deviations: ReadonlyArray<string> }
  readonly plannerSessionID?: string
  readonly plannerExecution?: {
    readonly requested?: { readonly model: string; readonly agent_type: string }
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
    readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
  }
  readonly plannerFiles?: {
    readonly directory: string
    readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly workerScratch: string
  }
  readonly strategy?: {
    readonly round: number
    readonly workerRound: number
    readonly status: "running" | "advised" | "failed"
    readonly recommendation?: string
    readonly failure?: string
    readonly sessionID?: string
    readonly execution?: {
      readonly requested?: { readonly model: string; readonly agent_type: string }
      readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      readonly agent: string
      readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
    }
    readonly files?: {
      readonly directory: string
      readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly workerScratch: string
    }
  }
  readonly summary?: {
    readonly status: "running" | "completed" | "failed" | "skipped"
    readonly sessionID?: string
    readonly text?: string
    readonly reason?: "disabled" | "budget" | "interrupted" | "provider" | "output" | "usage" | "execution"
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly tokensUsed?: number
    readonly startedAt?: number
    readonly finishedAt?: number
  }
  readonly changesBaselineCommit?: string
  readonly skepticModels?: ReadonlyArray<{ readonly model: string; readonly agent_type: string }>
  readonly evaluation?: {
    readonly decision: "continue" | "candidate_complete" | "blocked"
    readonly evidence: string
    readonly next_step: string
    readonly blocker_key: string
  }
  readonly verification?: {
    readonly count: number
    readonly round: number
    readonly evidenceSha256: string
    readonly results: ReadonlyArray<{
      readonly achieved: boolean
      readonly evidence: string
      readonly unmet: ReadonlyArray<string>
      readonly confidence: "high" | "medium" | "low"
      readonly blocking: "none" | "contradiction" | "unverifiable"
      readonly index: number
      readonly callID: string
      readonly sessionID?: string
      readonly execution?: {
        readonly requested?: { readonly model: string; readonly agent_type: string }
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly agent: string
        readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
      }
      readonly files?: {
        readonly directory: string
        readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly workerScratch: string
      }
      readonly tokensUsed: number
      readonly elapsedMs: number
    }>
    readonly previous?: {
      readonly achieved: boolean
      readonly evidence: string
      readonly unmet: ReadonlyArray<string>
      readonly confidence: "high" | "medium" | "low"
      readonly blocking: "none" | "contradiction" | "unverifiable"
      readonly index: number
      readonly callID: string
      readonly sessionID?: string
      readonly execution?: {
        readonly requested?: { readonly model: string; readonly agent_type: string }
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly agent: string
        readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
      }
      readonly files?: {
        readonly directory: string
        readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly workerScratch: string
      }
      readonly tokensUsed: number
      readonly elapsedMs: number
    }
  }
  readonly unmet: ReadonlyArray<string>
  readonly history: ReadonlyArray<{
    readonly at: number
    readonly event:
      | "created"
      | "resumed"
      | "paused"
      | "recovered"
      | "planning_started"
      | "planning_completed"
      | "worker_started"
      | "worker_completed"
      | "evaluation_started"
      | "evaluation_completed"
      | "progress"
      | "completion_requested"
      | "verification_started"
      | "verification_rejected"
      | "completed"
      | "budget_exceeded"
      | "usage_incomplete"
    readonly message?: string
    readonly tokensUsed: number
  }>
} | null

export type ServerGoalCreateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id: { readonly id: string; readonly objective: string; readonly tokenBudget?: number }["id"]
  readonly objective: { readonly id: string; readonly objective: string; readonly tokenBudget?: number }["objective"]
  readonly tokenBudget?: {
    readonly id: string
    readonly objective: string
    readonly tokenBudget?: number
  }["tokenBudget"]
}

export type ServerGoalCreateOutput = {
  readonly id: string
  readonly sessionID: string
  readonly objective: string
  readonly status:
    | "active"
    | "user_paused"
    | "back_off_paused"
    | "no_progress_paused"
    | "infra_paused"
    | "blocked"
    | "budget_limited"
    | "complete"
  readonly launch?: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
    readonly messageID: string
  }
  readonly phase: "idle" | "planning" | "executing" | "evaluating" | "verifying"
  readonly tokenBudget?: number
  readonly tokensUsed: number
  readonly usageIncomplete?: boolean
  readonly elapsedMs: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly revision: number
  readonly workerRounds: number
  readonly verificationRounds: number
  readonly message?: string
  readonly plan?: string
  readonly planProgress?: { readonly completed: ReadonlyArray<number>; readonly deviations: ReadonlyArray<string> }
  readonly plannerSessionID?: string
  readonly plannerExecution?: {
    readonly requested?: { readonly model: string; readonly agent_type: string }
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
    readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
  }
  readonly plannerFiles?: {
    readonly directory: string
    readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly workerScratch: string
  }
  readonly strategy?: {
    readonly round: number
    readonly workerRound: number
    readonly status: "running" | "advised" | "failed"
    readonly recommendation?: string
    readonly failure?: string
    readonly sessionID?: string
    readonly execution?: {
      readonly requested?: { readonly model: string; readonly agent_type: string }
      readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      readonly agent: string
      readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
    }
    readonly files?: {
      readonly directory: string
      readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly workerScratch: string
    }
  }
  readonly summary?: {
    readonly status: "running" | "completed" | "failed" | "skipped"
    readonly sessionID?: string
    readonly text?: string
    readonly reason?: "disabled" | "budget" | "interrupted" | "provider" | "output" | "usage" | "execution"
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly tokensUsed?: number
    readonly startedAt?: number
    readonly finishedAt?: number
  }
  readonly changesBaselineCommit?: string
  readonly skepticModels?: ReadonlyArray<{ readonly model: string; readonly agent_type: string }>
  readonly evaluation?: {
    readonly decision: "continue" | "candidate_complete" | "blocked"
    readonly evidence: string
    readonly next_step: string
    readonly blocker_key: string
  }
  readonly verification?: {
    readonly count: number
    readonly round: number
    readonly evidenceSha256: string
    readonly results: ReadonlyArray<{
      readonly achieved: boolean
      readonly evidence: string
      readonly unmet: ReadonlyArray<string>
      readonly confidence: "high" | "medium" | "low"
      readonly blocking: "none" | "contradiction" | "unverifiable"
      readonly index: number
      readonly callID: string
      readonly sessionID?: string
      readonly execution?: {
        readonly requested?: { readonly model: string; readonly agent_type: string }
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly agent: string
        readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
      }
      readonly files?: {
        readonly directory: string
        readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly workerScratch: string
      }
      readonly tokensUsed: number
      readonly elapsedMs: number
    }>
    readonly previous?: {
      readonly achieved: boolean
      readonly evidence: string
      readonly unmet: ReadonlyArray<string>
      readonly confidence: "high" | "medium" | "low"
      readonly blocking: "none" | "contradiction" | "unverifiable"
      readonly index: number
      readonly callID: string
      readonly sessionID?: string
      readonly execution?: {
        readonly requested?: { readonly model: string; readonly agent_type: string }
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly agent: string
        readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
      }
      readonly files?: {
        readonly directory: string
        readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly workerScratch: string
      }
      readonly tokensUsed: number
      readonly elapsedMs: number
    }
  }
  readonly unmet: ReadonlyArray<string>
  readonly history: ReadonlyArray<{
    readonly at: number
    readonly event:
      | "created"
      | "resumed"
      | "paused"
      | "recovered"
      | "planning_started"
      | "planning_completed"
      | "worker_started"
      | "worker_completed"
      | "evaluation_started"
      | "evaluation_completed"
      | "progress"
      | "completion_requested"
      | "verification_started"
      | "verification_rejected"
      | "completed"
      | "budget_exceeded"
      | "usage_incomplete"
    readonly message?: string
    readonly tokensUsed: number
  }>
}

export type ServerGoalStartInput = {
  readonly sessionID: { readonly sessionID: string; readonly goalID: string }["sessionID"]
  readonly goalID: { readonly sessionID: string; readonly goalID: string }["goalID"]
  readonly model: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
  }["model"]
  readonly agent: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
  }["agent"]
}

export type ServerGoalStartOutput = {
  readonly id: string
  readonly sessionID: string
  readonly objective: string
  readonly status:
    | "active"
    | "user_paused"
    | "back_off_paused"
    | "no_progress_paused"
    | "infra_paused"
    | "blocked"
    | "budget_limited"
    | "complete"
  readonly launch?: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
    readonly messageID: string
  }
  readonly phase: "idle" | "planning" | "executing" | "evaluating" | "verifying"
  readonly tokenBudget?: number
  readonly tokensUsed: number
  readonly usageIncomplete?: boolean
  readonly elapsedMs: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly revision: number
  readonly workerRounds: number
  readonly verificationRounds: number
  readonly message?: string
  readonly plan?: string
  readonly planProgress?: { readonly completed: ReadonlyArray<number>; readonly deviations: ReadonlyArray<string> }
  readonly plannerSessionID?: string
  readonly plannerExecution?: {
    readonly requested?: { readonly model: string; readonly agent_type: string }
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
    readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
  }
  readonly plannerFiles?: {
    readonly directory: string
    readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly workerScratch: string
  }
  readonly strategy?: {
    readonly round: number
    readonly workerRound: number
    readonly status: "running" | "advised" | "failed"
    readonly recommendation?: string
    readonly failure?: string
    readonly sessionID?: string
    readonly execution?: {
      readonly requested?: { readonly model: string; readonly agent_type: string }
      readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      readonly agent: string
      readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
    }
    readonly files?: {
      readonly directory: string
      readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly workerScratch: string
    }
  }
  readonly summary?: {
    readonly status: "running" | "completed" | "failed" | "skipped"
    readonly sessionID?: string
    readonly text?: string
    readonly reason?: "disabled" | "budget" | "interrupted" | "provider" | "output" | "usage" | "execution"
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly tokensUsed?: number
    readonly startedAt?: number
    readonly finishedAt?: number
  }
  readonly changesBaselineCommit?: string
  readonly skepticModels?: ReadonlyArray<{ readonly model: string; readonly agent_type: string }>
  readonly evaluation?: {
    readonly decision: "continue" | "candidate_complete" | "blocked"
    readonly evidence: string
    readonly next_step: string
    readonly blocker_key: string
  }
  readonly verification?: {
    readonly count: number
    readonly round: number
    readonly evidenceSha256: string
    readonly results: ReadonlyArray<{
      readonly achieved: boolean
      readonly evidence: string
      readonly unmet: ReadonlyArray<string>
      readonly confidence: "high" | "medium" | "low"
      readonly blocking: "none" | "contradiction" | "unverifiable"
      readonly index: number
      readonly callID: string
      readonly sessionID?: string
      readonly execution?: {
        readonly requested?: { readonly model: string; readonly agent_type: string }
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly agent: string
        readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
      }
      readonly files?: {
        readonly directory: string
        readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly workerScratch: string
      }
      readonly tokensUsed: number
      readonly elapsedMs: number
    }>
    readonly previous?: {
      readonly achieved: boolean
      readonly evidence: string
      readonly unmet: ReadonlyArray<string>
      readonly confidence: "high" | "medium" | "low"
      readonly blocking: "none" | "contradiction" | "unverifiable"
      readonly index: number
      readonly callID: string
      readonly sessionID?: string
      readonly execution?: {
        readonly requested?: { readonly model: string; readonly agent_type: string }
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly agent: string
        readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
      }
      readonly files?: {
        readonly directory: string
        readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly workerScratch: string
      }
      readonly tokensUsed: number
      readonly elapsedMs: number
    }
  }
  readonly unmet: ReadonlyArray<string>
  readonly history: ReadonlyArray<{
    readonly at: number
    readonly event:
      | "created"
      | "resumed"
      | "paused"
      | "recovered"
      | "planning_started"
      | "planning_completed"
      | "worker_started"
      | "worker_completed"
      | "evaluation_started"
      | "evaluation_completed"
      | "progress"
      | "completion_requested"
      | "verification_started"
      | "verification_rejected"
      | "completed"
      | "budget_exceeded"
      | "usage_incomplete"
    readonly message?: string
    readonly tokensUsed: number
  }>
}

export type ServerGoalRunInput = {
  readonly sessionID: { readonly sessionID: string; readonly goalID: string }["sessionID"]
  readonly goalID: { readonly sessionID: string; readonly goalID: string }["goalID"]
}

export type ServerGoalRunOutput = {
  readonly id: string
  readonly sessionID: string
  readonly objective: string
  readonly status:
    | "active"
    | "user_paused"
    | "back_off_paused"
    | "no_progress_paused"
    | "infra_paused"
    | "blocked"
    | "budget_limited"
    | "complete"
  readonly launch?: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
    readonly messageID: string
  }
  readonly phase: "idle" | "planning" | "executing" | "evaluating" | "verifying"
  readonly tokenBudget?: number
  readonly tokensUsed: number
  readonly usageIncomplete?: boolean
  readonly elapsedMs: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly revision: number
  readonly workerRounds: number
  readonly verificationRounds: number
  readonly message?: string
  readonly plan?: string
  readonly planProgress?: { readonly completed: ReadonlyArray<number>; readonly deviations: ReadonlyArray<string> }
  readonly plannerSessionID?: string
  readonly plannerExecution?: {
    readonly requested?: { readonly model: string; readonly agent_type: string }
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
    readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
  }
  readonly plannerFiles?: {
    readonly directory: string
    readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly workerScratch: string
  }
  readonly strategy?: {
    readonly round: number
    readonly workerRound: number
    readonly status: "running" | "advised" | "failed"
    readonly recommendation?: string
    readonly failure?: string
    readonly sessionID?: string
    readonly execution?: {
      readonly requested?: { readonly model: string; readonly agent_type: string }
      readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      readonly agent: string
      readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
    }
    readonly files?: {
      readonly directory: string
      readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly workerScratch: string
    }
  }
  readonly summary?: {
    readonly status: "running" | "completed" | "failed" | "skipped"
    readonly sessionID?: string
    readonly text?: string
    readonly reason?: "disabled" | "budget" | "interrupted" | "provider" | "output" | "usage" | "execution"
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly tokensUsed?: number
    readonly startedAt?: number
    readonly finishedAt?: number
  }
  readonly changesBaselineCommit?: string
  readonly skepticModels?: ReadonlyArray<{ readonly model: string; readonly agent_type: string }>
  readonly evaluation?: {
    readonly decision: "continue" | "candidate_complete" | "blocked"
    readonly evidence: string
    readonly next_step: string
    readonly blocker_key: string
  }
  readonly verification?: {
    readonly count: number
    readonly round: number
    readonly evidenceSha256: string
    readonly results: ReadonlyArray<{
      readonly achieved: boolean
      readonly evidence: string
      readonly unmet: ReadonlyArray<string>
      readonly confidence: "high" | "medium" | "low"
      readonly blocking: "none" | "contradiction" | "unverifiable"
      readonly index: number
      readonly callID: string
      readonly sessionID?: string
      readonly execution?: {
        readonly requested?: { readonly model: string; readonly agent_type: string }
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly agent: string
        readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
      }
      readonly files?: {
        readonly directory: string
        readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly workerScratch: string
      }
      readonly tokensUsed: number
      readonly elapsedMs: number
    }>
    readonly previous?: {
      readonly achieved: boolean
      readonly evidence: string
      readonly unmet: ReadonlyArray<string>
      readonly confidence: "high" | "medium" | "low"
      readonly blocking: "none" | "contradiction" | "unverifiable"
      readonly index: number
      readonly callID: string
      readonly sessionID?: string
      readonly execution?: {
        readonly requested?: { readonly model: string; readonly agent_type: string }
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly agent: string
        readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
      }
      readonly files?: {
        readonly directory: string
        readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly workerScratch: string
      }
      readonly tokensUsed: number
      readonly elapsedMs: number
    }
  }
  readonly unmet: ReadonlyArray<string>
  readonly history: ReadonlyArray<{
    readonly at: number
    readonly event:
      | "created"
      | "resumed"
      | "paused"
      | "recovered"
      | "planning_started"
      | "planning_completed"
      | "worker_started"
      | "worker_completed"
      | "evaluation_started"
      | "evaluation_completed"
      | "progress"
      | "completion_requested"
      | "verification_started"
      | "verification_rejected"
      | "completed"
      | "budget_exceeded"
      | "usage_incomplete"
    readonly message?: string
    readonly tokensUsed: number
  }>
}

export type ServerGoalResumeInput = {
  readonly sessionID: { readonly sessionID: string; readonly goalID: string }["sessionID"]
  readonly goalID: { readonly sessionID: string; readonly goalID: string }["goalID"]
}

export type ServerGoalResumeOutput = {
  readonly id: string
  readonly sessionID: string
  readonly objective: string
  readonly status:
    | "active"
    | "user_paused"
    | "back_off_paused"
    | "no_progress_paused"
    | "infra_paused"
    | "blocked"
    | "budget_limited"
    | "complete"
  readonly launch?: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
    readonly messageID: string
  }
  readonly phase: "idle" | "planning" | "executing" | "evaluating" | "verifying"
  readonly tokenBudget?: number
  readonly tokensUsed: number
  readonly usageIncomplete?: boolean
  readonly elapsedMs: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly revision: number
  readonly workerRounds: number
  readonly verificationRounds: number
  readonly message?: string
  readonly plan?: string
  readonly planProgress?: { readonly completed: ReadonlyArray<number>; readonly deviations: ReadonlyArray<string> }
  readonly plannerSessionID?: string
  readonly plannerExecution?: {
    readonly requested?: { readonly model: string; readonly agent_type: string }
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
    readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
  }
  readonly plannerFiles?: {
    readonly directory: string
    readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly workerScratch: string
  }
  readonly strategy?: {
    readonly round: number
    readonly workerRound: number
    readonly status: "running" | "advised" | "failed"
    readonly recommendation?: string
    readonly failure?: string
    readonly sessionID?: string
    readonly execution?: {
      readonly requested?: { readonly model: string; readonly agent_type: string }
      readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      readonly agent: string
      readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
    }
    readonly files?: {
      readonly directory: string
      readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly workerScratch: string
    }
  }
  readonly summary?: {
    readonly status: "running" | "completed" | "failed" | "skipped"
    readonly sessionID?: string
    readonly text?: string
    readonly reason?: "disabled" | "budget" | "interrupted" | "provider" | "output" | "usage" | "execution"
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly tokensUsed?: number
    readonly startedAt?: number
    readonly finishedAt?: number
  }
  readonly changesBaselineCommit?: string
  readonly skepticModels?: ReadonlyArray<{ readonly model: string; readonly agent_type: string }>
  readonly evaluation?: {
    readonly decision: "continue" | "candidate_complete" | "blocked"
    readonly evidence: string
    readonly next_step: string
    readonly blocker_key: string
  }
  readonly verification?: {
    readonly count: number
    readonly round: number
    readonly evidenceSha256: string
    readonly results: ReadonlyArray<{
      readonly achieved: boolean
      readonly evidence: string
      readonly unmet: ReadonlyArray<string>
      readonly confidence: "high" | "medium" | "low"
      readonly blocking: "none" | "contradiction" | "unverifiable"
      readonly index: number
      readonly callID: string
      readonly sessionID?: string
      readonly execution?: {
        readonly requested?: { readonly model: string; readonly agent_type: string }
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly agent: string
        readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
      }
      readonly files?: {
        readonly directory: string
        readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly workerScratch: string
      }
      readonly tokensUsed: number
      readonly elapsedMs: number
    }>
    readonly previous?: {
      readonly achieved: boolean
      readonly evidence: string
      readonly unmet: ReadonlyArray<string>
      readonly confidence: "high" | "medium" | "low"
      readonly blocking: "none" | "contradiction" | "unverifiable"
      readonly index: number
      readonly callID: string
      readonly sessionID?: string
      readonly execution?: {
        readonly requested?: { readonly model: string; readonly agent_type: string }
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly agent: string
        readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
      }
      readonly files?: {
        readonly directory: string
        readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly workerScratch: string
      }
      readonly tokensUsed: number
      readonly elapsedMs: number
    }
  }
  readonly unmet: ReadonlyArray<string>
  readonly history: ReadonlyArray<{
    readonly at: number
    readonly event:
      | "created"
      | "resumed"
      | "paused"
      | "recovered"
      | "planning_started"
      | "planning_completed"
      | "worker_started"
      | "worker_completed"
      | "evaluation_started"
      | "evaluation_completed"
      | "progress"
      | "completion_requested"
      | "verification_started"
      | "verification_rejected"
      | "completed"
      | "budget_exceeded"
      | "usage_incomplete"
    readonly message?: string
    readonly tokensUsed: number
  }>
}

export type ServerGoalPauseInput = {
  readonly sessionID: { readonly sessionID: string; readonly goalID: string }["sessionID"]
  readonly goalID: { readonly sessionID: string; readonly goalID: string }["goalID"]
}

export type ServerGoalPauseOutput = {
  readonly id: string
  readonly sessionID: string
  readonly objective: string
  readonly status:
    | "active"
    | "user_paused"
    | "back_off_paused"
    | "no_progress_paused"
    | "infra_paused"
    | "blocked"
    | "budget_limited"
    | "complete"
  readonly launch?: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
    readonly messageID: string
  }
  readonly phase: "idle" | "planning" | "executing" | "evaluating" | "verifying"
  readonly tokenBudget?: number
  readonly tokensUsed: number
  readonly usageIncomplete?: boolean
  readonly elapsedMs: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly revision: number
  readonly workerRounds: number
  readonly verificationRounds: number
  readonly message?: string
  readonly plan?: string
  readonly planProgress?: { readonly completed: ReadonlyArray<number>; readonly deviations: ReadonlyArray<string> }
  readonly plannerSessionID?: string
  readonly plannerExecution?: {
    readonly requested?: { readonly model: string; readonly agent_type: string }
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent: string
    readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
  }
  readonly plannerFiles?: {
    readonly directory: string
    readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
    readonly workerScratch: string
  }
  readonly strategy?: {
    readonly round: number
    readonly workerRound: number
    readonly status: "running" | "advised" | "failed"
    readonly recommendation?: string
    readonly failure?: string
    readonly sessionID?: string
    readonly execution?: {
      readonly requested?: { readonly model: string; readonly agent_type: string }
      readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      readonly agent: string
      readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
    }
    readonly files?: {
      readonly directory: string
      readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
      readonly workerScratch: string
    }
  }
  readonly summary?: {
    readonly status: "running" | "completed" | "failed" | "skipped"
    readonly sessionID?: string
    readonly text?: string
    readonly reason?: "disabled" | "budget" | "interrupted" | "provider" | "output" | "usage" | "execution"
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly tokensUsed?: number
    readonly startedAt?: number
    readonly finishedAt?: number
  }
  readonly changesBaselineCommit?: string
  readonly skepticModels?: ReadonlyArray<{ readonly model: string; readonly agent_type: string }>
  readonly evaluation?: {
    readonly decision: "continue" | "candidate_complete" | "blocked"
    readonly evidence: string
    readonly next_step: string
    readonly blocker_key: string
  }
  readonly verification?: {
    readonly count: number
    readonly round: number
    readonly evidenceSha256: string
    readonly results: ReadonlyArray<{
      readonly achieved: boolean
      readonly evidence: string
      readonly unmet: ReadonlyArray<string>
      readonly confidence: "high" | "medium" | "low"
      readonly blocking: "none" | "contradiction" | "unverifiable"
      readonly index: number
      readonly callID: string
      readonly sessionID?: string
      readonly execution?: {
        readonly requested?: { readonly model: string; readonly agent_type: string }
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly agent: string
        readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
      }
      readonly files?: {
        readonly directory: string
        readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly workerScratch: string
      }
      readonly tokensUsed: number
      readonly elapsedMs: number
    }>
    readonly previous?: {
      readonly achieved: boolean
      readonly evidence: string
      readonly unmet: ReadonlyArray<string>
      readonly confidence: "high" | "medium" | "low"
      readonly blocking: "none" | "contradiction" | "unverifiable"
      readonly index: number
      readonly callID: string
      readonly sessionID?: string
      readonly execution?: {
        readonly requested?: { readonly model: string; readonly agent_type: string }
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly agent: string
        readonly fallback?: "model_unavailable" | "agent_unavailable" | "agent_incapable" | "spawn_failed"
      }
      readonly files?: {
        readonly directory: string
        readonly objective: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly evidence: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly plan: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly verdict?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly details?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly strategy?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changes?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly changedFiles?: { readonly path: string; readonly sha256: string; readonly bytes: number }
        readonly workerScratch: string
      }
      readonly tokensUsed: number
      readonly elapsedMs: number
    }
  }
  readonly unmet: ReadonlyArray<string>
  readonly history: ReadonlyArray<{
    readonly at: number
    readonly event:
      | "created"
      | "resumed"
      | "paused"
      | "recovered"
      | "planning_started"
      | "planning_completed"
      | "worker_started"
      | "worker_completed"
      | "evaluation_started"
      | "evaluation_completed"
      | "progress"
      | "completion_requested"
      | "verification_started"
      | "verification_rejected"
      | "completed"
      | "budget_exceeded"
      | "usage_incomplete"
    readonly message?: string
    readonly tokensUsed: number
  }>
}

export type ServerGoalClearInput = {
  readonly sessionID: { readonly sessionID: string; readonly goalID: string }["sessionID"]
  readonly goalID: { readonly sessionID: string; readonly goalID: string }["goalID"]
}

export type ServerGoalClearOutput = void

export type ServerGoalReportsInput = {
  readonly sessionID: { readonly sessionID: string; readonly goalID: string }["sessionID"]
  readonly goalID: { readonly sessionID: string; readonly goalID: string }["goalID"]
}

export type ServerGoalReportsOutput = ReadonlyArray<{
  readonly id: string
  readonly kind: "planning" | "verifying" | "strategizing"
  readonly createdAt?: number
  readonly complete: boolean
  readonly files: ReadonlyArray<{
    readonly key: "objective" | "evidence" | "plan" | "verdict" | "details" | "strategy" | "changes" | "changedFiles"
    readonly name: string
    readonly bytes: number
    readonly sha256: string
  }>
}>

export type ServerGoalReportInput = {
  readonly sessionID: {
    readonly sessionID: string
    readonly goalID: string
    readonly reportID: string
    readonly file: "objective" | "evidence" | "plan" | "verdict" | "details" | "strategy" | "changes" | "changedFiles"
  }["sessionID"]
  readonly goalID: {
    readonly sessionID: string
    readonly goalID: string
    readonly reportID: string
    readonly file: "objective" | "evidence" | "plan" | "verdict" | "details" | "strategy" | "changes" | "changedFiles"
  }["goalID"]
  readonly reportID: {
    readonly sessionID: string
    readonly goalID: string
    readonly reportID: string
    readonly file: "objective" | "evidence" | "plan" | "verdict" | "details" | "strategy" | "changes" | "changedFiles"
  }["reportID"]
  readonly file: {
    readonly sessionID: string
    readonly goalID: string
    readonly reportID: string
    readonly file: "objective" | "evidence" | "plan" | "verdict" | "details" | "strategy" | "changes" | "changedFiles"
  }["file"]
}

export type ServerGoalReportOutput = {
  readonly name: string
  readonly contentType: string
  readonly text: string
  readonly bytes: number
  readonly sha256: string
}

export type ServerGoalCleanupReportsInput = {
  readonly sessionID: { readonly sessionID: string; readonly goalID: string }["sessionID"]
  readonly goalID: { readonly sessionID: string; readonly goalID: string }["goalID"]
}

export type ServerGoalCleanupReportsOutput = { readonly removed: number; readonly failed: ReadonlyArray<string> }

export type ServerTaskSendInput = {
  readonly sessionID: { readonly sessionID: string; readonly taskID: string }["sessionID"]
  readonly taskID: { readonly sessionID: string; readonly taskID: string }["taskID"]
  readonly inputID: {
    readonly inputID: string
    readonly text: string
    readonly delivery?: "steer" | "queue" | "interject"
  }["inputID"]
  readonly text: {
    readonly inputID: string
    readonly text: string
    readonly delivery?: "steer" | "queue" | "interject"
  }["text"]
  readonly delivery?: {
    readonly inputID: string
    readonly text: string
    readonly delivery?: "steer" | "queue" | "interject"
  }["delivery"]
}

export type ServerTaskSendOutput = {
  readonly inputID: string
  readonly taskID: string
  readonly delivery: "steer" | "queue" | "interject"
  readonly status: "admitted" | "promoted" | "cancelled" | "interrupted"
  readonly admittedAt: number
  readonly promotedAt?: number
}

export type ServerTaskGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly taskID: string; readonly inputID: string }["sessionID"]
  readonly taskID: { readonly sessionID: string; readonly taskID: string; readonly inputID: string }["taskID"]
  readonly inputID: { readonly sessionID: string; readonly taskID: string; readonly inputID: string }["inputID"]
}

export type ServerTaskGetOutput = {
  readonly inputID: string
  readonly taskID: string
  readonly delivery: "steer" | "queue" | "interject"
  readonly status: "admitted" | "promoted" | "cancelled" | "interrupted"
  readonly admittedAt: number
  readonly promotedAt?: number
}

export type ServerTaskListInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: { readonly limit?: number | undefined }["limit"]
}

export type ServerTaskListOutput = ReadonlyArray<{
  readonly id: string
  readonly parentSessionID: string
  readonly description: string
  readonly status: "running" | "completed" | "failed" | "cancelled" | "interrupted"
  readonly background?: boolean
  readonly startedAt: number
  readonly completedAt?: number
  readonly blockedReason?: "process_restart"
}>

export type ServerTaskOutputInput = {
  readonly sessionID: { readonly sessionID: string; readonly taskID: string }["sessionID"]
  readonly taskID: { readonly sessionID: string; readonly taskID: string }["taskID"]
}

export type ServerTaskOutputOutput = {
  readonly id: string
  readonly parentSessionID: string
  readonly description: string
  readonly status: "running" | "completed" | "failed" | "cancelled" | "interrupted"
  readonly background?: boolean
  readonly startedAt: number
  readonly completedAt?: number
  readonly blockedReason?: "process_restart"
  readonly output: string
  readonly worktreePath?: string
  readonly interruptedByMessage?: boolean
}

export type ServerTaskWaitInput = {
  readonly sessionID: { readonly sessionID: string; readonly taskID: string }["sessionID"]
  readonly taskID: { readonly sessionID: string; readonly taskID: string }["taskID"]
  readonly timeoutMs?: { readonly timeoutMs?: number }["timeoutMs"]
}

export type ServerTaskWaitOutput = {
  readonly task: {
    readonly id: string
    readonly parentSessionID: string
    readonly description: string
    readonly status: "running" | "completed" | "failed" | "cancelled" | "interrupted"
    readonly background?: boolean
    readonly startedAt: number
    readonly completedAt?: number
    readonly blockedReason?: "process_restart"
    readonly output: string
    readonly worktreePath?: string
    readonly interruptedByMessage?: boolean
  }
  readonly timedOut: boolean
}

export type ServerTaskCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly taskID: string }["sessionID"]
  readonly taskID: { readonly sessionID: string; readonly taskID: string }["taskID"]
}

export type ServerTaskCancelOutput = void

export type ServerProcessListInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: { readonly limit?: number | undefined }["limit"]
}

export type ServerProcessListOutput = ReadonlyArray<{
  readonly id: string
  readonly sessionID: string
  readonly kind: "shell" | "monitor"
  readonly monitor?: {
    readonly persistent: boolean
    readonly timeoutMs: number
    readonly accepted: number
    readonly suppressed: number
    readonly overloaded: boolean
  }
  readonly description: string
  readonly status: "running" | "completed" | "failed" | "cancelled" | "interrupted"
  readonly background: boolean
  readonly startedAt: number
  readonly completedAt?: number
  readonly exitCode?: number
  readonly blockedReason?: "process_restart"
  readonly truncated: boolean
}>

export type ServerProcessOutputInput = {
  readonly sessionID: { readonly sessionID: string; readonly processID: string }["sessionID"]
  readonly processID: { readonly sessionID: string; readonly processID: string }["processID"]
}

export type ServerProcessOutputOutput = {
  readonly interruptedByMessage?: boolean
  readonly id: string
  readonly sessionID: string
  readonly kind: "shell" | "monitor"
  readonly monitor?: {
    readonly persistent: boolean
    readonly timeoutMs: number
    readonly accepted: number
    readonly suppressed: number
    readonly overloaded: boolean
  }
  readonly description: string
  readonly status: "running" | "completed" | "failed" | "cancelled" | "interrupted"
  readonly background: boolean
  readonly startedAt: number
  readonly completedAt?: number
  readonly exitCode?: number
  readonly blockedReason?: "process_restart"
  readonly truncated: boolean
  readonly output: string
}

export type ServerProcessWaitInput = {
  readonly sessionID: { readonly sessionID: string; readonly processID: string }["sessionID"]
  readonly processID: { readonly sessionID: string; readonly processID: string }["processID"]
  readonly timeoutMs?: { readonly timeoutMs?: number }["timeoutMs"]
}

export type ServerProcessWaitOutput = {
  readonly process: {
    readonly interruptedByMessage?: boolean
    readonly id: string
    readonly sessionID: string
    readonly kind: "shell" | "monitor"
    readonly monitor?: {
      readonly persistent: boolean
      readonly timeoutMs: number
      readonly accepted: number
      readonly suppressed: number
      readonly overloaded: boolean
    }
    readonly description: string
    readonly status: "running" | "completed" | "failed" | "cancelled" | "interrupted"
    readonly background: boolean
    readonly startedAt: number
    readonly completedAt?: number
    readonly exitCode?: number
    readonly blockedReason?: "process_restart"
    readonly truncated: boolean
    readonly output: string
  }
  readonly timedOut: boolean
}

export type ServerProcessCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly processID: string }["sessionID"]
  readonly processID: { readonly sessionID: string; readonly processID: string }["processID"]
}

export type ServerProcessCancelOutput = void

export type ServerScheduleListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ServerScheduleListOutput = ReadonlyArray<{
  readonly id: string
  readonly sessionID: string
  readonly promptPreview: string
  readonly intervalSeconds: number
  readonly durable: boolean
  readonly status: "active" | "paused" | "deleted" | "expired"
  readonly blockedReason?:
    | "restart_required"
    | "stopped"
    | "plan_pending"
    | "goal_active"
    | "busy"
    | "unavailable"
    | "denied"
  readonly createdAt: number
  readonly expiresAt: number
  readonly nextFireAt: number
  readonly latestTaskID?: string
  readonly occurrenceStatus?: "claimed" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
}>

export type ServerScheduleGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly scheduleID: string }["sessionID"]
  readonly scheduleID: { readonly sessionID: string; readonly scheduleID: string }["scheduleID"]
}

export type ServerScheduleGetOutput = {
  readonly id: string
  readonly sessionID: string
  readonly promptPreview: string
  readonly intervalSeconds: number
  readonly durable: boolean
  readonly status: "active" | "paused" | "deleted" | "expired"
  readonly blockedReason?:
    | "restart_required"
    | "stopped"
    | "plan_pending"
    | "goal_active"
    | "busy"
    | "unavailable"
    | "denied"
  readonly createdAt: number
  readonly expiresAt: number
  readonly nextFireAt: number
  readonly latestTaskID?: string
  readonly occurrenceStatus?: "claimed" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
  readonly prompt: string
}

export type ServerScheduleDeleteInput = {
  readonly sessionID: { readonly sessionID: string; readonly scheduleID: string }["sessionID"]
  readonly scheduleID: { readonly sessionID: string; readonly scheduleID: string }["scheduleID"]
}

export type ServerScheduleDeleteOutput = void

export type ServerSchedulePauseInput = {
  readonly sessionID: { readonly sessionID: string; readonly scheduleID: string }["sessionID"]
  readonly scheduleID: { readonly sessionID: string; readonly scheduleID: string }["scheduleID"]
}

export type ServerSchedulePauseOutput = {
  readonly id: string
  readonly sessionID: string
  readonly promptPreview: string
  readonly intervalSeconds: number
  readonly durable: boolean
  readonly status: "active" | "paused" | "deleted" | "expired"
  readonly blockedReason?:
    | "restart_required"
    | "stopped"
    | "plan_pending"
    | "goal_active"
    | "busy"
    | "unavailable"
    | "denied"
  readonly createdAt: number
  readonly expiresAt: number
  readonly nextFireAt: number
  readonly latestTaskID?: string
  readonly occurrenceStatus?: "claimed" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
  readonly prompt: string
}

export type ServerScheduleResumeInput = {
  readonly sessionID: { readonly sessionID: string; readonly scheduleID: string }["sessionID"]
  readonly scheduleID: { readonly sessionID: string; readonly scheduleID: string }["scheduleID"]
}

export type ServerScheduleResumeOutput = {
  readonly id: string
  readonly sessionID: string
  readonly promptPreview: string
  readonly intervalSeconds: number
  readonly durable: boolean
  readonly status: "active" | "paused" | "deleted" | "expired"
  readonly blockedReason?:
    | "restart_required"
    | "stopped"
    | "plan_pending"
    | "goal_active"
    | "busy"
    | "unavailable"
    | "denied"
  readonly createdAt: number
  readonly expiresAt: number
  readonly nextFireAt: number
  readonly latestTaskID?: string
  readonly occurrenceStatus?: "claimed" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
  readonly prompt: string
}

export type ServerFeedbackListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ServerFeedbackListOutput = ReadonlyArray<{
  readonly title: string
  readonly details: string
  readonly product_area?: string
  readonly type: "bug" | "idea" | "missing_capability"
  readonly task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
  readonly failure_mode?:
    | "overeager"
    | "stopped_early"
    | "unwanted_scope"
    | "didnt_ask_for_help"
    | "excessive_questions"
    | "subagent_overspawn"
    | "over_correction"
    | "ignored_instructions"
    | "hallucinated"
    | "sloppy_code"
    | "destructive"
    | "lost_context"
    | "stuck_in_a_loop"
    | "model_regression"
    | "disputed"
    | "wrong_tone"
    | "unclear_output"
    | "other"
  readonly id: string
  readonly sessionID: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly images?: ReadonlyArray<{
    readonly id: string
    readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
    readonly fileName: string
    readonly size: number
  }>
}>

export type ServerFeedbackSaveInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly title: {
    readonly title: string
    readonly details: string
    readonly product_area?: string
    readonly type: "bug" | "idea" | "missing_capability"
    readonly task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
    readonly failure_mode?:
      | "overeager"
      | "stopped_early"
      | "unwanted_scope"
      | "didnt_ask_for_help"
      | "excessive_questions"
      | "subagent_overspawn"
      | "over_correction"
      | "ignored_instructions"
      | "hallucinated"
      | "sloppy_code"
      | "destructive"
      | "lost_context"
      | "stuck_in_a_loop"
      | "model_regression"
      | "disputed"
      | "wrong_tone"
      | "unclear_output"
      | "other"
    readonly draft_id?: string
    readonly revision?: number
    readonly images?: ReadonlyArray<
      | { readonly id: string }
      | {
          readonly data: string
          readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
          readonly fileName?: string
        }
    >
  }["title"]
  readonly details: {
    readonly title: string
    readonly details: string
    readonly product_area?: string
    readonly type: "bug" | "idea" | "missing_capability"
    readonly task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
    readonly failure_mode?:
      | "overeager"
      | "stopped_early"
      | "unwanted_scope"
      | "didnt_ask_for_help"
      | "excessive_questions"
      | "subagent_overspawn"
      | "over_correction"
      | "ignored_instructions"
      | "hallucinated"
      | "sloppy_code"
      | "destructive"
      | "lost_context"
      | "stuck_in_a_loop"
      | "model_regression"
      | "disputed"
      | "wrong_tone"
      | "unclear_output"
      | "other"
    readonly draft_id?: string
    readonly revision?: number
    readonly images?: ReadonlyArray<
      | { readonly id: string }
      | {
          readonly data: string
          readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
          readonly fileName?: string
        }
    >
  }["details"]
  readonly product_area?: {
    readonly title: string
    readonly details: string
    readonly product_area?: string
    readonly type: "bug" | "idea" | "missing_capability"
    readonly task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
    readonly failure_mode?:
      | "overeager"
      | "stopped_early"
      | "unwanted_scope"
      | "didnt_ask_for_help"
      | "excessive_questions"
      | "subagent_overspawn"
      | "over_correction"
      | "ignored_instructions"
      | "hallucinated"
      | "sloppy_code"
      | "destructive"
      | "lost_context"
      | "stuck_in_a_loop"
      | "model_regression"
      | "disputed"
      | "wrong_tone"
      | "unclear_output"
      | "other"
    readonly draft_id?: string
    readonly revision?: number
    readonly images?: ReadonlyArray<
      | { readonly id: string }
      | {
          readonly data: string
          readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
          readonly fileName?: string
        }
    >
  }["product_area"]
  readonly type: {
    readonly title: string
    readonly details: string
    readonly product_area?: string
    readonly type: "bug" | "idea" | "missing_capability"
    readonly task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
    readonly failure_mode?:
      | "overeager"
      | "stopped_early"
      | "unwanted_scope"
      | "didnt_ask_for_help"
      | "excessive_questions"
      | "subagent_overspawn"
      | "over_correction"
      | "ignored_instructions"
      | "hallucinated"
      | "sloppy_code"
      | "destructive"
      | "lost_context"
      | "stuck_in_a_loop"
      | "model_regression"
      | "disputed"
      | "wrong_tone"
      | "unclear_output"
      | "other"
    readonly draft_id?: string
    readonly revision?: number
    readonly images?: ReadonlyArray<
      | { readonly id: string }
      | {
          readonly data: string
          readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
          readonly fileName?: string
        }
    >
  }["type"]
  readonly task_category?: {
    readonly title: string
    readonly details: string
    readonly product_area?: string
    readonly type: "bug" | "idea" | "missing_capability"
    readonly task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
    readonly failure_mode?:
      | "overeager"
      | "stopped_early"
      | "unwanted_scope"
      | "didnt_ask_for_help"
      | "excessive_questions"
      | "subagent_overspawn"
      | "over_correction"
      | "ignored_instructions"
      | "hallucinated"
      | "sloppy_code"
      | "destructive"
      | "lost_context"
      | "stuck_in_a_loop"
      | "model_regression"
      | "disputed"
      | "wrong_tone"
      | "unclear_output"
      | "other"
    readonly draft_id?: string
    readonly revision?: number
    readonly images?: ReadonlyArray<
      | { readonly id: string }
      | {
          readonly data: string
          readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
          readonly fileName?: string
        }
    >
  }["task_category"]
  readonly failure_mode?: {
    readonly title: string
    readonly details: string
    readonly product_area?: string
    readonly type: "bug" | "idea" | "missing_capability"
    readonly task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
    readonly failure_mode?:
      | "overeager"
      | "stopped_early"
      | "unwanted_scope"
      | "didnt_ask_for_help"
      | "excessive_questions"
      | "subagent_overspawn"
      | "over_correction"
      | "ignored_instructions"
      | "hallucinated"
      | "sloppy_code"
      | "destructive"
      | "lost_context"
      | "stuck_in_a_loop"
      | "model_regression"
      | "disputed"
      | "wrong_tone"
      | "unclear_output"
      | "other"
    readonly draft_id?: string
    readonly revision?: number
    readonly images?: ReadonlyArray<
      | { readonly id: string }
      | {
          readonly data: string
          readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
          readonly fileName?: string
        }
    >
  }["failure_mode"]
  readonly draft_id?: {
    readonly title: string
    readonly details: string
    readonly product_area?: string
    readonly type: "bug" | "idea" | "missing_capability"
    readonly task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
    readonly failure_mode?:
      | "overeager"
      | "stopped_early"
      | "unwanted_scope"
      | "didnt_ask_for_help"
      | "excessive_questions"
      | "subagent_overspawn"
      | "over_correction"
      | "ignored_instructions"
      | "hallucinated"
      | "sloppy_code"
      | "destructive"
      | "lost_context"
      | "stuck_in_a_loop"
      | "model_regression"
      | "disputed"
      | "wrong_tone"
      | "unclear_output"
      | "other"
    readonly draft_id?: string
    readonly revision?: number
    readonly images?: ReadonlyArray<
      | { readonly id: string }
      | {
          readonly data: string
          readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
          readonly fileName?: string
        }
    >
  }["draft_id"]
  readonly revision?: {
    readonly title: string
    readonly details: string
    readonly product_area?: string
    readonly type: "bug" | "idea" | "missing_capability"
    readonly task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
    readonly failure_mode?:
      | "overeager"
      | "stopped_early"
      | "unwanted_scope"
      | "didnt_ask_for_help"
      | "excessive_questions"
      | "subagent_overspawn"
      | "over_correction"
      | "ignored_instructions"
      | "hallucinated"
      | "sloppy_code"
      | "destructive"
      | "lost_context"
      | "stuck_in_a_loop"
      | "model_regression"
      | "disputed"
      | "wrong_tone"
      | "unclear_output"
      | "other"
    readonly draft_id?: string
    readonly revision?: number
    readonly images?: ReadonlyArray<
      | { readonly id: string }
      | {
          readonly data: string
          readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
          readonly fileName?: string
        }
    >
  }["revision"]
  readonly images?: {
    readonly title: string
    readonly details: string
    readonly product_area?: string
    readonly type: "bug" | "idea" | "missing_capability"
    readonly task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
    readonly failure_mode?:
      | "overeager"
      | "stopped_early"
      | "unwanted_scope"
      | "didnt_ask_for_help"
      | "excessive_questions"
      | "subagent_overspawn"
      | "over_correction"
      | "ignored_instructions"
      | "hallucinated"
      | "sloppy_code"
      | "destructive"
      | "lost_context"
      | "stuck_in_a_loop"
      | "model_regression"
      | "disputed"
      | "wrong_tone"
      | "unclear_output"
      | "other"
    readonly draft_id?: string
    readonly revision?: number
    readonly images?: ReadonlyArray<
      | { readonly id: string }
      | {
          readonly data: string
          readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
          readonly fileName?: string
        }
    >
  }["images"]
}

export type ServerFeedbackSaveOutput = {
  readonly title: string
  readonly details: string
  readonly product_area?: string
  readonly type: "bug" | "idea" | "missing_capability"
  readonly task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
  readonly failure_mode?:
    | "overeager"
    | "stopped_early"
    | "unwanted_scope"
    | "didnt_ask_for_help"
    | "excessive_questions"
    | "subagent_overspawn"
    | "over_correction"
    | "ignored_instructions"
    | "hallucinated"
    | "sloppy_code"
    | "destructive"
    | "lost_context"
    | "stuck_in_a_loop"
    | "model_regression"
    | "disputed"
    | "wrong_tone"
    | "unclear_output"
    | "other"
  readonly id: string
  readonly sessionID: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly images?: ReadonlyArray<{
    readonly id: string
    readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
    readonly fileName: string
    readonly size: number
  }>
}

export type ServerFeedbackReviewInput = {
  readonly sessionID: { readonly sessionID: string; readonly draftID: string }["sessionID"]
  readonly draftID: { readonly sessionID: string; readonly draftID: string }["draftID"]
  readonly revision: { readonly revision: number }["revision"]
}

export type ServerFeedbackReviewOutput = {
  readonly draft: {
    readonly title: string
    readonly details: string
    readonly product_area?: string
    readonly type: "bug" | "idea" | "missing_capability"
    readonly task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
    readonly failure_mode?:
      | "overeager"
      | "stopped_early"
      | "unwanted_scope"
      | "didnt_ask_for_help"
      | "excessive_questions"
      | "subagent_overspawn"
      | "over_correction"
      | "ignored_instructions"
      | "hallucinated"
      | "sloppy_code"
      | "destructive"
      | "lost_context"
      | "stuck_in_a_loop"
      | "model_regression"
      | "disputed"
      | "wrong_tone"
      | "unclear_output"
      | "other"
    readonly id: string
    readonly sessionID: string
    readonly revision: number
    readonly createdAt: number
    readonly updatedAt: number
    readonly images?: ReadonlyArray<{
      readonly id: string
      readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
      readonly fileName: string
      readonly size: number
    }>
  }
  readonly title: string
  readonly body: string
  readonly url: string
}

export type ServerFeedbackImageInput = {
  readonly sessionID: { readonly sessionID: string; readonly draftID: string; readonly imageID: string }["sessionID"]
  readonly draftID: { readonly sessionID: string; readonly draftID: string; readonly imageID: string }["draftID"]
  readonly imageID: { readonly sessionID: string; readonly draftID: string; readonly imageID: string }["imageID"]
  readonly revision: { readonly revision: number }["revision"]
}

export type ServerFeedbackImageOutput = {
  readonly id: string
  readonly mimeType: "image/png" | "image/jpeg" | "image/gif"
  readonly fileName: string
  readonly size: number
  readonly data: string
}

export type ServerFeedbackRemoveInput = {
  readonly sessionID: { readonly sessionID: string; readonly draftID: string }["sessionID"]
  readonly draftID: { readonly sessionID: string; readonly draftID: string }["draftID"]
  readonly revision: { readonly revision: number }["revision"]
}

export type ServerFeedbackRemoveOutput = boolean

export type ServerMemoryStatusInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ServerMemoryStatusOutput = {
  readonly enabled: boolean
  readonly busy: boolean
  readonly canToggle: boolean
  readonly source: "process" | "profile" | "session" | "config" | "environment" | "default"
  readonly backend: "legacy" | "v2"
}

export type ServerMemoryToggleInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly enabled: { readonly enabled: boolean }["enabled"]
}

export type ServerMemoryToggleOutput = {
  readonly enabled: boolean
  readonly busy: boolean
  readonly canToggle: boolean
  readonly source: "process" | "profile" | "session" | "config" | "environment" | "default"
  readonly backend: "legacy" | "v2"
}

export type ServerMemoryListInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly query?: { readonly query?: string | undefined }["query"]
}

export type ServerMemoryListOutput = ReadonlyArray<{
  readonly path: string
  readonly name: string
  readonly source: "global" | "workspace" | "session"
  readonly size: number
  readonly modified: number
  readonly deletable: boolean
}>

export type ServerMemoryPreviewInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly path: { readonly path: string }["path"]
}

export type ServerMemoryPreviewOutput = {
  readonly path: string
  readonly name: string
  readonly source: "global" | "workspace" | "session"
  readonly size: number
  readonly modified: number
  readonly deletable: boolean
  readonly content: string
  readonly hash: string | null
  readonly truncated: boolean
}

export type ServerMemoryForgetInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly path: { readonly path: string; readonly hash: string }["path"]
  readonly hash: { readonly path: string; readonly hash: string }["hash"]
}

export type ServerMemoryForgetOutput = boolean

export type ServerMemoryOperationRetryInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id: { readonly id: string; readonly retryOf: string }["id"]
  readonly retryOf: { readonly id: string; readonly retryOf: string }["retryOf"]
}

export type ServerMemoryOperationRetryOutput = {
  readonly id: string
  readonly sessionID: string
  readonly kind: "capture" | "flush" | "dream" | "migration" | "recovery"
  readonly backend: "legacy" | "v2"
  readonly recovery?: { readonly action: "discard" | "clear"; readonly scope: "workspace" | "global" }
  readonly state: "queued" | "running" | "finished"
  readonly ownership: "local" | "unverified" | "settled"
  readonly retryOf?: string
  readonly createdAt: number
  readonly finishedAt?: number
  readonly result?: {
    readonly status:
      | "completed"
      | "no_work"
      | "disabled"
      | "denied"
      | "retry_required"
      | "failed"
      | "cancelled"
      | "timed_out"
      | "conflict"
    readonly committed?: boolean
    readonly topics?: number
    readonly shadow?: boolean
    readonly through?: number
    readonly processed?: number
    readonly deferred?: number
    readonly unplaceable?: number
    readonly reason?: "historical_capture_ownership" | "unsupported_source" | "mode_changed" | "scope_changed"
  }
}

export type ServerMemoryOperationRecoveryPreviewInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly action: { readonly action: "discard" | "clear"; readonly scope: "workspace" | "global" }["action"]
  readonly scope: { readonly action: "discard" | "clear"; readonly scope: "workspace" | "global" }["scope"]
}

export type ServerMemoryOperationRecoveryPreviewOutput = {
  readonly action: "discard" | "clear"
  readonly scope: "workspace" | "global"
  readonly generation: string
  readonly digest: string
  readonly files: number
  readonly plans: number
  readonly available: boolean
  readonly reason?:
    | "no_plan"
    | "unknown_owner"
    | "live_owner"
    | "foreign_owner"
    | "capture_active"
    | "partial_publication"
    | "scope_empty"
}

export type ServerMemoryOperationRecoverInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id: {
    readonly id: string
    readonly retryOf?: string
    readonly preview: {
      readonly action: "discard" | "clear"
      readonly scope: "workspace" | "global"
      readonly generation: string
      readonly digest: string
      readonly files: number
      readonly plans: number
      readonly available: boolean
      readonly reason?:
        | "no_plan"
        | "unknown_owner"
        | "live_owner"
        | "foreign_owner"
        | "capture_active"
        | "partial_publication"
        | "scope_empty"
    }
  }["id"]
  readonly retryOf?: {
    readonly id: string
    readonly retryOf?: string
    readonly preview: {
      readonly action: "discard" | "clear"
      readonly scope: "workspace" | "global"
      readonly generation: string
      readonly digest: string
      readonly files: number
      readonly plans: number
      readonly available: boolean
      readonly reason?:
        | "no_plan"
        | "unknown_owner"
        | "live_owner"
        | "foreign_owner"
        | "capture_active"
        | "partial_publication"
        | "scope_empty"
    }
  }["retryOf"]
  readonly preview: {
    readonly id: string
    readonly retryOf?: string
    readonly preview: {
      readonly action: "discard" | "clear"
      readonly scope: "workspace" | "global"
      readonly generation: string
      readonly digest: string
      readonly files: number
      readonly plans: number
      readonly available: boolean
      readonly reason?:
        | "no_plan"
        | "unknown_owner"
        | "live_owner"
        | "foreign_owner"
        | "capture_active"
        | "partial_publication"
        | "scope_empty"
    }
  }["preview"]
}

export type ServerMemoryOperationRecoverOutput = {
  readonly id: string
  readonly sessionID: string
  readonly kind: "capture" | "flush" | "dream" | "migration" | "recovery"
  readonly backend: "legacy" | "v2"
  readonly recovery?: { readonly action: "discard" | "clear"; readonly scope: "workspace" | "global" }
  readonly state: "queued" | "running" | "finished"
  readonly ownership: "local" | "unverified" | "settled"
  readonly retryOf?: string
  readonly createdAt: number
  readonly finishedAt?: number
  readonly result?: {
    readonly status:
      | "completed"
      | "no_work"
      | "disabled"
      | "denied"
      | "retry_required"
      | "failed"
      | "cancelled"
      | "timed_out"
      | "conflict"
    readonly committed?: boolean
    readonly topics?: number
    readonly shadow?: boolean
    readonly through?: number
    readonly processed?: number
    readonly deferred?: number
    readonly unplaceable?: number
    readonly reason?: "historical_capture_ownership" | "unsupported_source" | "mode_changed" | "scope_changed"
  }
}

export type ServerMemoryOperationMigrationPreviewInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly kind: { readonly kind: "relocation" | "carryover"; readonly scope: "workspace" | "global" }["kind"]
  readonly scope: { readonly kind: "relocation" | "carryover"; readonly scope: "workspace" | "global" }["scope"]
}

export type ServerMemoryOperationMigrationPreviewOutput = {
  readonly kind: "relocation" | "carryover"
  readonly scope: "workspace" | "global"
  readonly sourceHash: string
  readonly targetHash: string
  readonly generation: string
  readonly available: boolean
}

export type ServerMemoryOperationMigrateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id: {
    readonly id: string
    readonly retryOf?: string
    readonly preview: {
      readonly kind: "relocation" | "carryover"
      readonly scope: "workspace" | "global"
      readonly sourceHash: string
      readonly targetHash: string
      readonly generation: string
      readonly available: boolean
    }
  }["id"]
  readonly retryOf?: {
    readonly id: string
    readonly retryOf?: string
    readonly preview: {
      readonly kind: "relocation" | "carryover"
      readonly scope: "workspace" | "global"
      readonly sourceHash: string
      readonly targetHash: string
      readonly generation: string
      readonly available: boolean
    }
  }["retryOf"]
  readonly preview: {
    readonly id: string
    readonly retryOf?: string
    readonly preview: {
      readonly kind: "relocation" | "carryover"
      readonly scope: "workspace" | "global"
      readonly sourceHash: string
      readonly targetHash: string
      readonly generation: string
      readonly available: boolean
    }
  }["preview"]
}

export type ServerMemoryOperationMigrateOutput = {
  readonly id: string
  readonly sessionID: string
  readonly kind: "capture" | "flush" | "dream" | "migration" | "recovery"
  readonly backend: "legacy" | "v2"
  readonly recovery?: { readonly action: "discard" | "clear"; readonly scope: "workspace" | "global" }
  readonly state: "queued" | "running" | "finished"
  readonly ownership: "local" | "unverified" | "settled"
  readonly retryOf?: string
  readonly createdAt: number
  readonly finishedAt?: number
  readonly result?: {
    readonly status:
      | "completed"
      | "no_work"
      | "disabled"
      | "denied"
      | "retry_required"
      | "failed"
      | "cancelled"
      | "timed_out"
      | "conflict"
    readonly committed?: boolean
    readonly topics?: number
    readonly shadow?: boolean
    readonly through?: number
    readonly processed?: number
    readonly deferred?: number
    readonly unplaceable?: number
    readonly reason?: "historical_capture_ownership" | "unsupported_source" | "mode_changed" | "scope_changed"
  }
}

export type ServerMemoryOperationDreamInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id: { readonly id: string; readonly retryOf?: string }["id"]
  readonly retryOf?: { readonly id: string; readonly retryOf?: string }["retryOf"]
}

export type ServerMemoryOperationDreamOutput = {
  readonly id: string
  readonly sessionID: string
  readonly kind: "capture" | "flush" | "dream" | "migration" | "recovery"
  readonly backend: "legacy" | "v2"
  readonly recovery?: { readonly action: "discard" | "clear"; readonly scope: "workspace" | "global" }
  readonly state: "queued" | "running" | "finished"
  readonly ownership: "local" | "unverified" | "settled"
  readonly retryOf?: string
  readonly createdAt: number
  readonly finishedAt?: number
  readonly result?: {
    readonly status:
      | "completed"
      | "no_work"
      | "disabled"
      | "denied"
      | "retry_required"
      | "failed"
      | "cancelled"
      | "timed_out"
      | "conflict"
    readonly committed?: boolean
    readonly topics?: number
    readonly shadow?: boolean
    readonly through?: number
    readonly processed?: number
    readonly deferred?: number
    readonly unplaceable?: number
    readonly reason?: "historical_capture_ownership" | "unsupported_source" | "mode_changed" | "scope_changed"
  }
}

export type ServerMemoryOperationFlushInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id: { readonly id: string; readonly retryOf?: string }["id"]
  readonly retryOf?: { readonly id: string; readonly retryOf?: string }["retryOf"]
}

export type ServerMemoryOperationFlushOutput = {
  readonly id: string
  readonly sessionID: string
  readonly kind: "capture" | "flush" | "dream" | "migration" | "recovery"
  readonly backend: "legacy" | "v2"
  readonly recovery?: { readonly action: "discard" | "clear"; readonly scope: "workspace" | "global" }
  readonly state: "queued" | "running" | "finished"
  readonly ownership: "local" | "unverified" | "settled"
  readonly retryOf?: string
  readonly createdAt: number
  readonly finishedAt?: number
  readonly result?: {
    readonly status:
      | "completed"
      | "no_work"
      | "disabled"
      | "denied"
      | "retry_required"
      | "failed"
      | "cancelled"
      | "timed_out"
      | "conflict"
    readonly committed?: boolean
    readonly topics?: number
    readonly shadow?: boolean
    readonly through?: number
    readonly processed?: number
    readonly deferred?: number
    readonly unplaceable?: number
    readonly reason?: "historical_capture_ownership" | "unsupported_source" | "mode_changed" | "scope_changed"
  }
}

export type ServerMemoryOperationOperationsInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ServerMemoryOperationOperationsOutput = ReadonlyArray<{
  readonly id: string
  readonly sessionID: string
  readonly kind: "capture" | "flush" | "dream" | "migration" | "recovery"
  readonly backend: "legacy" | "v2"
  readonly recovery?: { readonly action: "discard" | "clear"; readonly scope: "workspace" | "global" }
  readonly state: "queued" | "running" | "finished"
  readonly ownership: "local" | "unverified" | "settled"
  readonly retryOf?: string
  readonly createdAt: number
  readonly finishedAt?: number
  readonly result?: {
    readonly status:
      | "completed"
      | "no_work"
      | "disabled"
      | "denied"
      | "retry_required"
      | "failed"
      | "cancelled"
      | "timed_out"
      | "conflict"
    readonly committed?: boolean
    readonly topics?: number
    readonly shadow?: boolean
    readonly through?: number
    readonly processed?: number
    readonly deferred?: number
    readonly unplaceable?: number
    readonly reason?: "historical_capture_ownership" | "unsupported_source" | "mode_changed" | "scope_changed"
  }
}>

export type ServerMemoryOperationOperationInput = {
  readonly sessionID: { readonly sessionID: string; readonly operationID: string }["sessionID"]
  readonly operationID: { readonly sessionID: string; readonly operationID: string }["operationID"]
}

export type ServerMemoryOperationOperationOutput = {
  readonly id: string
  readonly sessionID: string
  readonly kind: "capture" | "flush" | "dream" | "migration" | "recovery"
  readonly backend: "legacy" | "v2"
  readonly recovery?: { readonly action: "discard" | "clear"; readonly scope: "workspace" | "global" }
  readonly state: "queued" | "running" | "finished"
  readonly ownership: "local" | "unverified" | "settled"
  readonly retryOf?: string
  readonly createdAt: number
  readonly finishedAt?: number
  readonly result?: {
    readonly status:
      | "completed"
      | "no_work"
      | "disabled"
      | "denied"
      | "retry_required"
      | "failed"
      | "cancelled"
      | "timed_out"
      | "conflict"
    readonly committed?: boolean
    readonly topics?: number
    readonly shadow?: boolean
    readonly through?: number
    readonly processed?: number
    readonly deferred?: number
    readonly unplaceable?: number
    readonly reason?: "historical_capture_ownership" | "unsupported_source" | "mode_changed" | "scope_changed"
  }
}

export type ServerMemoryOperationCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly operationID: string }["sessionID"]
  readonly operationID: { readonly sessionID: string; readonly operationID: string }["operationID"]
}

export type ServerMemoryOperationCancelOutput = {
  readonly id: string
  readonly sessionID: string
  readonly kind: "capture" | "flush" | "dream" | "migration" | "recovery"
  readonly backend: "legacy" | "v2"
  readonly recovery?: { readonly action: "discard" | "clear"; readonly scope: "workspace" | "global" }
  readonly state: "queued" | "running" | "finished"
  readonly ownership: "local" | "unverified" | "settled"
  readonly retryOf?: string
  readonly createdAt: number
  readonly finishedAt?: number
  readonly result?: {
    readonly status:
      | "completed"
      | "no_work"
      | "disabled"
      | "denied"
      | "retry_required"
      | "failed"
      | "cancelled"
      | "timed_out"
      | "conflict"
    readonly committed?: boolean
    readonly topics?: number
    readonly shadow?: boolean
    readonly through?: number
    readonly processed?: number
    readonly deferred?: number
    readonly unplaceable?: number
    readonly reason?: "historical_capture_ownership" | "unsupported_source" | "mode_changed" | "scope_changed"
  }
}

export type ServerHooksGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ServerHooksGetOutput = {
  readonly captured: boolean
  readonly repository?: {
    readonly root: string
    readonly token: string
    readonly trusted: boolean
    readonly allowed: boolean
  }
  readonly generation: number
  readonly preferenceRevision?: string
  readonly savedPreferenceRevision?: string
  readonly preferenceFailure?: "invalid" | "read" | "write" | "conflict" | "rollback"
  readonly inspection?: {
    readonly projectTrusted: boolean
    readonly diagnostics: ReadonlyArray<string>
    readonly hooks: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly event: string
      readonly source: string
      readonly type: string
      readonly matcher?: string | null
      readonly supported: boolean
      readonly configurable: boolean
      readonly configuredEnabled: boolean
      readonly effectiveDisabled?: boolean
      readonly savedDisabled?: boolean
      readonly pendingChange?: boolean
      readonly readOnlyReason?: "managed" | "unknown_source" | "unsupported"
    }>
  } | null
}

export type ServerHooksReloadInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ServerHooksReloadOutput = {
  readonly captured: boolean
  readonly repository?: {
    readonly root: string
    readonly token: string
    readonly trusted: boolean
    readonly allowed: boolean
  }
  readonly generation: number
  readonly preferenceRevision?: string
  readonly savedPreferenceRevision?: string
  readonly preferenceFailure?: "invalid" | "read" | "write" | "conflict" | "rollback"
  readonly inspection?: {
    readonly projectTrusted: boolean
    readonly diagnostics: ReadonlyArray<string>
    readonly hooks: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly event: string
      readonly source: string
      readonly type: string
      readonly matcher?: string | null
      readonly supported: boolean
      readonly configurable: boolean
      readonly configuredEnabled: boolean
      readonly effectiveDisabled?: boolean
      readonly savedDisabled?: boolean
      readonly pendingChange?: boolean
      readonly readOnlyReason?: "managed" | "unknown_source" | "unsupported"
    }>
  } | null
}

export type ServerHooksTrustInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly root: { readonly root: string; readonly token: string; readonly trusted: boolean }["root"]
  readonly token: { readonly root: string; readonly token: string; readonly trusted: boolean }["token"]
  readonly trusted: { readonly root: string; readonly token: string; readonly trusted: boolean }["trusted"]
}

export type ServerHooksTrustOutput = {
  readonly captured: boolean
  readonly repository?: {
    readonly root: string
    readonly token: string
    readonly trusted: boolean
    readonly allowed: boolean
  }
  readonly generation: number
  readonly preferenceRevision?: string
  readonly savedPreferenceRevision?: string
  readonly preferenceFailure?: "invalid" | "read" | "write" | "conflict" | "rollback"
  readonly inspection?: {
    readonly projectTrusted: boolean
    readonly diagnostics: ReadonlyArray<string>
    readonly hooks: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly event: string
      readonly source: string
      readonly type: string
      readonly matcher?: string | null
      readonly supported: boolean
      readonly configurable: boolean
      readonly configuredEnabled: boolean
      readonly effectiveDisabled?: boolean
      readonly savedDisabled?: boolean
      readonly pendingChange?: boolean
      readonly readOnlyReason?: "managed" | "unknown_source" | "unsupported"
    }>
  } | null
}

export type ServerHooksPreferenceInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly hookID: { readonly hookID: string; readonly enabled: boolean }["hookID"]
  readonly enabled: { readonly hookID: string; readonly enabled: boolean }["enabled"]
}

export type ServerHooksPreferenceOutput = {
  readonly captured: boolean
  readonly repository?: {
    readonly root: string
    readonly token: string
    readonly trusted: boolean
    readonly allowed: boolean
  }
  readonly generation: number
  readonly preferenceRevision?: string
  readonly savedPreferenceRevision?: string
  readonly preferenceFailure?: "invalid" | "read" | "write" | "conflict" | "rollback"
  readonly inspection?: {
    readonly projectTrusted: boolean
    readonly diagnostics: ReadonlyArray<string>
    readonly hooks: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly event: string
      readonly source: string
      readonly type: string
      readonly matcher?: string | null
      readonly supported: boolean
      readonly configurable: boolean
      readonly configuredEnabled: boolean
      readonly effectiveDisabled?: boolean
      readonly savedDisabled?: boolean
      readonly pendingChange?: boolean
      readonly readOnlyReason?: "managed" | "unknown_source" | "unsupported"
    }>
  } | null
}

export type ServerPluginsListOutput = {
  readonly sources: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly location: string
    readonly official: boolean
    readonly updatedAt?: number
    readonly error?: string
  }>
  readonly items: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly description: string
    readonly sourceID: string
    readonly source: string
    readonly category: string
    readonly author?: string
    readonly homepage?: string
    readonly version?: string
    readonly revision?: string
    readonly installedVersion?: string
    readonly installedRevision?: string
    readonly recommended: boolean
    readonly status: "available" | "downloaded" | "enabled" | "disabled"
    readonly components: ReadonlyArray<{
      readonly kind: "skills" | "commands" | "agents" | "mcpServers" | "lspServers" | "hooks"
      readonly name: string
      readonly description?: string
    }>
    readonly warnings: ReadonlyArray<string>
    readonly path?: string
  }>
  readonly retainedData?: ReadonlyArray<{ readonly id: string; readonly reason: "readers" | "ownership" }>
}

export type ServerPluginsDetailInput = { readonly id: { readonly id: string }["id"] }

export type ServerPluginsDetailOutput = {
  readonly item: {
    readonly id: string
    readonly name: string
    readonly description: string
    readonly sourceID: string
    readonly source: string
    readonly category: string
    readonly author?: string
    readonly homepage?: string
    readonly version?: string
    readonly revision?: string
    readonly installedVersion?: string
    readonly installedRevision?: string
    readonly recommended: boolean
    readonly status: "available" | "downloaded" | "enabled" | "disabled"
    readonly components: ReadonlyArray<{
      readonly kind: "skills" | "commands" | "agents" | "mcpServers" | "lspServers" | "hooks"
      readonly name: string
      readonly description?: string
    }>
    readonly warnings: ReadonlyArray<string>
    readonly path?: string
  }
  readonly readme: string
}

export type ServerPluginsManageInput = {
  readonly action: {
    readonly action:
      | "refresh"
      | "add-source"
      | "remove-source"
      | "install"
      | "download"
      | "update"
      | "enable"
      | "disable"
      | "uninstall"
    readonly id?: string
    readonly source?: string
    readonly trust?: boolean
    readonly keepData?: boolean
  }["action"]
  readonly id?: {
    readonly action:
      | "refresh"
      | "add-source"
      | "remove-source"
      | "install"
      | "download"
      | "update"
      | "enable"
      | "disable"
      | "uninstall"
    readonly id?: string
    readonly source?: string
    readonly trust?: boolean
    readonly keepData?: boolean
  }["id"]
  readonly source?: {
    readonly action:
      | "refresh"
      | "add-source"
      | "remove-source"
      | "install"
      | "download"
      | "update"
      | "enable"
      | "disable"
      | "uninstall"
    readonly id?: string
    readonly source?: string
    readonly trust?: boolean
    readonly keepData?: boolean
  }["source"]
  readonly trust?: {
    readonly action:
      | "refresh"
      | "add-source"
      | "remove-source"
      | "install"
      | "download"
      | "update"
      | "enable"
      | "disable"
      | "uninstall"
    readonly id?: string
    readonly source?: string
    readonly trust?: boolean
    readonly keepData?: boolean
  }["trust"]
  readonly keepData?: {
    readonly action:
      | "refresh"
      | "add-source"
      | "remove-source"
      | "install"
      | "download"
      | "update"
      | "enable"
      | "disable"
      | "uninstall"
    readonly id?: string
    readonly source?: string
    readonly trust?: boolean
    readonly keepData?: boolean
  }["keepData"]
}

export type ServerPluginsManageOutput = {
  readonly sources: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly location: string
    readonly official: boolean
    readonly updatedAt?: number
    readonly error?: string
  }>
  readonly items: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly description: string
    readonly sourceID: string
    readonly source: string
    readonly category: string
    readonly author?: string
    readonly homepage?: string
    readonly version?: string
    readonly revision?: string
    readonly installedVersion?: string
    readonly installedRevision?: string
    readonly recommended: boolean
    readonly status: "available" | "downloaded" | "enabled" | "disabled"
    readonly components: ReadonlyArray<{
      readonly kind: "skills" | "commands" | "agents" | "mcpServers" | "lspServers" | "hooks"
      readonly name: string
      readonly description?: string
    }>
    readonly warnings: ReadonlyArray<string>
    readonly path?: string
  }>
  readonly retainedData?: ReadonlyArray<{ readonly id: string; readonly reason: "readers" | "ownership" }>
}

export type ServerPluginsRuntimeInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerPluginsRuntimeOutput = {
  readonly generation: number
  readonly active: ReadonlyArray<string>
  readonly failure?: {
    readonly code: "busy" | "invalid" | "load" | "unsupported"
    readonly message: string
    readonly components?: ReadonlyArray<"mcp" | "lsp">
  }
}

export type ServerPluginsReloadInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerPluginsReloadOutput = boolean

export type ServerMcpStatusInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerMcpStatusOutput = {
  readonly [x: string]: {
    readonly status: "connected" | "disabled" | "failed" | "needs_auth"
    readonly tools: number
    readonly error?: string | null
    readonly configuredEnabled?: boolean
    readonly preference?: boolean
    readonly preferenceError?: boolean
    readonly authentication?: {
      readonly supported: boolean
      readonly credentials: "missing" | "available"
      readonly error?:
        | "invalid"
        | "auth"
        | "storage"
        | "conflict"
        | "not_found"
        | "unsupported"
        | "cancelled"
        | "expired"
        | "load"
      readonly flow?: {
        readonly id: string
        readonly phase:
          | "waiting"
          | "exchanging"
          | "connected"
          | "credentials_ready"
          | "retry_required"
          | "failed"
          | "cancelled"
        readonly expiresAt: number
        readonly error?:
          | "invalid"
          | "auth"
          | "storage"
          | "conflict"
          | "not_found"
          | "unsupported"
          | "cancelled"
          | "expired"
          | "load"
      }
    }
  }
}

export type ServerMcpConnectInput = {
  readonly server: { readonly server: string }["server"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerMcpConnectOutput = boolean

export type ServerMcpDisconnectInput = {
  readonly server: { readonly server: string }["server"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerMcpDisconnectOutput = boolean

export type ServerMcpRetryInput = {
  readonly server: { readonly server: string }["server"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerMcpRetryOutput = boolean

export type ServerMcpResetPreferenceInput = {
  readonly server: { readonly server: string }["server"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerMcpResetPreferenceOutput = boolean

export type ServerMcpAuthStartInput = {
  readonly server: { readonly server: string }["server"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerMcpAuthStartOutput = {
  readonly id: string
  readonly authorizationUrl: string
  readonly expiresAt: number
}

export type ServerMcpAuthCancelInput = {
  readonly server: { readonly server: string; readonly flowID: string }["server"]
  readonly flowID: { readonly server: string; readonly flowID: string }["flowID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerMcpAuthCancelOutput = boolean

export type SessionMcpAttachmentsReserveInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly request: {
    readonly request:
      | { readonly kind: "catalog"; readonly input: { readonly server?: string | undefined } }
      | {
          readonly kind: "prepare"
          readonly input:
            | { readonly kind: "resource"; readonly server: string; readonly uri: string }
            | {
                readonly kind: "template"
                readonly server: string
                readonly uriTemplate: string
                readonly parameters: {
                  readonly [x: string]: string | ReadonlyArray<string> | { readonly [x: string]: string }
                }
              }
        }
  }["request"]
}

export type SessionMcpAttachmentsReserveOutput = {
  readonly id: string
  readonly kind: "catalog" | "prepare"
  readonly status: "reserved" | "running" | "completed" | "failed" | "cancelled"
  readonly expiresAt: number
  readonly catalog?:
    | {
        readonly resources: ReadonlyArray<{
          readonly server: string
          readonly name: string
          readonly title?: string | undefined
          readonly description?: string | undefined
          readonly mimeType?: string | undefined
          readonly uri: string
        }>
        readonly templates: ReadonlyArray<{
          readonly server: string
          readonly name: string
          readonly title?: string | undefined
          readonly description?: string | undefined
          readonly mimeType?: string | undefined
          readonly uriTemplate: string
          readonly variables: ReadonlyArray<string>
        }>
        readonly errors: ReadonlyArray<{ readonly server: string; readonly code: string; readonly message: string }>
      }
    | undefined
  readonly prepared?:
    | {
        readonly server: string
        readonly resourceURI: string
        readonly files: ReadonlyArray<{ readonly uri: string; readonly name: string; readonly mimeType: string }>
      }
    | undefined
  readonly error?: { readonly code: string; readonly message: string } | undefined
}

export type SessionMcpAttachmentsExecuteInput = {
  readonly sessionID: { readonly sessionID: string; readonly operationID: string }["sessionID"]
  readonly operationID: { readonly sessionID: string; readonly operationID: string }["operationID"]
  readonly request: {
    readonly request:
      | { readonly kind: "catalog"; readonly input: { readonly server?: string | undefined } }
      | {
          readonly kind: "prepare"
          readonly input:
            | { readonly kind: "resource"; readonly server: string; readonly uri: string }
            | {
                readonly kind: "template"
                readonly server: string
                readonly uriTemplate: string
                readonly parameters: {
                  readonly [x: string]: string | ReadonlyArray<string> | { readonly [x: string]: string }
                }
              }
        }
  }["request"]
}

export type SessionMcpAttachmentsExecuteOutput = {
  readonly id: string
  readonly kind: "catalog" | "prepare"
  readonly status: "reserved" | "running" | "completed" | "failed" | "cancelled"
  readonly expiresAt: number
  readonly catalog?:
    | {
        readonly resources: ReadonlyArray<{
          readonly server: string
          readonly name: string
          readonly title?: string | undefined
          readonly description?: string | undefined
          readonly mimeType?: string | undefined
          readonly uri: string
        }>
        readonly templates: ReadonlyArray<{
          readonly server: string
          readonly name: string
          readonly title?: string | undefined
          readonly description?: string | undefined
          readonly mimeType?: string | undefined
          readonly uriTemplate: string
          readonly variables: ReadonlyArray<string>
        }>
        readonly errors: ReadonlyArray<{ readonly server: string; readonly code: string; readonly message: string }>
      }
    | undefined
  readonly prepared?:
    | {
        readonly server: string
        readonly resourceURI: string
        readonly files: ReadonlyArray<{ readonly uri: string; readonly name: string; readonly mimeType: string }>
      }
    | undefined
  readonly error?: { readonly code: string; readonly message: string } | undefined
}

export type SessionMcpAttachmentsStatusInput = {
  readonly sessionID: { readonly sessionID: string; readonly operationID: string }["sessionID"]
  readonly operationID: { readonly sessionID: string; readonly operationID: string }["operationID"]
}

export type SessionMcpAttachmentsStatusOutput = {
  readonly id: string
  readonly kind: "catalog" | "prepare"
  readonly status: "reserved" | "running" | "completed" | "failed" | "cancelled"
  readonly expiresAt: number
  readonly catalog?:
    | {
        readonly resources: ReadonlyArray<{
          readonly server: string
          readonly name: string
          readonly title?: string | undefined
          readonly description?: string | undefined
          readonly mimeType?: string | undefined
          readonly uri: string
        }>
        readonly templates: ReadonlyArray<{
          readonly server: string
          readonly name: string
          readonly title?: string | undefined
          readonly description?: string | undefined
          readonly mimeType?: string | undefined
          readonly uriTemplate: string
          readonly variables: ReadonlyArray<string>
        }>
        readonly errors: ReadonlyArray<{ readonly server: string; readonly code: string; readonly message: string }>
      }
    | undefined
  readonly prepared?:
    | {
        readonly server: string
        readonly resourceURI: string
        readonly files: ReadonlyArray<{ readonly uri: string; readonly name: string; readonly mimeType: string }>
      }
    | undefined
  readonly error?: { readonly code: string; readonly message: string } | undefined
}

export type SessionMcpAttachmentsCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly operationID: string }["sessionID"]
  readonly operationID: { readonly sessionID: string; readonly operationID: string }["operationID"]
}

export type SessionMcpAttachmentsCancelOutput = {
  readonly id: string
  readonly kind: "catalog" | "prepare"
  readonly status: "reserved" | "running" | "completed" | "failed" | "cancelled"
  readonly expiresAt: number
  readonly catalog?:
    | {
        readonly resources: ReadonlyArray<{
          readonly server: string
          readonly name: string
          readonly title?: string | undefined
          readonly description?: string | undefined
          readonly mimeType?: string | undefined
          readonly uri: string
        }>
        readonly templates: ReadonlyArray<{
          readonly server: string
          readonly name: string
          readonly title?: string | undefined
          readonly description?: string | undefined
          readonly mimeType?: string | undefined
          readonly uriTemplate: string
          readonly variables: ReadonlyArray<string>
        }>
        readonly errors: ReadonlyArray<{ readonly server: string; readonly code: string; readonly message: string }>
      }
    | undefined
  readonly prepared?:
    | {
        readonly server: string
        readonly resourceURI: string
        readonly files: ReadonlyArray<{ readonly uri: string; readonly name: string; readonly mimeType: string }>
      }
    | undefined
  readonly error?: { readonly code: string; readonly message: string } | undefined
}

export type ServerLspStatusInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ServerLspStatusOutput = ReadonlyArray<{
  readonly id: string
  readonly name: string
  readonly root: string
  readonly status: "pending" | "connected" | "disabled" | "failed"
  readonly operations: ReadonlyArray<
    "goToDefinition" | "findReferences" | "hover" | "goToImplementation" | "documentSymbol" | "workspaceSymbol"
  >
  readonly error?: string | undefined
}>

export type ServerWorkflowRelatedInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ServerWorkflowRelatedOutput = ReadonlyArray<{
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly status: "pending" | "running" | "paused" | "budget_limited" | "cancelled" | "completed" | "failed"
  readonly phase?: string
  readonly agentBudget: number
  readonly agentsSpent: number
  readonly concurrency: number
  readonly tokens: number
  readonly usageIncomplete?: boolean
  readonly resumeBlockedReason?: "process_restart" | "schema_attempt_claimed"
  readonly createdAt: number
  readonly updatedAt: number
  readonly message?: string
  readonly pauseKind?: "user" | "back_off" | "no_progress" | "verification" | "infra"
  readonly result?: JsonValue
  readonly children: ReadonlyArray<string>
}>

export type ServerWorkflowLaunchInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly source: {
    readonly source:
      | { readonly type: "saved"; readonly name: string }
      | { readonly type: "script"; readonly name: string; readonly script: string }
      | {
          readonly type: "definition"
          readonly definition: {
            readonly name: string
            readonly description: string
            readonly stages: ReadonlyArray<{
              readonly name: string
              readonly prompt: string
              readonly readOnly?: boolean
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly input?: string
              readonly foreach?: string
              readonly limit?: number
              readonly outputSchema?: { readonly [x: string]: JsonValue }
            }>
          }
        }
      | { readonly type: "builtin"; readonly name: "deep-research" }
    readonly args?: JsonValue
    readonly agentBudget?: number
    readonly concurrency?: number
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent?: string
  }["source"]
  readonly args?: {
    readonly source:
      | { readonly type: "saved"; readonly name: string }
      | { readonly type: "script"; readonly name: string; readonly script: string }
      | {
          readonly type: "definition"
          readonly definition: {
            readonly name: string
            readonly description: string
            readonly stages: ReadonlyArray<{
              readonly name: string
              readonly prompt: string
              readonly readOnly?: boolean
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly input?: string
              readonly foreach?: string
              readonly limit?: number
              readonly outputSchema?: { readonly [x: string]: JsonValue }
            }>
          }
        }
      | { readonly type: "builtin"; readonly name: "deep-research" }
    readonly args?: JsonValue
    readonly agentBudget?: number
    readonly concurrency?: number
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent?: string
  }["args"]
  readonly agentBudget?: {
    readonly source:
      | { readonly type: "saved"; readonly name: string }
      | { readonly type: "script"; readonly name: string; readonly script: string }
      | {
          readonly type: "definition"
          readonly definition: {
            readonly name: string
            readonly description: string
            readonly stages: ReadonlyArray<{
              readonly name: string
              readonly prompt: string
              readonly readOnly?: boolean
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly input?: string
              readonly foreach?: string
              readonly limit?: number
              readonly outputSchema?: { readonly [x: string]: JsonValue }
            }>
          }
        }
      | { readonly type: "builtin"; readonly name: "deep-research" }
    readonly args?: JsonValue
    readonly agentBudget?: number
    readonly concurrency?: number
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent?: string
  }["agentBudget"]
  readonly concurrency?: {
    readonly source:
      | { readonly type: "saved"; readonly name: string }
      | { readonly type: "script"; readonly name: string; readonly script: string }
      | {
          readonly type: "definition"
          readonly definition: {
            readonly name: string
            readonly description: string
            readonly stages: ReadonlyArray<{
              readonly name: string
              readonly prompt: string
              readonly readOnly?: boolean
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly input?: string
              readonly foreach?: string
              readonly limit?: number
              readonly outputSchema?: { readonly [x: string]: JsonValue }
            }>
          }
        }
      | { readonly type: "builtin"; readonly name: "deep-research" }
    readonly args?: JsonValue
    readonly agentBudget?: number
    readonly concurrency?: number
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent?: string
  }["concurrency"]
  readonly model?: {
    readonly source:
      | { readonly type: "saved"; readonly name: string }
      | { readonly type: "script"; readonly name: string; readonly script: string }
      | {
          readonly type: "definition"
          readonly definition: {
            readonly name: string
            readonly description: string
            readonly stages: ReadonlyArray<{
              readonly name: string
              readonly prompt: string
              readonly readOnly?: boolean
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly input?: string
              readonly foreach?: string
              readonly limit?: number
              readonly outputSchema?: { readonly [x: string]: JsonValue }
            }>
          }
        }
      | { readonly type: "builtin"; readonly name: "deep-research" }
    readonly args?: JsonValue
    readonly agentBudget?: number
    readonly concurrency?: number
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent?: string
  }["model"]
  readonly agent?: {
    readonly source:
      | { readonly type: "saved"; readonly name: string }
      | { readonly type: "script"; readonly name: string; readonly script: string }
      | {
          readonly type: "definition"
          readonly definition: {
            readonly name: string
            readonly description: string
            readonly stages: ReadonlyArray<{
              readonly name: string
              readonly prompt: string
              readonly readOnly?: boolean
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly input?: string
              readonly foreach?: string
              readonly limit?: number
              readonly outputSchema?: { readonly [x: string]: JsonValue }
            }>
          }
        }
      | { readonly type: "builtin"; readonly name: "deep-research" }
    readonly args?: JsonValue
    readonly agentBudget?: number
    readonly concurrency?: number
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly agent?: string
  }["agent"]
}

export type ServerWorkflowLaunchOutput = {
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly status: "pending" | "running" | "paused" | "budget_limited" | "cancelled" | "completed" | "failed"
  readonly phase?: string
  readonly agentBudget: number
  readonly agentsSpent: number
  readonly concurrency: number
  readonly tokens: number
  readonly usageIncomplete?: boolean
  readonly resumeBlockedReason?: "process_restart" | "schema_attempt_claimed"
  readonly createdAt: number
  readonly updatedAt: number
  readonly message?: string
  readonly pauseKind?: "user" | "back_off" | "no_progress" | "verification" | "infra"
  readonly result?: JsonValue
  readonly children: ReadonlyArray<string>
}

export type ServerWorkflowSourcesInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ServerWorkflowSourcesOutput = ReadonlyArray<{
  readonly name: string
  readonly scope: "builtin" | "project" | "user"
  readonly description?: string
}>

export type ServerWorkflowValidateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly source: {
    readonly source:
      | { readonly type: "saved"; readonly name: string }
      | { readonly type: "script"; readonly name: string; readonly script: string }
      | {
          readonly type: "definition"
          readonly definition: {
            readonly name: string
            readonly description: string
            readonly stages: ReadonlyArray<{
              readonly name: string
              readonly prompt: string
              readonly readOnly?: boolean
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly input?: string
              readonly foreach?: string
              readonly limit?: number
              readonly outputSchema?: { readonly [x: string]: JsonValue }
            }>
          }
        }
      | { readonly type: "builtin"; readonly name: "deep-research" }
  }["source"]
}

export type ServerWorkflowValidateOutput = {
  readonly name: string
  readonly valid: boolean
  readonly diagnostics: ReadonlyArray<string>
}

export type ServerWorkflowListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ServerWorkflowListOutput = ReadonlyArray<{
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly status: "pending" | "running" | "paused" | "budget_limited" | "cancelled" | "completed" | "failed"
  readonly phase?: string
  readonly agentBudget: number
  readonly agentsSpent: number
  readonly concurrency: number
  readonly tokens: number
  readonly usageIncomplete?: boolean
  readonly resumeBlockedReason?: "process_restart" | "schema_attempt_claimed"
  readonly createdAt: number
  readonly updatedAt: number
  readonly message?: string
  readonly pauseKind?: "user" | "back_off" | "no_progress" | "verification" | "infra"
  readonly result?: JsonValue
  readonly children: ReadonlyArray<string>
}>

export type ServerWorkflowStartInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly source: {
    readonly source:
      | { readonly type: "saved"; readonly name: string }
      | { readonly type: "script"; readonly name: string; readonly script: string }
      | {
          readonly type: "definition"
          readonly definition: {
            readonly name: string
            readonly description: string
            readonly stages: ReadonlyArray<{
              readonly name: string
              readonly prompt: string
              readonly readOnly?: boolean
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly input?: string
              readonly foreach?: string
              readonly limit?: number
              readonly outputSchema?: { readonly [x: string]: JsonValue }
            }>
          }
        }
      | { readonly type: "builtin"; readonly name: "deep-research" }
    readonly args?: JsonValue
    readonly agentBudget?: number
    readonly concurrency?: number
  }["source"]
  readonly args?: {
    readonly source:
      | { readonly type: "saved"; readonly name: string }
      | { readonly type: "script"; readonly name: string; readonly script: string }
      | {
          readonly type: "definition"
          readonly definition: {
            readonly name: string
            readonly description: string
            readonly stages: ReadonlyArray<{
              readonly name: string
              readonly prompt: string
              readonly readOnly?: boolean
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly input?: string
              readonly foreach?: string
              readonly limit?: number
              readonly outputSchema?: { readonly [x: string]: JsonValue }
            }>
          }
        }
      | { readonly type: "builtin"; readonly name: "deep-research" }
    readonly args?: JsonValue
    readonly agentBudget?: number
    readonly concurrency?: number
  }["args"]
  readonly agentBudget?: {
    readonly source:
      | { readonly type: "saved"; readonly name: string }
      | { readonly type: "script"; readonly name: string; readonly script: string }
      | {
          readonly type: "definition"
          readonly definition: {
            readonly name: string
            readonly description: string
            readonly stages: ReadonlyArray<{
              readonly name: string
              readonly prompt: string
              readonly readOnly?: boolean
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly input?: string
              readonly foreach?: string
              readonly limit?: number
              readonly outputSchema?: { readonly [x: string]: JsonValue }
            }>
          }
        }
      | { readonly type: "builtin"; readonly name: "deep-research" }
    readonly args?: JsonValue
    readonly agentBudget?: number
    readonly concurrency?: number
  }["agentBudget"]
  readonly concurrency?: {
    readonly source:
      | { readonly type: "saved"; readonly name: string }
      | { readonly type: "script"; readonly name: string; readonly script: string }
      | {
          readonly type: "definition"
          readonly definition: {
            readonly name: string
            readonly description: string
            readonly stages: ReadonlyArray<{
              readonly name: string
              readonly prompt: string
              readonly readOnly?: boolean
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly input?: string
              readonly foreach?: string
              readonly limit?: number
              readonly outputSchema?: { readonly [x: string]: JsonValue }
            }>
          }
        }
      | { readonly type: "builtin"; readonly name: "deep-research" }
    readonly args?: JsonValue
    readonly agentBudget?: number
    readonly concurrency?: number
  }["concurrency"]
}

export type ServerWorkflowStartOutput = {
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly status: "pending" | "running" | "paused" | "budget_limited" | "cancelled" | "completed" | "failed"
  readonly phase?: string
  readonly agentBudget: number
  readonly agentsSpent: number
  readonly concurrency: number
  readonly tokens: number
  readonly usageIncomplete?: boolean
  readonly resumeBlockedReason?: "process_restart" | "schema_attempt_claimed"
  readonly createdAt: number
  readonly updatedAt: number
  readonly message?: string
  readonly pauseKind?: "user" | "back_off" | "no_progress" | "verification" | "infra"
  readonly result?: JsonValue
  readonly children: ReadonlyArray<string>
}

export type ServerWorkflowGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly workflowID: string }["sessionID"]
  readonly workflowID: { readonly sessionID: string; readonly workflowID: string }["workflowID"]
}

export type ServerWorkflowGetOutput = {
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly status: "pending" | "running" | "paused" | "budget_limited" | "cancelled" | "completed" | "failed"
  readonly phase?: string
  readonly agentBudget: number
  readonly agentsSpent: number
  readonly concurrency: number
  readonly tokens: number
  readonly usageIncomplete?: boolean
  readonly resumeBlockedReason?: "process_restart" | "schema_attempt_claimed"
  readonly createdAt: number
  readonly updatedAt: number
  readonly message?: string
  readonly pauseKind?: "user" | "back_off" | "no_progress" | "verification" | "infra"
  readonly result?: JsonValue
  readonly children: ReadonlyArray<string>
}

export type ServerWorkflowResumeInput = {
  readonly sessionID: { readonly sessionID: string; readonly workflowID: string }["sessionID"]
  readonly workflowID: { readonly sessionID: string; readonly workflowID: string }["workflowID"]
  readonly agentBudget?: { readonly agentBudget?: number }["agentBudget"]
}

export type ServerWorkflowResumeOutput = {
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly status: "pending" | "running" | "paused" | "budget_limited" | "cancelled" | "completed" | "failed"
  readonly phase?: string
  readonly agentBudget: number
  readonly agentsSpent: number
  readonly concurrency: number
  readonly tokens: number
  readonly usageIncomplete?: boolean
  readonly resumeBlockedReason?: "process_restart" | "schema_attempt_claimed"
  readonly createdAt: number
  readonly updatedAt: number
  readonly message?: string
  readonly pauseKind?: "user" | "back_off" | "no_progress" | "verification" | "infra"
  readonly result?: JsonValue
  readonly children: ReadonlyArray<string>
}

export type ServerWorkflowPauseInput = {
  readonly sessionID: { readonly sessionID: string; readonly workflowID: string }["sessionID"]
  readonly workflowID: { readonly sessionID: string; readonly workflowID: string }["workflowID"]
}

export type ServerWorkflowPauseOutput = {
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly status: "pending" | "running" | "paused" | "budget_limited" | "cancelled" | "completed" | "failed"
  readonly phase?: string
  readonly agentBudget: number
  readonly agentsSpent: number
  readonly concurrency: number
  readonly tokens: number
  readonly usageIncomplete?: boolean
  readonly resumeBlockedReason?: "process_restart" | "schema_attempt_claimed"
  readonly createdAt: number
  readonly updatedAt: number
  readonly message?: string
  readonly pauseKind?: "user" | "back_off" | "no_progress" | "verification" | "infra"
  readonly result?: JsonValue
  readonly children: ReadonlyArray<string>
}

export type ServerWorkflowStopInput = {
  readonly sessionID: { readonly sessionID: string; readonly workflowID: string }["sessionID"]
  readonly workflowID: { readonly sessionID: string; readonly workflowID: string }["workflowID"]
}

export type ServerWorkflowStopOutput = {
  readonly id: string
  readonly sessionID: string
  readonly name: string
  readonly status: "pending" | "running" | "paused" | "budget_limited" | "cancelled" | "completed" | "failed"
  readonly phase?: string
  readonly agentBudget: number
  readonly agentsSpent: number
  readonly concurrency: number
  readonly tokens: number
  readonly usageIncomplete?: boolean
  readonly resumeBlockedReason?: "process_restart" | "schema_attempt_claimed"
  readonly createdAt: number
  readonly updatedAt: number
  readonly message?: string
  readonly pauseKind?: "user" | "back_off" | "no_progress" | "verification" | "infra"
  readonly result?: JsonValue
  readonly children: ReadonlyArray<string>
}

export type ServerSideQuestionListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ServerSideQuestionListOutput = ReadonlyArray<{
  readonly id: string
  readonly sessionID: string
  readonly question: string
  readonly imageCount: number
  readonly status: "running" | "completed" | "cancelled" | "failed"
  readonly answer: string
  readonly error?: string
  readonly model: string
  readonly createdAt: number
  readonly updatedAt: number
}>

export type ServerSideQuestionAskInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly question: {
    readonly question: string
    readonly images?: ReadonlyArray<{
      readonly mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
      readonly data: string
    }>
  }["question"]
  readonly images?: {
    readonly question: string
    readonly images?: ReadonlyArray<{
      readonly mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
      readonly data: string
    }>
  }["images"]
}

export type ServerSideQuestionAskOutput = {
  readonly id: string
  readonly sessionID: string
  readonly question: string
  readonly imageCount: number
  readonly status: "running" | "completed" | "cancelled" | "failed"
  readonly answer: string
  readonly error?: string
  readonly model: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerSideQuestionCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly questionID: string }["sessionID"]
  readonly questionID: { readonly sessionID: string; readonly questionID: string }["questionID"]
}

export type ServerSideQuestionCancelOutput = {
  readonly id: string
  readonly sessionID: string
  readonly question: string
  readonly imageCount: number
  readonly status: "running" | "completed" | "cancelled" | "failed"
  readonly answer: string
  readonly error?: string
  readonly model: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type MessagesListInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["limit"]
  readonly order?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["order"]
  readonly cursor?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["cursor"]
}

export type MessagesListOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string
          readonly description?: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string
                      readonly description?: string
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: string
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: "unknown"; readonly message: string }
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
  >
  readonly cursor: { readonly previous?: string | null; readonly next?: string | null }
}

export type ModelsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ModelsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly providerID: string
    readonly family?: string
    readonly name: string
    readonly api:
      | {
          readonly id: string
          readonly type: "aisdk"
          readonly package: string
          readonly url?: string
          readonly settings?: { readonly [x: string]: JsonValue }
        }
      | {
          readonly id: string
          readonly type: "native"
          readonly url?: string
          readonly settings: { readonly [x: string]: JsonValue }
        }
    readonly capabilities: {
      readonly tools: boolean
      readonly input: ReadonlyArray<string>
      readonly output: ReadonlyArray<string>
    }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
      readonly variant?: string
    }
    readonly variants: ReadonlyArray<{
      readonly id: string
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }>
    readonly time: { readonly released: number }
    readonly cost: ReadonlyArray<{
      readonly tier?: { readonly type: "context"; readonly size: number }
      readonly input: number
      readonly output: number
      readonly cache: { readonly read: number; readonly write: number }
    }>
    readonly status: "alpha" | "beta" | "deprecated" | "active"
    readonly enabled: boolean
    readonly limit: { readonly context: number; readonly input?: number; readonly output: number }
  }>
}

export type ProvidersListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProvidersListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly integrationID?: string
    readonly name: string
    readonly disabled?: boolean
    readonly api:
      | {
          readonly type: "aisdk"
          readonly package: string
          readonly url?: string
          readonly settings?: { readonly [x: string]: JsonValue }
        }
      | { readonly type: "native"; readonly url?: string; readonly settings: { readonly [x: string]: JsonValue } }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
  }>
}

export type ProvidersGetInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProvidersGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly integrationID?: string
    readonly name: string
    readonly disabled?: boolean
    readonly api:
      | {
          readonly type: "aisdk"
          readonly package: string
          readonly url?: string
          readonly settings?: { readonly [x: string]: JsonValue }
        }
      | { readonly type: "native"; readonly url?: string; readonly settings: { readonly [x: string]: JsonValue } }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
  }
}

export type IntegrationsExternalInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly methodID: { readonly methodID: string }["methodID"]
}

export type IntegrationsExternalOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: boolean
}

export type IntegrationsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly methods: ReadonlyArray<
      | {
          readonly id: string
          readonly type: "oauth"
          readonly label: string
          readonly prompts?: ReadonlyArray<
            | {
                readonly type: "text"
                readonly key: string
                readonly message: string
                readonly placeholder?: string
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
            | {
                readonly type: "select"
                readonly key: string
                readonly message: string
                readonly options: ReadonlyArray<{
                  readonly label: string
                  readonly value: string
                  readonly hint?: string
                }>
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
          >
        }
      | { readonly type: "key"; readonly label?: string }
      | { readonly type: "env"; readonly names: ReadonlyArray<string> }
      | {
          readonly id: string
          readonly type: "external"
          readonly label: string
          readonly command: ReadonlyArray<string>
        }
    >
    readonly connections: ReadonlyArray<
      | { readonly type: "credential"; readonly id: string; readonly label: string }
      | { readonly type: "env"; readonly name: string }
    >
  }>
}

export type IntegrationsGetInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly name: string
    readonly methods: ReadonlyArray<
      | {
          readonly id: string
          readonly type: "oauth"
          readonly label: string
          readonly prompts?: ReadonlyArray<
            | {
                readonly type: "text"
                readonly key: string
                readonly message: string
                readonly placeholder?: string
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
            | {
                readonly type: "select"
                readonly key: string
                readonly message: string
                readonly options: ReadonlyArray<{
                  readonly label: string
                  readonly value: string
                  readonly hint?: string
                }>
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
          >
        }
      | { readonly type: "key"; readonly label?: string }
      | { readonly type: "env"; readonly names: ReadonlyArray<string> }
      | {
          readonly id: string
          readonly type: "external"
          readonly label: string
          readonly command: ReadonlyArray<string>
        }
    >
    readonly connections: ReadonlyArray<
      | { readonly type: "credential"; readonly id: string; readonly label: string }
      | { readonly type: "env"; readonly name: string }
    >
  } | null
}

export type IntegrationsConnectKeyInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly key: { readonly key: string; readonly label?: string | undefined }["key"]
  readonly label?: { readonly key: string; readonly label?: string | undefined }["label"]
}

export type IntegrationsConnectKeyOutput = void

export type IntegrationsConnectOauthInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly methodID: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["methodID"]
  readonly inputs: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["inputs"]
  readonly label?: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["label"]
}

export type IntegrationsConnectOauthOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly attemptID: string
    readonly url: string
    readonly instructions: string
    readonly mode: "auto" | "code"
    readonly time: {
      readonly created: number | "Infinity" | "-Infinity" | "NaN"
      readonly expires: number | "Infinity" | "-Infinity" | "NaN"
    }
  }
}

export type IntegrationsAttemptStatusInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsAttemptStatusOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data:
    | {
        readonly status: "pending"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "complete"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "failed"
        readonly message: string
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "expired"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
}

export type IntegrationsAttemptCompleteInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly code?: { readonly code?: string | undefined }["code"]
}

export type IntegrationsAttemptCompleteOutput = void

export type IntegrationsAttemptCancelInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsAttemptCancelOutput = void

export type CredentialsUpdateInput = {
  readonly credentialID: { readonly credentialID: string }["credentialID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly label: { readonly label: string }["label"]
}

export type CredentialsUpdateOutput = void

export type CredentialsRemoveInput = {
  readonly credentialID: { readonly credentialID: string }["credentialID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type CredentialsRemoveOutput = void

export type PermissionsListRequestsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PermissionsListRequestsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }>
}

export type PermissionsListSavedInput = {
  readonly projectID?: { readonly projectID?: string | undefined }["projectID"]
}

export type PermissionsListSavedOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly projectID: string
    readonly action: string
    readonly resource: string
  }>
}["data"]

export type PermissionsRemoveSavedInput = { readonly id: { readonly id: string }["id"] }

export type PermissionsRemoveSavedOutput = void

export type PermissionsCreateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["id"]
  readonly action: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["action"]
  readonly resources: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["resources"]
  readonly save?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["save"]
  readonly metadata?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["metadata"]
  readonly source?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["source"]
  readonly agent?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["agent"]
}

export type PermissionsCreateOutput = {
  readonly data: { readonly id: string; readonly effect: "allow" | "deny" | "ask" }
}["data"]

export type PermissionsListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type PermissionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }>
}["data"]

export type PermissionsGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type PermissionsGetOutput = {
  readonly data: {
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }
}["data"]

export type PermissionsReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly reply: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["reply"]
  readonly message?: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["message"]
}

export type PermissionsReplyOutput = void

export type FilesListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly path?: string | undefined
  }["location"]
  readonly path?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly path?: string | undefined
  }["path"]
}

export type FilesListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{ readonly path: string; readonly type: "file" | "directory" }>
}

export type FilesFindInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["location"]
  readonly query: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["query"]
  readonly type?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["type"]
  readonly limit?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type FilesFindOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{ readonly path: string; readonly type: "file" | "directory" }>
}

export type CommandsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type CommandsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly template: string
    readonly description?: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly subtask?: boolean
  }>
}

export type SkillsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type SkillsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly slash?: boolean
    readonly location: string
    readonly content: string
  }>
}

export type SkillsReloadInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type SkillsReloadOutput = void

export type EventsSubscribeOutput = ApexoEventEncoded

export type PtysListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtysListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }>
}

export type PtysCreateInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly command?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["command"]
  readonly args?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["args"]
  readonly cwd?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["cwd"]
  readonly title?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["title"]
  readonly env?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["env"]
}

export type PtysCreateOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtysGetInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtysGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtysUpdateInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title?: {
    readonly title?: string
    readonly size?: { readonly rows: number; readonly cols: number }
  }["title"]
  readonly size?: { readonly title?: string; readonly size?: { readonly rows: number; readonly cols: number } }["size"]
}

export type PtysUpdateOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtysRemoveInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtysRemoveOutput = void

export type QuestionsListRequestsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type QuestionsListRequestsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly questions: ReadonlyArray<{
      readonly question: string
      readonly header: string
      readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
      readonly multiple?: boolean
      readonly purpose?: "plan_approval"
      readonly custom?: boolean
    }>
    readonly tool?: { readonly messageID: string; readonly callID: string }
  }>
}

export type QuestionsListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type QuestionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly questions: ReadonlyArray<{
      readonly question: string
      readonly header: string
      readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
      readonly multiple?: boolean
      readonly purpose?: "plan_approval"
      readonly custom?: boolean
    }>
    readonly tool?: { readonly messageID: string; readonly callID: string }
  }>
}["data"]

export type QuestionsReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly answers: { readonly answers: ReadonlyArray<ReadonlyArray<string>> }["answers"]
}

export type QuestionsReplyOutput = void

export type QuestionsRejectInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type QuestionsRejectOutput = void

export type ReferencesListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ReferencesListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly path: string
    readonly description?: string
    readonly hidden?: boolean
    readonly source:
      | { readonly type: "local"; readonly path: string; readonly description?: string; readonly hidden?: boolean }
      | {
          readonly type: "git"
          readonly repository: string
          readonly branch?: string
          readonly description?: string
          readonly hidden?: boolean
        }
  }>
}

export type ProjectCopiesCreateInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly strategy: { readonly strategy: string; readonly directory: string; readonly name?: string }["strategy"]
  readonly directory: { readonly strategy: string; readonly directory: string; readonly name?: string }["directory"]
  readonly name?: { readonly strategy: string; readonly directory: string; readonly name?: string }["name"]
}

export type ProjectCopiesCreateOutput = { readonly directory: string }

export type ProjectCopiesRemoveInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly directory: { readonly directory: string; readonly force: boolean }["directory"]
  readonly force: { readonly directory: string; readonly force: boolean }["force"]
}

export type ProjectCopiesRemoveOutput = void

export type ProjectCopiesRefreshInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProjectCopiesRefreshOutput = void
