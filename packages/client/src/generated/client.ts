import type {
  HealthGetOutput,
  ServerProjectListOutput,
  ServerProjectCurrentInput,
  ServerProjectCurrentOutput,
  LocationGetInput,
  LocationGetOutput,
  AgentsListInput,
  AgentsListOutput,
  SessionsListInput,
  SessionsListOutput,
  SessionsCreateInput,
  SessionsCreateOutput,
  SessionsSandboxInput,
  SessionsSandboxOutput,
  SessionsActiveOutput,
  SessionsGetInput,
  SessionsGetOutput,
  SessionsRemoveInput,
  SessionsRemoveOutput,
  SessionsSwitchAgentInput,
  SessionsSwitchAgentOutput,
  SessionsSwitchModelInput,
  SessionsSwitchModelOutput,
  SessionsPromptInput,
  SessionsPromptOutput,
  SessionsInputExecutionInput,
  SessionsInputExecutionOutput,
  SessionsInputWaitInput,
  SessionsInputWaitOutput,
  SessionsInputInterruptInput,
  SessionsInputInterruptOutput,
  SessionsCompactInput,
  SessionsCompactOutput,
  SessionsRestoreInput,
  SessionsRestoreOutput,
  SessionsWaitInput,
  SessionsWaitOutput,
  SessionsStageInput,
  SessionsStageOutput,
  SessionsClearInput,
  SessionsClearOutput,
  SessionsCommitInput,
  SessionsCommitOutput,
  SessionsContextInput,
  SessionsContextOutput,
  SessionsHistoryInput,
  SessionsHistoryOutput,
  SessionsEventsInput,
  SessionsEventsOutput,
  SessionsInterruptInput,
  SessionsInterruptOutput,
  SessionsMessageInput,
  SessionsMessageOutput,
  ServerGoalGetInput,
  ServerGoalGetOutput,
  ServerGoalCreateInput,
  ServerGoalCreateOutput,
  ServerGoalStartInput,
  ServerGoalStartOutput,
  ServerGoalRunInput,
  ServerGoalRunOutput,
  ServerGoalResumeInput,
  ServerGoalResumeOutput,
  ServerGoalPauseInput,
  ServerGoalPauseOutput,
  ServerGoalClearInput,
  ServerGoalClearOutput,
  ServerGoalReportsInput,
  ServerGoalReportsOutput,
  ServerGoalReportInput,
  ServerGoalReportOutput,
  ServerGoalCleanupReportsInput,
  ServerGoalCleanupReportsOutput,
  ServerTaskSendInput,
  ServerTaskSendOutput,
  ServerTaskGetInput,
  ServerTaskGetOutput,
  ServerTaskListInput,
  ServerTaskListOutput,
  ServerTaskOutputInput,
  ServerTaskOutputOutput,
  ServerTaskWaitInput,
  ServerTaskWaitOutput,
  ServerTaskCancelInput,
  ServerTaskCancelOutput,
  ServerProcessListInput,
  ServerProcessListOutput,
  ServerProcessOutputInput,
  ServerProcessOutputOutput,
  ServerProcessWaitInput,
  ServerProcessWaitOutput,
  ServerProcessCancelInput,
  ServerProcessCancelOutput,
  ServerScheduleListInput,
  ServerScheduleListOutput,
  ServerScheduleGetInput,
  ServerScheduleGetOutput,
  ServerScheduleDeleteInput,
  ServerScheduleDeleteOutput,
  ServerSchedulePauseInput,
  ServerSchedulePauseOutput,
  ServerScheduleResumeInput,
  ServerScheduleResumeOutput,
  ServerFeedbackListInput,
  ServerFeedbackListOutput,
  ServerFeedbackSaveInput,
  ServerFeedbackSaveOutput,
  ServerFeedbackReviewInput,
  ServerFeedbackReviewOutput,
  ServerFeedbackImageInput,
  ServerFeedbackImageOutput,
  ServerFeedbackRemoveInput,
  ServerFeedbackRemoveOutput,
  ServerMemoryStatusInput,
  ServerMemoryStatusOutput,
  ServerMemoryToggleInput,
  ServerMemoryToggleOutput,
  ServerMemoryListInput,
  ServerMemoryListOutput,
  ServerMemoryPreviewInput,
  ServerMemoryPreviewOutput,
  ServerMemoryForgetInput,
  ServerMemoryForgetOutput,
  ServerMemoryOperationRetryInput,
  ServerMemoryOperationRetryOutput,
  ServerMemoryOperationRecoveryPreviewInput,
  ServerMemoryOperationRecoveryPreviewOutput,
  ServerMemoryOperationRecoverInput,
  ServerMemoryOperationRecoverOutput,
  ServerMemoryOperationMigrationPreviewInput,
  ServerMemoryOperationMigrationPreviewOutput,
  ServerMemoryOperationMigrateInput,
  ServerMemoryOperationMigrateOutput,
  ServerMemoryOperationDreamInput,
  ServerMemoryOperationDreamOutput,
  ServerMemoryOperationFlushInput,
  ServerMemoryOperationFlushOutput,
  ServerMemoryOperationOperationsInput,
  ServerMemoryOperationOperationsOutput,
  ServerMemoryOperationOperationInput,
  ServerMemoryOperationOperationOutput,
  ServerMemoryOperationCancelInput,
  ServerMemoryOperationCancelOutput,
  ServerHooksGetInput,
  ServerHooksGetOutput,
  ServerHooksReloadInput,
  ServerHooksReloadOutput,
  ServerHooksTrustInput,
  ServerHooksTrustOutput,
  ServerHooksPreferenceInput,
  ServerHooksPreferenceOutput,
  ServerPluginsListOutput,
  ServerPluginsDetailInput,
  ServerPluginsDetailOutput,
  ServerPluginsManageInput,
  ServerPluginsManageOutput,
  ServerPluginsRuntimeInput,
  ServerPluginsRuntimeOutput,
  ServerPluginsReloadInput,
  ServerPluginsReloadOutput,
  ServerMcpStatusInput,
  ServerMcpStatusOutput,
  ServerMcpConnectInput,
  ServerMcpConnectOutput,
  ServerMcpDisconnectInput,
  ServerMcpDisconnectOutput,
  ServerMcpRetryInput,
  ServerMcpRetryOutput,
  ServerMcpResetPreferenceInput,
  ServerMcpResetPreferenceOutput,
  ServerMcpAuthStartInput,
  ServerMcpAuthStartOutput,
  ServerMcpAuthCancelInput,
  ServerMcpAuthCancelOutput,
  SessionMcpAttachmentsReserveInput,
  SessionMcpAttachmentsReserveOutput,
  SessionMcpAttachmentsExecuteInput,
  SessionMcpAttachmentsExecuteOutput,
  SessionMcpAttachmentsStatusInput,
  SessionMcpAttachmentsStatusOutput,
  SessionMcpAttachmentsCancelInput,
  SessionMcpAttachmentsCancelOutput,
  ServerLspStatusInput,
  ServerLspStatusOutput,
  ServerWorkflowRelatedInput,
  ServerWorkflowRelatedOutput,
  ServerWorkflowLaunchInput,
  ServerWorkflowLaunchOutput,
  ServerWorkflowSourcesInput,
  ServerWorkflowSourcesOutput,
  ServerWorkflowValidateInput,
  ServerWorkflowValidateOutput,
  ServerWorkflowListInput,
  ServerWorkflowListOutput,
  ServerWorkflowStartInput,
  ServerWorkflowStartOutput,
  ServerWorkflowGetInput,
  ServerWorkflowGetOutput,
  ServerWorkflowResumeInput,
  ServerWorkflowResumeOutput,
  ServerWorkflowPauseInput,
  ServerWorkflowPauseOutput,
  ServerWorkflowStopInput,
  ServerWorkflowStopOutput,
  ServerSideQuestionListInput,
  ServerSideQuestionListOutput,
  ServerSideQuestionAskInput,
  ServerSideQuestionAskOutput,
  ServerSideQuestionCancelInput,
  ServerSideQuestionCancelOutput,
  MessagesListInput,
  MessagesListOutput,
  ServerBrowserListInput,
  ServerBrowserListOutput,
  ServerBrowserOpenInput,
  ServerBrowserOpenOutput,
  ServerBrowserActionInput,
  ServerBrowserActionOutput,
  ServerBrowserCloseInput,
  ServerBrowserCloseOutput,
  ServerBrowserEventsInput,
  ServerBrowserEventsOutput,
  ServerComputerListInput,
  ServerComputerListOutput,
  ServerComputerOpenInput,
  ServerComputerOpenOutput,
  ServerComputerActionInput,
  ServerComputerActionOutput,
  ServerComputerCloseInput,
  ServerComputerCloseOutput,
  ServerComputerEventsInput,
  ServerComputerEventsOutput,
  ModelsListInput,
  ModelsListOutput,
  ProvidersListInput,
  ProvidersListOutput,
  ProvidersGetInput,
  ProvidersGetOutput,
  IntegrationsExternalInput,
  IntegrationsExternalOutput,
  IntegrationsListInput,
  IntegrationsListOutput,
  IntegrationsGetInput,
  IntegrationsGetOutput,
  IntegrationsConnectKeyInput,
  IntegrationsConnectKeyOutput,
  IntegrationsConnectOauthInput,
  IntegrationsConnectOauthOutput,
  IntegrationsAttemptStatusInput,
  IntegrationsAttemptStatusOutput,
  IntegrationsAttemptCompleteInput,
  IntegrationsAttemptCompleteOutput,
  IntegrationsAttemptCancelInput,
  IntegrationsAttemptCancelOutput,
  CredentialsUpdateInput,
  CredentialsUpdateOutput,
  CredentialsRemoveInput,
  CredentialsRemoveOutput,
  PermissionsListRequestsInput,
  PermissionsListRequestsOutput,
  PermissionsListSavedInput,
  PermissionsListSavedOutput,
  PermissionsRemoveSavedInput,
  PermissionsRemoveSavedOutput,
  PermissionsCreateInput,
  PermissionsCreateOutput,
  PermissionsListInput,
  PermissionsListOutput,
  PermissionsGetInput,
  PermissionsGetOutput,
  PermissionsReplyInput,
  PermissionsReplyOutput,
  FilesListInput,
  FilesListOutput,
  FilesFindInput,
  FilesFindOutput,
  CommandsListInput,
  CommandsListOutput,
  SkillsListInput,
  SkillsListOutput,
  SkillsReloadInput,
  SkillsReloadOutput,
  EventsSubscribeOutput,
  PtysListInput,
  PtysListOutput,
  PtysCreateInput,
  PtysCreateOutput,
  PtysGetInput,
  PtysGetOutput,
  PtysUpdateInput,
  PtysUpdateOutput,
  PtysRemoveInput,
  PtysRemoveOutput,
  QuestionsListRequestsInput,
  QuestionsListRequestsOutput,
  QuestionsListInput,
  QuestionsListOutput,
  QuestionsReplyInput,
  QuestionsReplyOutput,
  QuestionsRejectInput,
  QuestionsRejectOutput,
  ReferencesListInput,
  ReferencesListOutput,
  ProjectCopiesCreateInput,
  ProjectCopiesCreateOutput,
  ProjectCopiesRemoveInput,
  ProjectCopiesRemoveOutput,
  ProjectCopiesRefreshInput,
  ProjectCopiesRefreshOutput,
} from "./types"
import { ClientError } from "./client-error"

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: HeadersInit
}

export interface RequestOptions {
  readonly signal?: AbortSignal
  readonly headers?: HeadersInit
}

interface RequestDescriptor {
  readonly method: string
  readonly path: string
  readonly query?: Record<string, unknown>
  readonly headers?: Record<string, unknown>
  readonly body?: unknown
  readonly successStatus: number
  readonly declaredStatuses: ReadonlyArray<number>
  readonly empty: boolean
}

export function make(options: ClientOptions) {
  const fetch = options.fetch ?? globalThis.fetch

  const prepare = (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    const url = new URL(descriptor.path, options.baseUrl)
    for (const [key, value] of Object.entries(descriptor.query ?? {})) appendQuery(url.searchParams, key, value)
    const headers = new Headers(options.headers)
    for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
      if (value !== undefined && value !== null) headers.set(key, String(value))
    }
    for (const [key, value] of new Headers(requestOptions?.headers)) headers.set(key, value)
    if (descriptor.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
    return {
      url,
      init: {
        method: descriptor.method,
        signal: requestOptions?.signal,
        headers,
        body: descriptor.body === undefined ? undefined : JSON.stringify(descriptor.body),
      } satisfies RequestInit,
    }
  }

  const execute = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    try {
      const prepared = prepare(descriptor, requestOptions)
      return await fetch(prepared.url, prepared.init)
    } catch (cause) {
      throw new ClientError("Transport", { cause })
    }
  }

  const responseError = async (response: Response, descriptor: RequestDescriptor): Promise<never> => {
    if (descriptor.declaredStatuses.includes(response.status)) throw await json(response)
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnexpectedStatus", { cause: { status: response.status } })
  }

  const request = async <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): Promise<A> => {
    const response = await execute(descriptor, requestOptions)
    if (response.status !== descriptor.successStatus) return responseError(response, descriptor)
    if (descriptor.empty) {
      try {
        await response.body?.cancel()
      } catch {}
      return undefined as A
    }
    return (await json(response)) as A
  }

  const sse = <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): AsyncIterable<A> => ({
    async *[Symbol.asyncIterator]() {
      const response = await execute(descriptor, requestOptions)
      if (response.status !== descriptor.successStatus) await responseError(response, descriptor)
      if (!isContentType(response, "text/event-stream")) {
        try {
          await response.body?.cancel()
        } catch {}
        throw new ClientError("UnsupportedContentType")
      }
      if (response.body === null) throw new ClientError("MalformedResponse")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        while (true) {
          let next
          try {
            next = await reader.read()
          } catch (cause) {
            throw new ClientError("Transport", { cause })
          }
          buffer += decoder.decode(next.value, { stream: !next.done })
          if (buffer.length > 1_048_576) throw new ClientError("MalformedResponse")
          const trailingCarriageReturn = !next.done && buffer.endsWith("\r")
          if (trailingCarriageReturn) buffer = buffer.slice(0, -1)
          buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
          if (trailingCarriageReturn) buffer += "\r"
          if (next.done && buffer !== "") buffer += "\n\n"
          let boundary = buffer.indexOf("\n\n")
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = block
              .split("\n")
              .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
              .join("\n")
            if (data !== "") {
              try {
                yield JSON.parse(data) as A
              } catch (cause) {
                throw new ClientError("MalformedResponse", { cause })
              }
            }
            boundary = buffer.indexOf("\n\n")
          }
          if (next.done) return
        }
      } finally {
        try {
          await reader.cancel()
        } catch {}
        reader.releaseLock()
      }
    },
  })

  return {
    health: {
      get: (requestOptions?: RequestOptions) =>
        request<HealthGetOutput>(
          { method: "GET", path: `/api/health`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    "server.project": {
      list: (requestOptions?: RequestOptions) =>
        request<ServerProjectListOutput>(
          { method: "GET", path: `/api/project`, successStatus: 200, declaredStatuses: [503, 401, 400], empty: false },
          requestOptions,
        ),
      current: (input?: ServerProjectCurrentInput, requestOptions?: RequestOptions) =>
        request<ServerProjectCurrentOutput>(
          {
            method: "GET",
            path: `/api/project/current`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    location: {
      get: (input?: LocationGetInput, requestOptions?: RequestOptions) =>
        request<LocationGetOutput>(
          {
            method: "GET",
            path: `/api/location`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    agents: {
      list: (input?: AgentsListInput, requestOptions?: RequestOptions) =>
        request<AgentsListOutput>(
          {
            method: "GET",
            path: `/api/agent`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    sessions: {
      list: (input?: SessionsListInput, requestOptions?: RequestOptions) =>
        request<SessionsListOutput>(
          {
            method: "GET",
            path: `/api/session`,
            query: {
              workspace: input?.["workspace"],
              limit: input?.["limit"],
              order: input?.["order"],
              search: input?.["search"],
              directory: input?.["directory"],
              project: input?.["project"],
              subpath: input?.["subpath"],
              cursor: input?.["cursor"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: SessionsCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsCreateOutput }>(
          {
            method: "POST",
            path: `/api/session`,
            body: {
              id: input?.["id"],
              parentID: input?.["parentID"],
              agent: input?.["agent"],
              model: input?.["model"],
              location: input?.["location"],
              commandSandbox: input?.["commandSandbox"],
            },
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      sandbox: (input: SessionsSandboxInput, requestOptions?: RequestOptions) =>
        request<SessionsSandboxOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/sandbox`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      active: (requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsActiveOutput }>(
          {
            method: "GET",
            path: `/api/session/active`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: SessionsGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      remove: (input: SessionsRemoveInput, requestOptions?: RequestOptions) =>
        request<SessionsRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 204,
            declaredStatuses: [503, 401, 400],
            empty: true,
          },
          requestOptions,
        ),
      switchAgent: (input: SessionsSwitchAgentInput, requestOptions?: RequestOptions) =>
        request<SessionsSwitchAgentOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/agent`,
            body: { agent: input["agent"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      switchModel: (input: SessionsSwitchModelInput, requestOptions?: RequestOptions) =>
        request<SessionsSwitchModelOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/model`,
            body: { model: input["model"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      prompt: (input: SessionsPromptInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsPromptOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/prompt`,
            body: {
              id: input["id"],
              prompt: input["prompt"],
              delivery: input["delivery"],
              executionPolicy: input["executionPolicy"],
              resume: input["resume"],
            },
            successStatus: 200,
            declaredStatuses: [409, 404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      inputExecution: (input: SessionsInputExecutionInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsInputExecutionOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/input/${encodeURIComponent(input.inputID)}/execution`,
            successStatus: 200,
            declaredStatuses: [409, 404, 503, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      inputWait: (input: SessionsInputWaitInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsInputWaitOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/input/${encodeURIComponent(input.inputID)}/execution/wait`,
            body: { timeoutMs: input["timeoutMs"] },
            successStatus: 200,
            declaredStatuses: [409, 404, 503, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      inputInterrupt: (input: SessionsInputInterruptInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsInputInterruptOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/input/${encodeURIComponent(input.inputID)}/execution/interrupt`,
            successStatus: 200,
            declaredStatuses: [409, 404, 503, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      compact: (input: SessionsCompactInput, requestOptions?: RequestOptions) =>
        request<SessionsCompactOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/compact`,
            successStatus: 204,
            declaredStatuses: [404, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      restore: (input: SessionsRestoreInput, requestOptions?: RequestOptions) =>
        request<SessionsRestoreOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/restore`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      wait: (input: SessionsWaitInput, requestOptions?: RequestOptions) =>
        request<SessionsWaitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/wait`,
            successStatus: 204,
            declaredStatuses: [404, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      stage: (input: SessionsStageInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsStageOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/stage`,
            body: { messageID: input["messageID"], files: input["files"] },
            successStatus: 200,
            declaredStatuses: [404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      clear: (input: SessionsClearInput, requestOptions?: RequestOptions) =>
        request<SessionsClearOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/clear`,
            successStatus: 204,
            declaredStatuses: [404, 500, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      commit: (input: SessionsCommitInput, requestOptions?: RequestOptions) =>
        request<SessionsCommitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/commit`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      context: (input: SessionsContextInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsContextOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/context`,
            successStatus: 200,
            declaredStatuses: [404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      history: (input: SessionsHistoryInput, requestOptions?: RequestOptions) =>
        request<SessionsHistoryOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/history`,
            query: { limit: input["limit"], after: input["after"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      events: (input: SessionsEventsInput, requestOptions?: RequestOptions): AsyncIterable<SessionsEventsOutput> =>
        sse<SessionsEventsOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/event`,
            query: { after: input["after"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      interrupt: (input: SessionsInterruptInput, requestOptions?: RequestOptions) =>
        request<SessionsInterruptOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/interrupt`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      message: (input: SessionsMessageInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsMessageOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
    },
    "server.goal": {
      get: (input: ServerGoalGetInput, requestOptions?: RequestOptions) =>
        request<ServerGoalGetOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/goal`,
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: ServerGoalCreateInput, requestOptions?: RequestOptions) =>
        request<ServerGoalCreateOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/goal`,
            body: { id: input["id"], objective: input["objective"], tokenBudget: input["tokenBudget"] },
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      start: (input: ServerGoalStartInput, requestOptions?: RequestOptions) =>
        request<ServerGoalStartOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/goal/${encodeURIComponent(input.goalID)}/start`,
            body: { model: input["model"], agent: input["agent"] },
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      run: (input: ServerGoalRunInput, requestOptions?: RequestOptions) =>
        request<ServerGoalRunOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/goal/${encodeURIComponent(input.goalID)}/run`,
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      resume: (input: ServerGoalResumeInput, requestOptions?: RequestOptions) =>
        request<ServerGoalResumeOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/goal/${encodeURIComponent(input.goalID)}/resume`,
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      pause: (input: ServerGoalPauseInput, requestOptions?: RequestOptions) =>
        request<ServerGoalPauseOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/goal/${encodeURIComponent(input.goalID)}/pause`,
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      clear: (input: ServerGoalClearInput, requestOptions?: RequestOptions) =>
        request<ServerGoalClearOutput>(
          {
            method: "DELETE",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/goal/${encodeURIComponent(input.goalID)}`,
            successStatus: 204,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: true,
          },
          requestOptions,
        ),
      reports: (input: ServerGoalReportsInput, requestOptions?: RequestOptions) =>
        request<ServerGoalReportsOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/goal/${encodeURIComponent(input.goalID)}/reports`,
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      report: (input: ServerGoalReportInput, requestOptions?: RequestOptions) =>
        request<ServerGoalReportOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/goal/${encodeURIComponent(input.goalID)}/reports/${encodeURIComponent(input.reportID)}/${encodeURIComponent(input.file)}`,
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      cleanupReports: (input: ServerGoalCleanupReportsInput, requestOptions?: RequestOptions) =>
        request<ServerGoalCleanupReportsOutput>(
          {
            method: "DELETE",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/goal/${encodeURIComponent(input.goalID)}/reports`,
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.task": {
      send: (input: ServerTaskSendInput, requestOptions?: RequestOptions) =>
        request<ServerTaskSendOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/task/${encodeURIComponent(input.taskID)}/message`,
            body: { inputID: input["inputID"], text: input["text"], delivery: input["delivery"] },
            successStatus: 200,
            declaredStatuses: [403, 404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ServerTaskGetInput, requestOptions?: RequestOptions) =>
        request<ServerTaskGetOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/task/${encodeURIComponent(input.taskID)}/message/${encodeURIComponent(input.inputID)}`,
            successStatus: 200,
            declaredStatuses: [403, 404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      list: (input: ServerTaskListInput, requestOptions?: RequestOptions) =>
        request<ServerTaskListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/task`,
            query: { limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [403, 404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      output: (input: ServerTaskOutputInput, requestOptions?: RequestOptions) =>
        request<ServerTaskOutputOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/task/${encodeURIComponent(input.taskID)}`,
            successStatus: 200,
            declaredStatuses: [403, 404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      wait: (input: ServerTaskWaitInput, requestOptions?: RequestOptions) =>
        request<ServerTaskWaitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/task/${encodeURIComponent(input.taskID)}/wait`,
            body: { timeoutMs: input["timeoutMs"] },
            successStatus: 200,
            declaredStatuses: [403, 404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      cancel: (input: ServerTaskCancelInput, requestOptions?: RequestOptions) =>
        request<ServerTaskCancelOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/task/${encodeURIComponent(input.taskID)}/cancel`,
            successStatus: 204,
            declaredStatuses: [403, 404, 409, 400, 503, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    "server.process": {
      list: (input: ServerProcessListInput, requestOptions?: RequestOptions) =>
        request<ServerProcessListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/process`,
            query: { limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      output: (input: ServerProcessOutputInput, requestOptions?: RequestOptions) =>
        request<ServerProcessOutputOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/process/${encodeURIComponent(input.processID)}`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      wait: (input: ServerProcessWaitInput, requestOptions?: RequestOptions) =>
        request<ServerProcessWaitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/process/${encodeURIComponent(input.processID)}/wait`,
            body: { timeoutMs: input["timeoutMs"] },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      cancel: (input: ServerProcessCancelInput, requestOptions?: RequestOptions) =>
        request<ServerProcessCancelOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/process/${encodeURIComponent(input.processID)}/cancel`,
            successStatus: 204,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    "server.schedule": {
      list: (input: ServerScheduleListInput, requestOptions?: RequestOptions) =>
        request<ServerScheduleListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/schedule`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ServerScheduleGetInput, requestOptions?: RequestOptions) =>
        request<ServerScheduleGetOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/schedule/${encodeURIComponent(input.scheduleID)}`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      delete: (input: ServerScheduleDeleteInput, requestOptions?: RequestOptions) =>
        request<ServerScheduleDeleteOutput>(
          {
            method: "DELETE",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/schedule/${encodeURIComponent(input.scheduleID)}`,
            successStatus: 204,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: true,
          },
          requestOptions,
        ),
      pause: (input: ServerSchedulePauseInput, requestOptions?: RequestOptions) =>
        request<ServerSchedulePauseOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/schedule/${encodeURIComponent(input.scheduleID)}/pause`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      resume: (input: ServerScheduleResumeInput, requestOptions?: RequestOptions) =>
        request<ServerScheduleResumeOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/schedule/${encodeURIComponent(input.scheduleID)}/resume`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.feedback": {
      list: (input: ServerFeedbackListInput, requestOptions?: RequestOptions) =>
        request<ServerFeedbackListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/feedback`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      save: (input: ServerFeedbackSaveInput, requestOptions?: RequestOptions) =>
        request<ServerFeedbackSaveOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/feedback`,
            body: {
              title: input["title"],
              details: input["details"],
              product_area: input["product_area"],
              type: input["type"],
              task_category: input["task_category"],
              failure_mode: input["failure_mode"],
              draft_id: input["draft_id"],
              revision: input["revision"],
              images: input["images"],
            },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      review: (input: ServerFeedbackReviewInput, requestOptions?: RequestOptions) =>
        request<ServerFeedbackReviewOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/feedback/${encodeURIComponent(input.draftID)}/review`,
            body: { revision: input["revision"] },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      image: (input: ServerFeedbackImageInput, requestOptions?: RequestOptions) =>
        request<ServerFeedbackImageOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/feedback/${encodeURIComponent(input.draftID)}/image/${encodeURIComponent(input.imageID)}`,
            body: { revision: input["revision"] },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ServerFeedbackRemoveInput, requestOptions?: RequestOptions) =>
        request<ServerFeedbackRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/feedback/${encodeURIComponent(input.draftID)}`,
            body: { revision: input["revision"] },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.memory": {
      status: (input: ServerMemoryStatusInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryStatusOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory`,
            successStatus: 200,
            declaredStatuses: [403, 404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      toggle: (input: ServerMemoryToggleInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryToggleOutput>(
          {
            method: "PATCH",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory`,
            body: { enabled: input["enabled"] },
            successStatus: 200,
            declaredStatuses: [403, 404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      list: (input: ServerMemoryListInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/notes`,
            query: { query: input["query"] },
            successStatus: 200,
            declaredStatuses: [403, 404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      preview: (input: ServerMemoryPreviewInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryPreviewOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/note`,
            query: { path: input["path"] },
            successStatus: 200,
            declaredStatuses: [403, 404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      forget: (input: ServerMemoryForgetInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryForgetOutput>(
          {
            method: "DELETE",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/note`,
            body: { path: input["path"], hash: input["hash"] },
            successStatus: 200,
            declaredStatuses: [403, 404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.memoryOperation": {
      retry: (input: ServerMemoryOperationRetryInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryOperationRetryOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/retry`,
            body: { id: input["id"], retryOf: input["retryOf"] },
            successStatus: 200,
            declaredStatuses: [404, 403, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      recoveryPreview: (input: ServerMemoryOperationRecoveryPreviewInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryOperationRecoveryPreviewOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/recovery`,
            query: { action: input["action"], scope: input["scope"] },
            successStatus: 200,
            declaredStatuses: [404, 403, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      recover: (input: ServerMemoryOperationRecoverInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryOperationRecoverOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/recovery`,
            body: { id: input["id"], retryOf: input["retryOf"], preview: input["preview"] },
            successStatus: 200,
            declaredStatuses: [404, 403, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      migrationPreview: (input: ServerMemoryOperationMigrationPreviewInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryOperationMigrationPreviewOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/migration`,
            query: { kind: input["kind"], scope: input["scope"] },
            successStatus: 200,
            declaredStatuses: [404, 403, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      migrate: (input: ServerMemoryOperationMigrateInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryOperationMigrateOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/migration`,
            body: { id: input["id"], retryOf: input["retryOf"], preview: input["preview"] },
            successStatus: 200,
            declaredStatuses: [404, 403, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      dream: (input: ServerMemoryOperationDreamInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryOperationDreamOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/dream`,
            body: { id: input["id"], retryOf: input["retryOf"] },
            successStatus: 200,
            declaredStatuses: [404, 403, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      flush: (input: ServerMemoryOperationFlushInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryOperationFlushOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/flush`,
            body: { id: input["id"], retryOf: input["retryOf"] },
            successStatus: 200,
            declaredStatuses: [404, 403, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      operations: (input: ServerMemoryOperationOperationsInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryOperationOperationsOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/operation`,
            successStatus: 200,
            declaredStatuses: [404, 403, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      operation: (input: ServerMemoryOperationOperationInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryOperationOperationOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/operation/${encodeURIComponent(input.operationID)}`,
            successStatus: 200,
            declaredStatuses: [404, 403, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      cancel: (input: ServerMemoryOperationCancelInput, requestOptions?: RequestOptions) =>
        request<ServerMemoryOperationCancelOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/memory/operation/${encodeURIComponent(input.operationID)}/cancel`,
            successStatus: 200,
            declaredStatuses: [404, 403, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.hooks": {
      get: (input: ServerHooksGetInput, requestOptions?: RequestOptions) =>
        request<ServerHooksGetOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/hooks`,
            successStatus: 200,
            declaredStatuses: [503, 404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      reload: (input: ServerHooksReloadInput, requestOptions?: RequestOptions) =>
        request<ServerHooksReloadOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/hooks/reload`,
            successStatus: 200,
            declaredStatuses: [409, 503, 404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      trust: (input: ServerHooksTrustInput, requestOptions?: RequestOptions) =>
        request<ServerHooksTrustOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/hooks/trust`,
            body: { root: input["root"], token: input["token"], trusted: input["trusted"] },
            successStatus: 200,
            declaredStatuses: [400, 409, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      preference: (input: ServerHooksPreferenceInput, requestOptions?: RequestOptions) =>
        request<ServerHooksPreferenceOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/hooks/preference`,
            body: { hookID: input["hookID"], enabled: input["enabled"] },
            successStatus: 200,
            declaredStatuses: [400, 409, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.plugins": {
      list: (requestOptions?: RequestOptions) =>
        request<ServerPluginsListOutput>(
          {
            method: "GET",
            path: `/api/plugins`,
            successStatus: 200,
            declaredStatuses: [400, 409, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      detail: (input: ServerPluginsDetailInput, requestOptions?: RequestOptions) =>
        request<ServerPluginsDetailOutput>(
          {
            method: "GET",
            path: `/api/plugins/detail`,
            query: { id: input["id"] },
            successStatus: 200,
            declaredStatuses: [400, 409, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      manage: (input: ServerPluginsManageInput, requestOptions?: RequestOptions) =>
        request<ServerPluginsManageOutput>(
          {
            method: "POST",
            path: `/api/plugins/manage`,
            body: {
              action: input["action"],
              id: input["id"],
              source: input["source"],
              trust: input["trust"],
              keepData: input["keepData"],
            },
            successStatus: 200,
            declaredStatuses: [400, 409, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      runtime: (input?: ServerPluginsRuntimeInput, requestOptions?: RequestOptions) =>
        request<ServerPluginsRuntimeOutput>(
          {
            method: "GET",
            path: `/api/plugins/runtime`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 409, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      reload: (input?: ServerPluginsReloadInput, requestOptions?: RequestOptions) =>
        request<ServerPluginsReloadOutput>(
          {
            method: "POST",
            path: `/api/plugins/reload`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 409, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.mcp": {
      status: (input?: ServerMcpStatusInput, requestOptions?: RequestOptions) =>
        request<ServerMcpStatusOutput>(
          {
            method: "GET",
            path: `/api/mcp`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      connect: (input: ServerMcpConnectInput, requestOptions?: RequestOptions) =>
        request<ServerMcpConnectOutput>(
          {
            method: "POST",
            path: `/api/mcp/${encodeURIComponent(input.server)}/connect`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      disconnect: (input: ServerMcpDisconnectInput, requestOptions?: RequestOptions) =>
        request<ServerMcpDisconnectOutput>(
          {
            method: "POST",
            path: `/api/mcp/${encodeURIComponent(input.server)}/disconnect`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      retry: (input: ServerMcpRetryInput, requestOptions?: RequestOptions) =>
        request<ServerMcpRetryOutput>(
          {
            method: "POST",
            path: `/api/mcp/${encodeURIComponent(input.server)}/retry`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      resetPreference: (input: ServerMcpResetPreferenceInput, requestOptions?: RequestOptions) =>
        request<ServerMcpResetPreferenceOutput>(
          {
            method: "POST",
            path: `/api/mcp/${encodeURIComponent(input.server)}/resetPreference`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      authStart: (input: ServerMcpAuthStartInput, requestOptions?: RequestOptions) =>
        request<ServerMcpAuthStartOutput>(
          {
            method: "POST",
            path: `/api/mcp/${encodeURIComponent(input.server)}/auth/start`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      authCancel: (input: ServerMcpAuthCancelInput, requestOptions?: RequestOptions) =>
        request<ServerMcpAuthCancelOutput>(
          {
            method: "DELETE",
            path: `/api/mcp/${encodeURIComponent(input.server)}/auth/${encodeURIComponent(input.flowID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    sessionMcpAttachments: {
      reserve: (input: SessionMcpAttachmentsReserveInput, requestOptions?: RequestOptions) =>
        request<SessionMcpAttachmentsReserveOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/mcp/operations`,
            body: { request: input["request"] },
            successStatus: 200,
            declaredStatuses: [403, 409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      execute: (input: SessionMcpAttachmentsExecuteInput, requestOptions?: RequestOptions) =>
        request<SessionMcpAttachmentsExecuteOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/mcp/operations/${encodeURIComponent(input.operationID)}/execute`,
            body: { request: input["request"] },
            successStatus: 200,
            declaredStatuses: [403, 409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      status: (input: SessionMcpAttachmentsStatusInput, requestOptions?: RequestOptions) =>
        request<SessionMcpAttachmentsStatusOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/mcp/operations/${encodeURIComponent(input.operationID)}`,
            successStatus: 200,
            declaredStatuses: [403, 409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      cancel: (input: SessionMcpAttachmentsCancelInput, requestOptions?: RequestOptions) =>
        request<SessionMcpAttachmentsCancelOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/mcp/operations/${encodeURIComponent(input.operationID)}/cancel`,
            successStatus: 200,
            declaredStatuses: [403, 409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.lsp": {
      status: (input?: ServerLspStatusInput, requestOptions?: RequestOptions) =>
        request<ServerLspStatusOutput>(
          {
            method: "GET",
            path: `/api/lsp`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.workflow": {
      related: (input: ServerWorkflowRelatedInput, requestOptions?: RequestOptions) =>
        request<ServerWorkflowRelatedOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/workflow/related`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      launch: (input: ServerWorkflowLaunchInput, requestOptions?: RequestOptions) =>
        request<ServerWorkflowLaunchOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/workflow/launch`,
            body: {
              source: input["source"],
              args: input["args"],
              agentBudget: input["agentBudget"],
              concurrency: input["concurrency"],
              model: input["model"],
              agent: input["agent"],
            },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      sources: (input: ServerWorkflowSourcesInput, requestOptions?: RequestOptions) =>
        request<ServerWorkflowSourcesOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/workflow/sources`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      validate: (input: ServerWorkflowValidateInput, requestOptions?: RequestOptions) =>
        request<ServerWorkflowValidateOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/workflow/validate`,
            body: { source: input["source"] },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      list: (input: ServerWorkflowListInput, requestOptions?: RequestOptions) =>
        request<ServerWorkflowListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/workflow`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      start: (input: ServerWorkflowStartInput, requestOptions?: RequestOptions) =>
        request<ServerWorkflowStartOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/workflow`,
            body: {
              source: input["source"],
              args: input["args"],
              agentBudget: input["agentBudget"],
              concurrency: input["concurrency"],
            },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ServerWorkflowGetInput, requestOptions?: RequestOptions) =>
        request<ServerWorkflowGetOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/workflow/${encodeURIComponent(input.workflowID)}`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      resume: (input: ServerWorkflowResumeInput, requestOptions?: RequestOptions) =>
        request<ServerWorkflowResumeOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/workflow/${encodeURIComponent(input.workflowID)}/resume`,
            body: { agentBudget: input["agentBudget"] },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      pause: (input: ServerWorkflowPauseInput, requestOptions?: RequestOptions) =>
        request<ServerWorkflowPauseOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/workflow/${encodeURIComponent(input.workflowID)}/pause`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      stop: (input: ServerWorkflowStopInput, requestOptions?: RequestOptions) =>
        request<ServerWorkflowStopOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/workflow/${encodeURIComponent(input.workflowID)}/stop`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.sideQuestion": {
      list: (input: ServerSideQuestionListInput, requestOptions?: RequestOptions) =>
        request<ServerSideQuestionListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/side-question`,
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      ask: (input: ServerSideQuestionAskInput, requestOptions?: RequestOptions) =>
        request<ServerSideQuestionAskOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/side-question`,
            body: { question: input["question"], images: input["images"] },
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
      cancel: (input: ServerSideQuestionCancelInput, requestOptions?: RequestOptions) =>
        request<ServerSideQuestionCancelOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/side-question/${encodeURIComponent(input.questionID)}/cancel`,
            successStatus: 200,
            declaredStatuses: [409, 400, 503, 404, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    messages: {
      list: (input: MessagesListInput, requestOptions?: RequestOptions) =>
        request<MessagesListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message`,
            query: { limit: input["limit"], order: input["order"], cursor: input["cursor"] },
            successStatus: 200,
            declaredStatuses: [400, 404, 500, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.browser": {
      list: (input: ServerBrowserListInput, requestOptions?: RequestOptions) =>
        request<ServerBrowserListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/browser`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      open: (input: ServerBrowserOpenInput, requestOptions?: RequestOptions) =>
        request<ServerBrowserOpenOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/browser`,
            body: { url: input["url"], cdpUrl: input["cdpUrl"] },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      action: (input: ServerBrowserActionInput, requestOptions?: RequestOptions) =>
        request<ServerBrowserActionOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/browser/${encodeURIComponent(input.browserSessionID)}/action`,
            body: {
              action: input["action"],
              pageID: input["pageID"],
              url: input["url"],
              selector: input["selector"],
              text: input["text"],
              key: input["key"],
              x: input["x"],
              y: input["y"],
              expectedSnapshotHash: input["expectedSnapshotHash"],
              fullPage: input["fullPage"],
              destructive: input["destructive"],
            },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      close: (input: ServerBrowserCloseInput, requestOptions?: RequestOptions) =>
        request<ServerBrowserCloseOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/browser/${encodeURIComponent(input.browserSessionID)}/close`,
            successStatus: 204,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: true,
          },
          requestOptions,
        ),
      events: (input: ServerBrowserEventsInput, requestOptions?: RequestOptions) =>
        request<ServerBrowserEventsOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/browser/${encodeURIComponent(input.browserSessionID)}/events`,
            query: { after: input["after"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.computer": {
      list: (input: ServerComputerListInput, requestOptions?: RequestOptions) =>
        request<ServerComputerListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/computer`,
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      open: (input: ServerComputerOpenInput, requestOptions?: RequestOptions) =>
        request<ServerComputerOpenOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/computer`,
            body: { backend: input["backend"] },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      action: (input: ServerComputerActionInput, requestOptions?: RequestOptions) =>
        request<ServerComputerActionOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/computer/${encodeURIComponent(input.computerSessionID)}/action`,
            body: {
              action: input["action"],
              x: input["x"],
              y: input["y"],
              text: input["text"],
              key: input["key"],
              target: input["target"],
              expectedSnapshotHash: input["expectedSnapshotHash"],
              destructive: input["destructive"],
            },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      close: (input: ServerComputerCloseInput, requestOptions?: RequestOptions) =>
        request<ServerComputerCloseOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/computer/${encodeURIComponent(input.computerSessionID)}/close`,
            successStatus: 204,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: true,
          },
          requestOptions,
        ),
      events: (input: ServerComputerEventsInput, requestOptions?: RequestOptions) =>
        request<ServerComputerEventsOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/computer/${encodeURIComponent(input.computerSessionID)}/events`,
            query: { after: input["after"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [404, 409, 400, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    models: {
      list: (input?: ModelsListInput, requestOptions?: RequestOptions) =>
        request<ModelsListOutput>(
          {
            method: "GET",
            path: `/api/model`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    providers: {
      list: (input?: ProvidersListInput, requestOptions?: RequestOptions) =>
        request<ProvidersListOutput>(
          {
            method: "GET",
            path: `/api/provider`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ProvidersGetInput, requestOptions?: RequestOptions) =>
        request<ProvidersGetOutput>(
          {
            method: "GET",
            path: `/api/provider/${encodeURIComponent(input.providerID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    integrations: {
      external: (input: IntegrationsExternalInput, requestOptions?: RequestOptions) =>
        request<IntegrationsExternalOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/external`,
            query: { location: input["location"] },
            body: { methodID: input["methodID"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      list: (input?: IntegrationsListInput, requestOptions?: RequestOptions) =>
        request<IntegrationsListOutput>(
          {
            method: "GET",
            path: `/api/integration`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: IntegrationsGetInput, requestOptions?: RequestOptions) =>
        request<IntegrationsGetOutput>(
          {
            method: "GET",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      connectKey: (input: IntegrationsConnectKeyInput, requestOptions?: RequestOptions) =>
        request<IntegrationsConnectKeyOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/key`,
            query: { location: input["location"] },
            body: { key: input["key"], label: input["label"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      connectOauth: (input: IntegrationsConnectOauthInput, requestOptions?: RequestOptions) =>
        request<IntegrationsConnectOauthOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth`,
            query: { location: input["location"] },
            body: { methodID: input["methodID"], inputs: input["inputs"], label: input["label"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      attemptStatus: (input: IntegrationsAttemptStatusInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptStatusOutput>(
          {
            method: "GET",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      attemptComplete: (input: IntegrationsAttemptCompleteInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptCompleteOutput>(
          {
            method: "POST",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}/complete`,
            query: { location: input["location"] },
            body: { code: input["code"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      attemptCancel: (input: IntegrationsAttemptCancelInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptCancelOutput>(
          {
            method: "DELETE",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    credentials: {
      update: (input: CredentialsUpdateInput, requestOptions?: RequestOptions) =>
        request<CredentialsUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            query: { location: input["location"] },
            body: { label: input["label"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
      remove: (input: CredentialsRemoveInput, requestOptions?: RequestOptions) =>
        request<CredentialsRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    permissions: {
      listRequests: (input?: PermissionsListRequestsInput, requestOptions?: RequestOptions) =>
        request<PermissionsListRequestsOutput>(
          {
            method: "GET",
            path: `/api/permission/request`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      listSaved: (input?: PermissionsListSavedInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsListSavedOutput }>(
          {
            method: "GET",
            path: `/api/permission/saved`,
            query: { projectID: input?.["projectID"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      removeSaved: (input: PermissionsRemoveSavedInput, requestOptions?: RequestOptions) =>
        request<PermissionsRemoveSavedOutput>(
          {
            method: "DELETE",
            path: `/api/permission/saved/${encodeURIComponent(input.id)}`,
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
      create: (input: PermissionsCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsCreateOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            body: {
              id: input["id"],
              action: input["action"],
              resources: input["resources"],
              save: input["save"],
              metadata: input["metadata"],
              source: input["source"],
              agent: input["agent"],
            },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      list: (input: PermissionsListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: PermissionsGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: PermissionsReplyInput, requestOptions?: RequestOptions) =>
        request<PermissionsReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}/reply`,
            body: { reply: input["reply"], message: input["message"], save: input["save"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    files: {
      list: (input?: FilesListInput, requestOptions?: RequestOptions) =>
        request<FilesListOutput>(
          {
            method: "GET",
            path: `/api/fs/list`,
            query: { location: input?.["location"], path: input?.["path"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      find: (input: FilesFindInput, requestOptions?: RequestOptions) =>
        request<FilesFindOutput>(
          {
            method: "GET",
            path: `/api/fs/find`,
            query: { location: input["location"], query: input["query"], type: input["type"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    commands: {
      list: (input?: CommandsListInput, requestOptions?: RequestOptions) =>
        request<CommandsListOutput>(
          {
            method: "GET",
            path: `/api/command`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    skills: {
      list: (input?: SkillsListInput, requestOptions?: RequestOptions) =>
        request<SkillsListOutput>(
          {
            method: "GET",
            path: `/api/skill`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      reload: (input?: SkillsReloadInput, requestOptions?: RequestOptions) =>
        request<SkillsReloadOutput>(
          {
            method: "POST",
            path: `/api/skill/reload`,
            query: { location: input?.["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    events: {
      subscribe: (requestOptions?: RequestOptions): AsyncIterable<EventsSubscribeOutput> =>
        sse<EventsSubscribeOutput>(
          { method: "GET", path: `/api/event`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    ptys: {
      list: (input?: PtysListInput, requestOptions?: RequestOptions) =>
        request<PtysListOutput>(
          {
            method: "GET",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: PtysCreateInput, requestOptions?: RequestOptions) =>
        request<PtysCreateOutput>(
          {
            method: "POST",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            body: {
              command: input?.["command"],
              args: input?.["args"],
              cwd: input?.["cwd"],
              title: input?.["title"],
              env: input?.["env"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: PtysGetInput, requestOptions?: RequestOptions) =>
        request<PtysGetOutput>(
          {
            method: "GET",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: PtysUpdateInput, requestOptions?: RequestOptions) =>
        request<PtysUpdateOutput>(
          {
            method: "PUT",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            body: { title: input["title"], size: input["size"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: PtysRemoveInput, requestOptions?: RequestOptions) =>
        request<PtysRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [404, 401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    questions: {
      listRequests: (input?: QuestionsListRequestsInput, requestOptions?: RequestOptions) =>
        request<QuestionsListRequestsOutput>(
          {
            method: "GET",
            path: `/api/question/request`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      list: (input: QuestionsListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: QuestionsListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question`,
            successStatus: 200,
            declaredStatuses: [404, 503, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: QuestionsReplyInput, requestOptions?: RequestOptions) =>
        request<QuestionsReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reply`,
            body: { answers: input["answers"] },
            successStatus: 204,
            declaredStatuses: [404, 409, 403, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      reject: (input: QuestionsRejectInput, requestOptions?: RequestOptions) =>
        request<QuestionsRejectOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reject`,
            successStatus: 204,
            declaredStatuses: [404, 409, 403, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    references: {
      list: (input?: ReferencesListInput, requestOptions?: RequestOptions) =>
        request<ReferencesListOutput>(
          {
            method: "GET",
            path: `/api/reference`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    projectCopies: {
      create: (input: ProjectCopiesCreateInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesCreateOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
            query: { location: input["location"] },
            body: { strategy: input["strategy"], directory: input["directory"], name: input["name"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ProjectCopiesRemoveInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesRemoveOutput>(
          {
            method: "DELETE",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
            query: { location: input["location"] },
            body: { directory: input["directory"], force: input["force"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      refresh: (input: ProjectCopiesRefreshInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesRefreshOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy/refresh`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
  }
}

function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(params, key, item)
    return
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendQuery(params, `${key}[${child}]`, item)
    return
  }
  params.append(key, String(value))
}

async function json(response: Response): Promise<unknown> {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnsupportedContentType")
  }
  let text: string
  try {
    text = await response.text()
  } catch (cause) {
    throw new ClientError("Transport", { cause })
  }
  if (text === "") throw new ClientError("MalformedResponse")
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ClientError("MalformedResponse", { cause })
  }
}

function isContentType(response: Response, expected: string) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected
}
