import { SessionMemoryObserver } from "../memory-observer"
import { SessionScheduleRuntime } from "../schedule"
import { SessionInputExecution } from "../input-execution"
import { SessionInputExecutionOwner } from "../input-execution-owner"
import { SessionExecutionPolicy } from "../execution-policy"
import { SessionLifecycle } from "../lifecycle"
import { SessionPlanReceipt } from "../plan-receipt"
import { SessionPlan } from "../plan"
import { SessionManagedChild } from "../managed-child"
import { SessionTaskMessage } from "../task-message"
import { SessionTaskRole } from "../task-role"
import { SessionTaskStore } from "../task-store"
import {
  LLM,
  LLMClient,
  LLMError,
  LLMEvent,
  Message,
  SystemPart,
  isContextOverflowFailure,
  type ProviderErrorEvent,
} from "@apexo/llm"
import { eq } from "drizzle-orm"
import { SessionTable } from "../sql"
import { SessionGoal } from "../goal"
import { SessionGoalRole } from "../goal-role"
import { SessionGoalSummaryRole } from "../goal-summary-role"
import { SessionGoalRunner } from "../goal-runner"
import { SessionGoalUsage } from "../goal-usage"
import { SessionGoalCleanup } from "../goal-cleanup"
import { SessionHookStop } from "../hook-stop"
import { WorkflowRole } from "../../workflow/role"
import { WorkflowRuntime } from "../../workflow/runtime"
import { Cause, Context, DateTime, Effect, FiberSet, Layer, Option, Semaphore, Stream } from "effect"
import { AgentV2 } from "../../agent"
import { Config } from "../../config"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { ModelV2 } from "../../model"
import { PermissionV2 } from "../../permission"
import { ProviderV2 } from "../../provider"
import { QuestionV2 } from "../../question"
import { SystemContext } from "../../system-context/index"
import { HookSnapshotLocation } from "../../hook-snapshot-location"
import { MemoryNative } from "../../memory-native"
import { MemoryContextNative } from "../../memory-context-native"
import { SystemContextRegistry } from "../../system-context/registry"
import { SkillGuidance } from "../../skill/guidance"
import { ReferenceGuidance } from "../../reference/guidance"
import { ToolRegistry } from "../../tool/registry"
import { ToolOutputStore } from "../../tool-output-store"
import { SessionContextEpoch } from "../context-epoch"
import { SessionProcessCompletion } from "../process-completion"
import { SessionTaskCompletion } from "../task-completion"
import { SessionCompaction } from "../compaction"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionHistoryCopy } from "../history-copy"
import { SessionInput } from "../input"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionRunner, type RunError, Service } from "./index"
import { SessionRunnerModel } from "./model"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"

/**
 * Runs one durable coding-agent Session until it settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Coordinate one local active drain per Session; explicit resumes join and prompt wakeups coalesce.
 *   - [ ] Replace local ownership with durable multi-node ownership when clustered.
 *   - [ ] Mark busy, retrying, idle, interrupted, or terminal-failure status durably.
 *   - [ ] Honor interruption and reject stale work after runtime attachment replacement.
 *   - [x] Honor optional agent step limits.
 *   - [ ] Bound provider retries and repeated identical tool calls.
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in `specs/v2/session.md`.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@apexo/llm` messages.
 *   - [ ] Resolve policy-filtered built-in, MCP, plugin, and structured-output tool definitions.
 *   - [x] Stream exactly one `llm.stream(request)` provider turn.
 *   - [x] Persist assistant text and usage events incrementally as they arrive.
 *   - [ ] Persist snapshots, patches, and retry notices incrementally as they arrive.
 *   - [x] Persist reasoning, provider errors, and tool-call events incrementally as they arrive.
 *
 * - Tool settlement and continuation
 *   - [x] Durably record each tool call before side effects begin.
 *   - [x] Authorize and execute recorded local calls through a core-owned registry hook.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [x] Start each recorded local call eagerly and await all settlements before continuation.
 *   - [ ] Add scoped runtime context, progress updates, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit provider turn after local tool results.
 *   - [x] Continue for durable user steering accepted during an active provider turn.
 *   - [ ] Continue for compaction or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here.
 * Durable continuation recovery remains a separate future slice with an explicit retry policy.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and an
 * explicit loop starts the next provider turn after local settlement. Configured agent step limits bound the loop.
 */

// A durable ready row is evidence, not permission to restart a continuation after a drain closes.
const CompletionAdmission = Context.Reference<boolean>("@apexo/CompletionAdmission", { defaultValue: () => false })

const StopContinuation = Context.Reference<string | undefined>("@apexo/StopContinuation", {
  defaultValue: () => undefined,
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const inputExecutions = yield* SessionInputExecution.Service
    const plans = yield* SessionPlan.Service
    const planReceipts = yield* SessionPlanReceipt.Service
    const taskRoles = yield* SessionTaskRole.Service
    const taskMessages = yield* SessionTaskMessage.Service
    const scheduleRuntime = yield* SessionScheduleRuntime.Service
    const taskStore = yield* SessionTaskStore.Service
    const taskCompletions = yield* SessionTaskCompletion.Service
    const processCompletions = yield* SessionProcessCompletion.Service
    const managedChildren = yield* SessionManagedChild.Service
    const goals = yield* SessionGoal.Service
    const goalRunner = yield* SessionGoalRunner.Service
    const goalRoles = yield* SessionGoalRole.Service
    const summaryRoles = yield* SessionGoalSummaryRole.Service
    const goalCleanup = yield* SessionGoalCleanup.Service
    const workflowRoles = yield* WorkflowRole.Service
    const workflows = yield* WorkflowRuntime.Service
    const permission = yield* PermissionV2.Service
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const systemContext = yield* SystemContextRegistry.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const memory = yield* MemoryNative.Service
    const memoryContext = yield* MemoryContextNative.Service
    const hookSnapshot = yield* HookSnapshotLocation.Service
    const config = yield* Config.Service
    const snapshots = yield* Snapshot.Service
    const db = (yield* Database.Service).db
    const headlessUsage = <E>(source: () => Stream.Stream<LLMEvent, E>) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const observers = [...(yield* SessionInputExecutionOwner.Observers).values()]
          const call = {}
          for (const observe of observers) observe(call, false)
          return source().pipe(
            Stream.tap((event) =>
              Effect.sync(() => {
                if (
                  (event.type === "step-finish" || event.type === "finish") &&
                  event.usage &&
                  SessionGoalUsage.tokens(event.usage) !== undefined
                )
                  for (const observe of observers) observe(call, true)
              }),
            ),
          )
        }),
      )
    const compaction = SessionCompaction.make({
      events,
      hooks: hookSnapshot,
      before: (boundary) =>
        SessionMemoryObserver.checkpoint(boundary.sessionID).pipe(
          Effect.andThen(SessionMemoryObserver.beforeCompaction(boundary)),
          Effect.catch(() => Effect.void),
        ),
      config: yield* config.entries(),
      llm: {
        stream: (request, sessionID) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const role = goalRoles.get(sessionID)
              const workflowRole = workflowRoles.get(sessionID)
              const attempt = role?.attempt ?? taskRoles.get(sessionID)?.attempt ?? (yield* SessionGoalUsage.Current)
              const source = attempt
                ? SessionGoalUsage.track(goals, attempt, () => llm.stream(request))
                : headlessUsage(() => llm.stream(request))
              return (workflowRole ? WorkflowRole.track(workflowRole, source) : source).pipe(
                Stream.provideService(
                  SessionGoalUsage.Observer,
                  role?.observe ?? taskRoles.get(sessionID)?.observe ?? (yield* SessionGoalUsage.Observer),
                ),
              )
            }),
          ),
      },
    })
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      const taskRole = taskRoles.get(sessionID)
      return taskRole ? { ...session, agent: taskRole.record.agent, model: taskRole.record.model } : session
    })

    const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
      return yield* store.context(sessionID)
    })
    const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* getContext(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID,
            timestamp: yield* DateTime.now,
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "unknown", message: "Tool execution interrupted" },
            provider: {
              executed: tool.provider?.executed === true,
              ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
            },
          })
        }
      }
    })

    const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
      Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

    // Match V1: declining a user prompt halts the loop instead of becoming model-facing tool output.
    const isUserDeclined = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some(
        (reason) =>
          Cause.isDieReason(reason) &&
          (reason.defect instanceof PermissionV2.DeclinedError ||
            reason.defect instanceof QuestionV2.RejectedError ||
            reason.defect instanceof SessionPlan.RejectedError),
      )

    type TurnTransition =
      // Automatic compaction completed; rebuild the request from compacted history.
      | { readonly _tag: "ContinueAfterCompaction"; readonly step: number }
      // Overflow compaction completed; rebuild once through the path without overflow recovery.
      | { readonly _tag: "ContinueAfterOverflowCompaction"; readonly step: number }

    class TurnTransitionError extends Error {
      constructor(readonly transition: TurnTransition) {
        super()
      }
    }

    const continueAfterCompaction = (step: number) => new TurnTransitionError({ _tag: "ContinueAfterCompaction", step })
    const continueAfterOverflowCompaction = (step: number) =>
      new TurnTransitionError({ _tag: "ContinueAfterOverflowCompaction", step })

    const loadSystemContext = (
      sessionID: SessionSchema.ID,
      agent: AgentV2.Selection,
      stop: SystemContext.SystemContext,
    ) =>
      Effect.all(
        [
          systemContext.load(),
          skillGuidance.load(agent),
          referenceGuidance.load(),
          memoryContext.load(sessionID, agent.id),
          Effect.succeed(stop),
          SessionTaskCompletion.Current.pipe(Effect.map(SessionTaskCompletion.context)),
          SessionProcessCompletion.Current.pipe(Effect.map(SessionProcessCompletion.context)),
        ],
        {
          concurrency: "unbounded",
        },
      ).pipe(Effect.map(SystemContext.combine))

    const runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      recoverOverflow?: typeof compaction.compactAfterOverflow,
    ) {
      const session = yield* getSession(sessionID)
      const role = goalRoles.get(sessionID)
      const summaryRole = summaryRoles.get(sessionID)
      const workflowRole = workflowRoles.get(sessionID)
      const attempt = role?.attempt ?? taskRoles.get(sessionID)?.attempt ?? (yield* SessionGoalUsage.Current)
      if (summaryRole) yield* goals.checkSummary(summaryRole.attempt)
      const goal = attempt ? yield* goals.check(attempt) : undefined
      if (goal && goal.status !== "active") return yield* Effect.interrupt
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(session.agent)
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      let needsContinuation = false
      let currentStep = step
      let promoted = 0
      const taskRole = taskRoles.get(sessionID)
      const ownedRole = taskRole ?? role ?? summaryRole ?? workflowRole
      const plan = agent.id === "plan" && !ownedRole && !attempt ? yield* plans.context(sessionID) : undefined
      const inherited = yield* PermissionV2.Inherited
      const authority = plan
        ? new Map(inherited).set(sessionID, [...(inherited.get(sessionID) ?? []), plan.authority])
        : inherited
      const transitions: Effect.Effect<void, ToolOutputStore.Error>[] = []
      if (promotion && !ownedRole && (attempt || plan || agent.id === "plan")) {
        for (const target of yield* inputExecutions.pending(sessionID))
          yield* inputExecutions.settle({ ...target, status: "failed", reason: "unavailable", usageIncomplete: false })
      }
      if (promotion && ownedRole) {
        promoted = yield* SessionInput.promoteOwned(db, events, session.id, ownedRole.inputID)
        if (taskRole?.launchID) {
          const launch = yield* taskStore.launch(taskRole.launchID)
          if (launch?.request.activeMessages) promoted += yield* taskMessages.promote(taskRole.launchID, promotion)
        }
        if (promoted > 0) currentStep = 1
      }
      if (promotion && !ownedRole) {
        const cutoff = yield* EventV2.latestSequence(db, session.id)
        if (promotion === "steer") promoted = yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        }
        if (promoted > 0) currentStep = 1
      }
      const selected = yield* inputExecutions.selected(sessionID)
      const execution = yield* inputExecutions.current(sessionID)
      if (selected && !execution)
        return yield* new SessionInputExecution.Failure({
          code: "conflict",
          message: "Headless input is settled; submit a new input to continue",
        })
      if (execution) {
        const claim = yield* SessionLifecycle.current(sessionID)
        const active =
          promoted > 0
            ? yield* SessionInputExecutionOwner.activate(sessionID, execution.inputID)
            : claim && SessionInputExecutionOwner.predicate(claim, execution.inputID)?.()
        if (!active)
          return yield* new SessionInputExecution.Failure({
            code: "conflict",
            message: "Headless input has no live continuation; submit a new input",
          })
      }
      yield* SessionExecutionPolicy.select(sessionID, execution?.policy)
      if (
        !execution &&
        !ownedRole &&
        !attempt &&
        (yield* SessionRunner.CurrentChildren) &&
        (yield* goals.get(sessionID))?.status !== "active"
      )
        yield* scheduleRuntime.bind(sessionID)
      if (!execution) yield* SessionInputExecutionOwner.release(sessionID)
      yield* SessionInputExecutionOwner.observe(sessionID)
      const admitCompletion =
        !execution && (!ownedRole || Boolean(taskRole)) && !attempt && (yield* CompletionAdmission)
      const completion = admitCompletion ? yield* taskCompletions.take(sessionID) : ""
      const processCompletion = admitCompletion && !ownedRole ? yield* processCompletions.take(sessionID) : ""
      const monitorEvents = !execution && !ownedRole && !attempt ? yield* processCompletions.takeEvents(sessionID) : ""
      return yield* SessionExecutionPolicy.provide(
        sessionID,
        execution?.policy,
        Effect.gen(function* () {
          const initialized = yield* SessionContextEpoch.initialize(
            db,
            loadSystemContext(session.id, agent, SessionHookStop.context("")),
            session.id,
          )
          if (promoted > 0 && !ownedRole && !attempt && !execution) yield* processCompletions.rearm(session.id)
          const stopToken = yield* StopContinuation
          const stop =
            !promoted && stopToken && process.env.APEXO_RUNTIME_PROFILE === "grok-build"
              ? yield* SessionHookStop.load(db, session.id)
              : undefined
          const stopContext = stop?.messageID === stopToken && stop?.engine === "v2" ? stop : undefined
          const system =
            initialized ??
            (yield* SessionContextEpoch.prepare(
              db,
              events,
              loadSystemContext(session.id, agent, stopContext?.context ?? SessionHookStop.context("")),
              session.id,
            ))
          if (stopContext?.messageID && stopContext.engine)
            yield* SessionHookStop.consume(db, session.id, stopContext.messageID, stopContext.engine)
          const model = yield* models.resolve(session).pipe(
            Effect.tapError((error) => {
              if (summaryRole) return Effect.void
              const fallbackModel = session.model ?? {
                id: ModelV2.ID.make("unknown"),
                providerID: ProviderV2.ID.make("unknown"),
              }
              const publisher = createLLMEventPublisher(events, {
                sessionID: session.id,
                agent: agent.id,
                model: fallbackModel,
              })
              return publisher.failAssistant(error.message).pipe(Effect.ensuring(publisher.flush()))
            }),
          )
          const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
          const context = entries.map((entry) => entry.message)
          const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
          const baseTools =
            isLastStep || summaryRole
              ? undefined
              : yield* tools
                  .materialize(agent.info?.permissions)
                  .pipe(Effect.flatMap((value) => memory.materialize(session.id, value)))
          const goalTools =
            role && baseTools ? SessionGoalRole.materialize(role, baseTools, goals, permission) : baseTools
          const managedTools = workflowRole && goalTools ? WorkflowRole.materialize(workflowRole, goalTools) : goalTools
          const roleTools =
            taskRole && managedTools
              ? SessionTaskRole.materialize(
                  managedTools,
                  taskRole.scheduledLaunchID !== undefined,
                  taskRole.record.delegation,
                  taskRole.record.sourcePolicy,
                )
              : managedTools
          const plannedTools = plan && roleTools ? SessionPlan.materialize(roleTools) : roleTools
          const toolMaterialization =
            execution && plannedTools ? SessionExecutionPolicy.materialize(plannedTools) : plannedTools
          const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
          const systemParts = [
            agent.info?.system,
            system.baseline,
            plan?.system,
            summaryRole?.system ?? role?.system ?? (goal ? SessionGoalRunner.system(goal) : undefined),
          ]
            .filter((part): part is string => part !== undefined && part.length > 0)
            .map(SystemPart.make)
          const llmMessages = [
            ...(yield* Effect.fromResult(toLLMMessages(context, model))),
            ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : []),
          ]
          const llmTools = toolMaterialization?.definitions ?? []
          const activeGoal = attempt ? yield* goals.get(attempt.sessionID) : undefined
          const baseURL = typeof model.route.endpoint.baseURL === "string" ? model.route.endpoint.baseURL : undefined
          const isSyntheticTestProvider = Boolean(
            baseURL && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(baseURL),
          )
          const promptChars =
            systemParts.reduce((sum, part) => sum + part.text.length, 0) +
            JSON.stringify(llmMessages).length +
            (llmTools.length > 0 ? JSON.stringify(llmTools).length : 0)
          const estimatedInputTokens = isSyntheticTestProvider ? 0 : Math.ceil(promptChars / 3.5)
          const remainingGoalBudget =
            activeGoal?.tokenBudget !== undefined
              ? Math.max(0, activeGoal.tokenBudget - activeGoal.tokensUsed)
              : undefined
          if (
            attempt &&
            remainingGoalBudget !== undefined &&
            !isSyntheticTestProvider &&
            remainingGoalBudget < estimatedInputTokens + 16
          ) {
            yield* goals.budgetLimit(
              attempt,
              `Token budget exhausted: remaining budget (${remainingGoalBudget} tokens) is smaller than the minimum prompt context (~${estimatedInputTokens} tokens) required for this turn`,
            )
            return yield* new SessionGoal.Conflict({ code: "budget", message: "Goal token budget is exhausted" })
          }
          const remainingGoalTokens =
            remainingGoalBudget !== undefined
              ? Math.min(32_000, Math.max(1, remainingGoalBudget - estimatedInputTokens))
              : undefined
          const request = LLM.request({
            model,
            ...(remainingGoalTokens !== undefined ? { generation: { maxTokens: remainingGoalTokens } } : {}),
            http: {
              headers: {
                "x-apexo-session-id": session.id,
                ...(session.parentID ? { "x-apexo-parent-session-id": session.parentID } : {}),
                "x-session-affinity": session.id,
                "x-grok-conv-id": session.id,
                "X-Session-Id": session.id,
                ...(session.parentID ? { "x-parent-session-id": session.parentID } : {}),
              },
            },
            providerOptions: {
              openai: { promptCacheKey },
              xai: { promptCacheKey },
            },
            system: systemParts,
            messages: llmMessages,
            tools: llmTools,
            toolChoice: isLastStep || summaryRole ? "none" : undefined,
          })
          if (!summaryRole && (yield* compaction.compactIfNeeded({ sessionID: session.id, entries, model, request })))
            return yield* Effect.die(continueAfterCompaction(currentStep))
          const startSnapshot = yield* snapshots.capture()
          const publisher = createLLMEventPublisher(events, {
            sessionID: session.id,
            agent: agent.id,
            model: {
              id: ModelV2.ID.make(model.id),
              providerID: ProviderV2.ID.make(model.provider),
              ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
            },
            snapshot: startSnapshot,
          })
          const withPublication = Semaphore.makeUnsafe(1).withPermit
          const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = []) =>
            withPublication(publisher.publish(event, outputPaths))
          let overflowFailure: ProviderErrorEvent | undefined
          const transport = () => llm.stream(request)
          const source = summaryRole
            ? SessionGoalUsage.trackTerminal(goals, summaryRole.attempt, transport)
            : attempt
              ? SessionGoalUsage.track(goals, attempt, transport)
              : headlessUsage(transport)
          const providerStream = (workflowRole ? WorkflowRole.track(workflowRole, source) : source).pipe(
            Stream.provideService(SessionGoalUsage.Observer, role?.observe ?? taskRoles.get(sessionID)?.observe),
            Stream.runForEach((event) =>
              Effect.gen(function* () {
                summaryRole?.observe(event)
                if (overflowFailure || publisher.hasProviderError()) return
                if (LLMEvent.is.providerError(event)) {
                  if (isContextOverflowFailure(event) && !publisher.hasAssistantStarted()) {
                    overflowFailure = event
                    return
                  }
                }
                yield* publish(event)
                if (event.type !== "tool-call" || event.providerExecuted) return
                if (!toolMaterialization) {
                  yield* withPublication(
                    publisher.failUnsettledTools("Tools are disabled after the maximum agent steps"),
                  )
                  return
                }
                needsContinuation = true
                const assistantMessageID = yield* publisher.assistantMessageID(event.id)
                const execute = Effect.uninterruptibleMask((restore) =>
                  restore(
                    toolMaterialization.settle({
                      sessionID: session.id,
                      agent: agent.id,
                      assistantMessageID,
                      call: event,
                    }),
                  ).pipe(
                    Effect.flatMap((settlement) =>
                      publish(
                        LLMEvent.toolResult({
                          id: event.id,
                          name: event.name,
                          result: settlement.result,
                          output: settlement.output,
                        }),
                        settlement.outputPaths ?? [],
                      ),
                    ),
                  ),
                ).pipe(Effect.provideService(PermissionV2.Inherited, authority))
                // A mode transition sees the complete provider batch and settled ordinary tools.
                if (SessionPlan.transition(event.name)) {
                  transitions.push(execute)
                  return
                }
                yield* execute.pipe(FiberSet.run(toolFibers))
              }),
            ),
            Effect.ensuring(withPublication(publisher.flush())),
          )

          return yield* Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const stream = yield* restore(providerStream).pipe(Effect.exit)
              const failure =
                stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
              if (
                !summaryRole &&
                recoverOverflow &&
                !publisher.hasAssistantStarted() &&
                isContextOverflowFailure(overflowFailure ?? failure) &&
                (yield* restore(recoverOverflow({ sessionID: session.id, entries, model, request })))
              )
                return yield* Effect.die(continueAfterOverflowCompaction(currentStep))
              if (overflowFailure) yield* publish(overflowFailure)
              const llmFailure = failure instanceof LLMError ? failure : undefined
              if (llmFailure && !publisher.hasProviderError()) {
                yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
                yield* withPublication(publisher.failAssistant(llmFailure.reason.message))
              }
              if (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) yield* FiberSet.clear(toolFibers)
              const ordinary = yield* restore(awaitToolFibers(toolFibers)).pipe(Effect.exit)
              const settled =
                ordinary._tag === "Success" && stream._tag === "Success" && !publisher.hasProviderError()
                  ? yield* restore(
                      Effect.forEach(transitions, (execute) => execute, { discard: true }).pipe(
                        Effect.provideService(SessionPlanReceipt.CurrentTurn, publisher.stepSettlement()),
                      ),
                    ).pipe(Effect.exit)
                  : ordinary
              if (settled._tag === "Failure" && isUserDeclined(settled.cause)) {
                yield* FiberSet.clear(toolFibers)
                yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
                return yield* Effect.interrupt
              }
              if (
                (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
                (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
              ) {
                yield* FiberSet.clear(toolFibers)
                yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
                if (publisher.hasActiveAssistant())
                  yield* withPublication(publisher.failAssistant("Provider turn interrupted"))
                // Cancellation only preserves a settled source. It never starts an auxiliary provider.
                if (publisher.hasAssistantStarted())
                  yield* SessionMemoryObserver.capture(session.id, yield* publisher.startAssistant(), false).pipe(
                    Effect.catch(() => Effect.void),
                  )
              }
              if (settled._tag === "Failure" && !Cause.hasInterrupts(settled.cause)) {
                const failure = Cause.squash(settled.cause)
                const message = failure instanceof Error ? failure.message : String(failure)
                yield* withPublication(publisher.failUnsettledTools(`Tool execution failed: ${message}`))
              }
              const stepSettlement = publisher.stepSettlement()
              if (stepSettlement && !publisher.hasProviderError()) {
                const endSnapshot = yield* snapshots.capture()
                const files =
                  startSnapshot && endSnapshot
                    ? yield* snapshots
                        .files({ from: startSnapshot, to: endSnapshot })
                        .pipe(Effect.catch(() => Effect.succeed(undefined)))
                    : undefined
                const assistantMessageID = yield* publisher.startAssistant()
                yield* withPublication(
                  events.publish(
                    SessionEvent.Step.Ended,
                    {
                      sessionID: session.id,
                      timestamp: yield* DateTime.now,
                      assistantMessageID,
                      finish: stepSettlement.finish,
                      cost: 0,
                      tokens: stepSettlement.tokens,
                      snapshot: endSnapshot,
                      files,
                    },
                    { commit: () => plans.settled(session.id, assistantMessageID).pipe(Effect.orDie) },
                  ),
                )
              }
              if (publisher.hasProviderError())
                yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
              if (stream._tag === "Success" && !publisher.hasProviderError())
                yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
              if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
              if (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
                return yield* Effect.failCause(settled.cause)
              return {
                needsContinuation: !publisher.hasProviderError() && needsContinuation,
                step: currentStep,
                failed: publisher.hasProviderError() || (execution !== undefined && !stepSettlement),
                normalStop: !isLastStep && stepSettlement?.finish === "stop",
                finish: stepSettlement?.finish,
                turnLimit: isLastStep,
                usageIncomplete: !stepSettlement,
              }
            }),
          )
        }).pipe(
          Effect.provideService(SessionTaskCompletion.Current, completion),
          Effect.provideService(
            SessionProcessCompletion.Current,
            [processCompletion, monitorEvents].filter(Boolean).join("\n"),
          ),
        ),
      )
    }, Effect.scoped)
    type RunTurn = (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
    ) => Effect.Effect<
      {
        readonly needsContinuation: boolean
        readonly step: number
        readonly failed: boolean
        readonly normalStop: boolean
        readonly finish?: string
        readonly turnLimit: boolean
        readonly usageIncomplete: boolean
      },
      RunError
    >

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step) {
      return yield* runTurnAttempt(sessionID, promotion, step).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* Effect.die("Post-compaction provider attempt cannot recover another overflow")
            yield* Effect.yieldNow
            return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step)
          }),
        ),
      )
    })

    const runTurn: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step) {
      return yield* runTurnAttempt(sessionID, promotion, step, compaction.compactAfterOverflow).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            yield* Effect.yieldNow
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step)
            return yield* runTurn(sessionID, undefined, defect.transition.step)
          }),
        ),
      )
    })

    const settleInput = Effect.fn("SessionRunner.settleInput")(function* (
      sessionID: SessionSchema.ID,
      status: "completed" | "failed" | "interrupted",
      reason: SessionInput.ExecutionReason,
      finish?: string,
      usageIncomplete = true,
    ) {
      const target = yield* inputExecutions.current(sessionID)
      if (!target) return
      yield* inputExecutions.settle({
        ...target,
        status,
        reason,
        finish,
        usageIncomplete: yield* SessionInputExecutionOwner.incomplete(sessionID),
      })
    })

    const drain = Effect.fn("SessionRunner.run")(
      function* (input: {
        readonly sessionID: SessionSchema.ID
        readonly force: boolean
        readonly children?: import("./index").Children
        readonly controls?: Effect.Effect<void>
      }) {
        yield* SessionHistoryCopy.assertReady(db, input.sessionID)
        const taskRecord = yield* taskStore.read(input.sessionID)
        const taskRole = yield* taskRoles.live(input.sessionID)
        if (taskRecord && (!taskRole || !taskRole.take())) return
        if (taskRecord) yield* taskStore.owned(taskRecord.parentID, input.sessionID)
        const record = yield* managedChildren.read(input.sessionID)
        const summaryRole = summaryRoles.get(input.sessionID)
        const goalRole = goalRoles.get(input.sessionID)
        const workflowRole = workflowRoles.get(input.sessionID)
        const managedRole =
          record?.owner.kind === "workflow"
            ? workflowRole
            : record?.owner.kind === "goal" && record.owner.role === "summary"
              ? summaryRole
              : goalRole
        if (record) {
          if (!managedRole || !SessionManagedChild.same(record, managedRole.owner))
            return yield* new SessionManagedChild.Failure({
              code: "stale",
              message: "Managed child requires its owning Workflow run or Goal attempt",
            })
          if (!managedRole.take()) return
        } else if (
          goalRole ||
          summaryRole ||
          workflowRole ||
          (yield* SessionManagedChild.historical(db, input.sessionID))
        ) {
          return yield* new SessionManagedChild.Failure({
            code: "missing",
            message: "Child has no private ownership; start a new Workflow run or Goal attempt",
          })
        }
        const ownedRole = taskRole ?? managedRole
        yield* hookSnapshot.capture(input.sessionID)
        yield* input.controls ?? Effect.void
        const pendingHeadless = yield* inputExecutions.pending(input.sessionID)
        if (pendingHeadless.length) {
          const session = yield* getSession(input.sessionID)
          const activeGoal = yield* goals.get(input.sessionID)
          const workflow = yield* workflows.pending(input.sessionID)
          if (
            session.agent === "plan" ||
            activeGoal?.status === "active" ||
            workflow ||
            (yield* plans.blocked(input.sessionID))
          ) {
            for (const target of pendingHeadless)
              yield* inputExecutions.settle({
                ...target,
                status: "failed",
                reason: "unavailable",
                usageIncomplete: false,
              })
            if (
              !(yield* SessionInput.hasPending(db, input.sessionID, "steer")) &&
              !(yield* SessionInput.hasPending(db, input.sessionID, "queue"))
            )
              return
          }
        }
        const ownedInput = ownedRole ? yield* SessionInput.find(db, ownedRole.inputID) : undefined
        const hasSteer = ownedRole
          ? ownedInput !== undefined && ownedInput.promotedSeq === undefined
          : yield* SessionInput.hasPending(db, input.sessionID, "steer")
        const hasQueue = ownedRole || hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
        if (!hasSteer && !hasQueue && (yield* inputExecutions.selected(input.sessionID))) {
          if (!input.force) return
          return yield* new SessionInputExecution.Failure({
            code: "conflict",
            message: "Headless continuation requires a newly admitted input",
          })
        }
        if (input.force && !ownedRole) {
          const workflow = yield* workflows.pending(input.sessionID)
          if (workflow) {
            yield* workflows.execute(input.sessionID, workflow.id)
            const pending = yield* SessionInput.hasPending(db, input.sessionID, "steer")
            if (!pending && !(yield* SessionInput.hasPending(db, input.sessionID, "queue"))) return
          }
        }
        const hasCompletion =
          !ownedRole &&
          ((yield* taskCompletions.pending(input.sessionID)) || (yield* processCompletions.pending(input.sessionID)))
        const hasPlanDecision = !ownedRole && (yield* planReceipts.ready(input.sessionID))
        if (!input.force && !hasSteer && !hasQueue && !hasCompletion && !hasPlanDecision) return
        if (!ownedRole && !(yield* plans.reconcile(input.sessionID))) return
        yield* failInterruptedTools(input.sessionID)
        const currentGoal = ownedRole ? undefined : yield* goals.get(input.sessionID)
        if (currentGoal?.status === "active" && currentGoal.phase !== "idle") {
          yield* goals.recover({ sessionID: input.sessionID, goalID: currentGoal.id }, currentGoal.revision)
          return
        }
        let goal = ownedRole ? undefined : yield* goalRunner.open(input.sessionID, input.children)
        let promotion: SessionInput.Delivery | undefined = hasSteer
          ? taskRole && ownedInput?.delivery === "queue"
            ? "queue"
            : "steer"
          : hasQueue
            ? "queue"
            : undefined
        if (goal && promotion === "steer") {
          const cutoff = yield* EventV2.latestSequence(db, input.sessionID)
          yield* SessionInput.promoteSteers(db, events, input.sessionID, cutoff)
          promotion = undefined
        }
        if (goal && promotion === "queue") promotion = undefined
        let shouldRun = input.force || hasSteer || hasQueue || hasCompletion || hasPlanDecision
        let stopContinuations = 0
        let stopUserID: string | undefined
        let stopMessageID: string | undefined
        while (shouldRun) {
          const attempt = goal ? yield* goal.prepare() : undefined
          if (goal && !attempt) {
            goal = undefined
            const steer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
            shouldRun = steer || (yield* SessionInput.hasPending(db, input.sessionID, "queue"))
            promotion = steer ? "steer" : shouldRun ? "queue" : undefined
            continue
          }
          if (!goal && !ownedRole && !(yield* plans.reconcile(input.sessionID))) return
          // Only the first turn in this continuation may consume a ready notice, after input policy is selected.
          let admitCompletion = !goal && (!ownedRole || Boolean(taskRole))
          let needsContinuation = true
          let step = 1
          while (needsContinuation) {
            if (!goal && !ownedRole && !(yield* plans.reconcile(input.sessionID))) return
            const result = yield* (input.controls ?? Effect.void).pipe(
              Effect.andThen(runTurn(input.sessionID, promotion, step)),
              Effect.tap(() => input.controls ?? Effect.void),
              Effect.provideService(StopContinuation, stopMessageID),
              Effect.provideService(CompletionAdmission, admitCompletion),
              Effect.provideService(
                SessionGoalUsage.Current,
                goalRoles.get(input.sessionID)?.attempt ?? taskRole?.attempt ?? attempt,
              ),
              Effect.provideService(
                SessionGoalUsage.Observer,
                goalRoles.get(input.sessionID)?.observe ?? taskRole?.observe,
              ),
            )
            admitCompletion = false
            stopMessageID = undefined
            if (summaryRole) return
            if (result.failed) {
              yield* settleInput(input.sessionID, "failed", "provider_error", result.finish, result.usageIncomplete)
              if (goal) yield* goal.finish("Provider failed during Goal execution")
              if (goalRoles.get(input.sessionID))
                return yield* new SessionGoal.Conflict({ code: "invalid", message: "Goal review provider failed" })
              return
            }
            needsContinuation = result.needsContinuation
            step = result.step + 1
            promotion = "steer"
            if (!needsContinuation && !ownedRole)
              needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
            if (!needsContinuation && taskRole?.launchID) {
              const launch = yield* taskStore.launch(taskRole.launchID)
              if (launch?.request.activeMessages) {
                const pending = yield* taskMessages.next(taskRole.launchID)
                if (pending) {
                  promotion = pending
                  needsContinuation = true
                }
              }
            }
            if (!needsContinuation && result.normalStop && process.env.APEXO_RUNTIME_PROFILE === "grok-build") {
              const session = yield* getSession(input.sessionID)
              if ((!session.parentID || taskRole) && !goalRoles.get(session.id) && !workflowRoles.get(session.id)) {
                const currentAttempt = taskRole?.attempt ?? attempt
                const current = currentAttempt ? yield* goals.check(currentAttempt) : undefined
                if (!current || current.status === "active") {
                  const history = yield* getContext(session.id)
                  const userID = history.findLast((message) => message.type === "user")?.id
                  if (stopUserID !== userID) {
                    stopUserID = userID
                    stopContinuations = 0
                  }
                  const assistant = history.findLast((message) => message.type === "assistant")
                  if (assistant?.type === "assistant" && assistant.time.completed && !assistant.error) {
                    const liveTaskRole = taskRole ? yield* taskRoles.live(session.id) : undefined
                    const hook = taskRole ? liveTaskRole?.hooks : yield* hookSnapshot.get(session.id)
                    if (taskRole && liveTaskRole !== taskRole) return yield* Effect.interrupt
                    const decision = yield* SessionHookStop.evaluate(db, {
                      engine: "v2",
                      registry: hook?.registry,
                      selection: hook?.selection,
                      sessionID: session.id,
                      messageID: assistant.id,
                      directory: location.directory,
                      enabled: true,
                      ...(liveTaskRole ? { subagent: { type: liveTaskRole.record.agent } } : {}),
                      continuations: stopContinuations,
                      lastAssistantMessage: assistant.content
                        .filter((part) => part.type === "text")
                        .map((part) => part.text)
                        .join("\n"),
                    })
                    // Closing this drain pauses an active Goal through its finalizer; it is not success.
                    if (decision.forceStop) {
                      yield* settleInput(
                        input.sessionID,
                        "completed",
                        "completed",
                        result.finish,
                        result.usageIncomplete,
                      )
                      if (!taskRole) return
                    }
                    if (decision.continue) {
                      stopContinuations++
                      stopMessageID = assistant.id
                      needsContinuation = true
                    }
                  }
                }
              }
            }
            if (!needsContinuation)
              yield* settleInput(
                input.sessionID,
                result.turnLimit ? "failed" : "completed",
                result.turnLimit ? "turn_limit" : "completed",
                result.finish,
                result.usageIncomplete,
              )
          }
          if (!goal && !ownedRole)
            yield* SessionMemoryObserver.capture(input.sessionID).pipe(Effect.catch(() => Effect.void))
          if (goal) {
            yield* goal.finish()
            continue
          }
          if (taskRole?.launchID) {
            const launch = yield* taskStore.launch(taskRole.launchID)
            const hasChildCompletion = !taskRole.attempt && (yield* taskCompletions.pending(input.sessionID))
            if (hasChildCompletion) {
              promotion = launch?.request.activeMessages ? yield* taskMessages.next(taskRole.launchID) : undefined
              shouldRun = true
              continue
            }
            if (launch?.request.activeMessages) {
              promotion = yield* taskMessages.continueOrClose(taskRole.launchID)
              shouldRun = promotion !== undefined
              continue
            }
            shouldRun = false
            continue
          }
          const queued = !ownedRole && (yield* SessionInput.hasPending(db, input.sessionID, "queue"))
          shouldRun =
            queued ||
            (!ownedRole &&
              !(yield* inputExecutions.selected(input.sessionID)) &&
              ((yield* taskCompletions.pending(input.sessionID)) ||
                (yield* processCompletions.pending(input.sessionID))))
          promotion = queued ? "queue" : undefined
        }
      },
      Effect.scoped,
      Effect.catchTag("GoalConflict", (error) =>
        ["missing", "stale", "inactive", "budget"].includes(error.code) ? Effect.void : Effect.fail(error),
      ),
    )
    const run: import("./index").Interface["run"] = (input) =>
      Effect.gen(function* () {
        const inherited = yield* PermissionV2.Inherited
        const policies = new Map(yield* SessionExecutionPolicy.Current)
        const observers = new Map(yield* SessionInputExecutionOwner.Observers)
        return yield* drain(input).pipe(
          Effect.onExit((exit) =>
            (exit._tag === "Failure"
              ? settleInput(
                  input.sessionID,
                  Cause.hasInterrupts(exit.cause) ? "interrupted" : "failed",
                  Cause.hasInterrupts(exit.cause)
                    ? "interrupted"
                    : Cause.squash(exit.cause) instanceof LLMError
                      ? "provider_error"
                      : "unavailable",
                )
              : Effect.void
            ).pipe(Effect.catch((error) => Effect.logWarning("Headless receipt settlement deferred", error))),
          ),
          Effect.ensuring(SessionInputExecutionOwner.release(input.sessionID)),
          Effect.provideService(SessionExecutionPolicy.Current, policies),
          Effect.provideService(SessionInputExecutionOwner.Observers, observers),
          Effect.provideService(
            PermissionV2.Inherited,
            taskRoles.get(input.sessionID)
              ? new Map(inherited).set(input.sessionID, taskRoles.get(input.sessionID)!.record.authority)
              : workflowRoles.get(input.sessionID)?.authority
                ? new Map(inherited).set(input.sessionID, workflowRoles.get(input.sessionID)!.authority!)
                : inherited,
          ),
          Effect.provideService(SessionRunner.CurrentChildren, input.children),
          Effect.ensuring(
            goalCleanup
              .terminal(input.sessionID)
              .pipe(Effect.catchCause((cause) => Effect.logWarning("Native Goal cleanup will retry", cause))),
          ),
        )
      })

    const compact = Effect.fn("SessionRunner.compact")(function* (sessionID: SessionSchema.ID) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* new SessionCompaction.Failure({ message: "Session location changed before compaction" })
      const role = goalRoles.get(sessionID)
      const workflowRole = workflowRoles.get(sessionID)
      // Workflow owners consume the final reply after the drain; Goal children hold owner-scoped report capabilities.
      if ((yield* managedChildren.managed(sessionID)) || role || workflowRole || summaryRoles.get(sessionID))
        return yield* new SessionCompaction.Failure({
          message: "Manual compaction is unavailable for managed child Sessions",
        })
      if (yield* plans.blocked(sessionID))
        return yield* new SessionCompaction.Failure({ message: "Resolve the pending Plan review before compaction" })
      const entries = yield* SessionHistory.loadEntries(db, sessionID)
      const context = entries.map((entry) => entry.message)
      if (context.length === 0) return
      const attempt = yield* SessionGoalUsage.Current
      const goal = attempt ? yield* goals.check(attempt) : yield* goals.get(sessionID)
      if (goal?.status === "active" && !attempt)
        return yield* new SessionCompaction.Failure({
          message: "An active Goal requires a live attempt for compaction",
        })
      const model = yield* models.resolve(session)
      yield* compaction
        .manual({
          sessionID,
          entries,
          model,
          request: LLM.request({
            model,
            http: {
              headers: {
                "x-apexo-session-id": sessionID,
                "x-grok-conv-id": sessionID,
                ...(session.parentID ? { "x-apexo-parent-session-id": session.parentID } : {}),
              },
            },
            messages: yield* Effect.fromResult(toLLMMessages(context, model)),
            tools: [],
          }),
        })
        .pipe(Effect.provideService(SessionGoalUsage.Current, attempt))
    })
    return Service.of({
      run,
      compact,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    SessionScheduleRuntime.node,
    SessionInputExecution.node,
    SessionPlan.node,
    SessionPlanReceipt.node,
    SessionGoal.node,
    SessionGoalRole.node,
    SessionTaskRole.node,
    SessionTaskMessage.node,
    SessionTaskStore.node,
    SessionTaskCompletion.node,
    SessionProcessCompletion.node,
    SessionManagedChild.node,
    SessionGoalSummaryRole.node,
    SessionGoalRunner.node,
    SessionGoalCleanup.node,
    WorkflowRole.node,
    WorkflowRuntime.node,
    PermissionV2.node,
    EventV2.node,
    llmClient,
    AgentV2.node,
    ToolRegistry.node,
    SessionRunnerModel.node,
    SessionStore.node,
    Location.node,
    SystemContextRegistry.node,
    SkillGuidance.node,
    ReferenceGuidance.node,
    MemoryContextNative.node,
    MemoryNative.node,
    HookSnapshotLocation.node,
    Config.node,
    Snapshot.node,
    Database.node,
  ],
})
