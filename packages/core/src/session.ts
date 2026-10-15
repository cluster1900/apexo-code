import type { SessionScheduleRecord } from "./session/schedule-record"
import type { SessionSchedule } from "@apexo/schema/session-schedule"
import { SessionInputExecution } from "./session/input-execution"
import { SessionManagedChild } from "./session/managed-child"
import { CommandSandbox } from "./command-sandbox"
import { CommandSandboxPolicy } from "./command-sandbox/policy"
import { SessionCommandSandbox } from "./session/command-sandbox"
import { Sandbox } from "@apexo/schema/sandbox"
import { SessionRemoval } from "./session/removal"
export * as SessionV2 from "./session"
export * from "./session/schema"

import { SessionInputAdmission } from "./session/input-admission"
import { SessionLifecycle } from "./session/lifecycle"
import { DateTime, Effect, Layer, Schema, Context, Stream } from "effect"
import { ListAnchor } from "@apexo/schema/session"
import { and, asc, desc, eq, gt, like, lt, or, type SQL } from "drizzle-orm"
import { ProjectV2 } from "./project"
import { WorkspaceV2 } from "./workspace"
import { ModelV2 } from "./model"
import { Location } from "./location"
import { SessionMessage } from "./session/message"
import { Prompt } from "./session/prompt"
import { PromptInput } from "@apexo/schema/prompt-input"
import { EventV2 } from "./event"
import { Database } from "./database/database"
import { SessionProjector } from "./session/projector"
import { SessionMessageTable, SessionTable } from "./session/sql"
import { SessionSchema } from "./session/schema"
import { AbsolutePath, PositiveInt, RelativePath } from "./schema"
import { AgentV2 } from "./agent"
import { SessionV1 } from "./v1/session"
import { InstallationVersion } from "./installation/version"
import { Slug } from "./util/slug"
import { ProjectTable } from "./project/sql"
import path from "path"
import { fromRow } from "./session/info"
import { SessionRunner } from "./session/runner/index"
import { SessionStore } from "./session/store"
import { SessionExecution } from "./session/execution"
import { SessionRunCoordinator } from "./session/run-coordinator"
import { makeGlobalNode } from "./effect/app-node"
import { LocationServiceMap } from "./location-service-map"
import { MessageDecodeError } from "./session/error"
import { SessionEvent } from "./session/event"
import { SessionInput } from "./session/input"
import { Snapshot } from "./snapshot"
import { SessionRevert } from "./session/revert"
import { Revert } from "@apexo/schema/revert"
import { FSUtil } from "./fs-util"
import { SessionDurable } from "@apexo/schema/durable-event-manifest"

export const RevertState = Revert.State
export type RevertState = Revert.State

// get project -> project.locations
//
// get all sessions
//

// - by project
//   - by subpath
// - by workspace (home is special)

export { ListAnchor }

const ListInputBase = {
  workspaceID: WorkspaceV2.ID.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
  order: Schema.Literals(["asc", "desc"]).pipe(Schema.optional),
  anchor: ListAnchor.pipe(Schema.optional),
}

const ListDirectoryInput = Schema.Struct({
  ...ListInputBase,
  directory: AbsolutePath,
})

const ListProjectInput = Schema.Struct({
  ...ListInputBase,
  project: ProjectV2.ID,
  subpath: RelativePath.pipe(Schema.optional),
})

const ListAllInput = Schema.Struct(ListInputBase)

export const ListInput = Schema.Union([ListDirectoryInput, ListProjectInput, ListAllInput])
export type ListInput = typeof ListInput.Type

type CreateInput = {
  commandSandbox?: Sandbox.Profile
  parentID?: SessionSchema.ID
  metadata?: Record<string, string>
  id?: SessionSchema.ID
  agent?: AgentV2.ID
  model?: ModelV2.Ref
  location: Location.Ref
}

type CompactInput = {
  sessionID: SessionSchema.ID
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Session.NotFoundError", {
  sessionID: SessionSchema.ID,
}) {}

export class OperationUnavailableError extends Schema.TaggedErrorClass<OperationUnavailableError>()(
  "Session.OperationUnavailableError",
  {
    operation: Schema.Literals(["move", "shell", "skill", "switchAgent", "compact", "wait"]),
  },
) {}

export { ContextSnapshotDecodeError, MessageDecodeError } from "./session/error"

export class PromptConflictError extends Schema.TaggedErrorClass<PromptConflictError>()("Session.PromptConflictError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {}
export class ManagedInputError extends Schema.TaggedErrorClass<ManagedInputError>()("Session.ManagedInputError", {
  sessionID: SessionSchema.ID,
}) {}

export const MessageNotFoundError = SessionRevert.MessageNotFoundError
export type MessageNotFoundError = SessionRevert.MessageNotFoundError

export type Error =
  | NotFoundError
  | MessageDecodeError
  | OperationUnavailableError
  | PromptConflictError
  | ManagedInputError

export interface Interface {
  readonly inputExecution: (
    target: SessionInputExecution.Target,
  ) => Effect.Effect<SessionInput.Execution, NotFoundError | SessionInputExecution.Failure>
  readonly waitInput: (
    target: SessionInputExecution.Target,
    timeoutMs?: number,
  ) => Effect.Effect<SessionInput.ExecutionWait, NotFoundError | SessionInputExecution.Failure>
  readonly interruptInput: (
    target: SessionInputExecution.Target,
  ) => Effect.Effect<SessionInput.Execution, NotFoundError | SessionInputExecution.Failure>
  readonly list: (input?: ListInput) => Effect.Effect<SessionSchema.Info[]>
  readonly remove: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionLifecycle.Failure>
  readonly create: (
    input: CreateInput,
  ) => Effect.Effect<SessionSchema.Info, NotFoundError | CommandSandboxPolicy.Failure>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info, NotFoundError>
  readonly messages: (input: {
    sessionID: SessionSchema.ID
    limit?: number
    order?: "asc" | "desc"
    cursor?: {
      id: SessionMessage.ID
      direction: "previous" | "next"
    }
  }) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly message: (input: {
    sessionID: SessionSchema.ID
    messageID: SessionMessage.ID
  }) => Effect.Effect<SessionMessage.Message | undefined>
  readonly context: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly events: (input: {
    sessionID: SessionSchema.ID
    after?: number
  }) => Stream.Stream<SessionEvent.DurableEvent, NotFoundError>
  readonly history: (input: {
    sessionID: SessionSchema.ID
    after?: number
    limit: number
  }) => Effect.Effect<{ events: ReadonlyArray<SessionEvent.DurableEvent>; hasMore: boolean }, NotFoundError>
  readonly switchAgent: (input: { sessionID: SessionSchema.ID; agent: string }) => Effect.Effect<void, NotFoundError>
  readonly switchModel: (input: {
    sessionID: SessionSchema.ID
    model: ModelV2.Ref
  }) => Effect.Effect<void, NotFoundError>
  readonly prompt: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    prompt: PromptInput.Prompt
    executionPolicy?: SessionInput.ExecutionPolicy
    delivery?: SessionInput.Delivery
    resume?: boolean
  }) => Effect.Effect<SessionInput.Admitted, NotFoundError | PromptConflictError | ManagedInputError>
  readonly shell: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    command: string
    resume?: boolean
  }) => Effect.Effect<void, OperationUnavailableError>
  readonly skill: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    skill: string
    resume?: boolean
  }) => Effect.Effect<void, OperationUnavailableError>
  readonly compact: (
    input: CompactInput,
  ) => Effect.Effect<void, NotFoundError | SessionRunner.CompactError | SessionRunCoordinator.ControlCancelled>
  readonly wait: (id: SessionSchema.ID) => Effect.Effect<void, NotFoundError | SessionRunner.RunError>
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly restore: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<
    SessionSchedule.Restoration,
    NotFoundError | SessionScheduleRecord.Failure | SessionRunCoordinator.ControlCancelled
  >
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | SessionRunner.RunError>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly revert: {
    readonly stage: (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
      files?: boolean
    }) => Effect.Effect<Revert.State, NotFoundError | MessageNotFoundError | Snapshot.Error>
    readonly clear: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | Snapshot.Error>
    readonly commit: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  }
}

export class Service extends Context.Service<Service, Interface>()("@apexo/v2/Session") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const policies = yield* SessionCommandSandbox.Service
    const removal = yield* SessionRemoval.Service
    const lifecycle = yield* SessionLifecycle.Service
    const inputAdmission = yield* SessionInputAdmission.Service
    const database = yield* Database.Service
    const db = database.db
    const events = yield* EventV2.Service
    const projects = yield* ProjectV2.Service
    const execution = yield* SessionExecution.Service
    const inputExecutions = yield* SessionInputExecution.Service
    const tasks = yield* SessionManagedChild.Service
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)
    const isDurableSessionEvent = Schema.is(SessionEvent.Durable)
    const decode = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(
        Effect.mapError(
          () =>
            new MessageDecodeError({
              sessionID: SessionSchema.ID.make(row.session_id),
              messageID: SessionMessage.ID.make(row.id),
            }),
        ),
      )

    const mutate = <A, E, R>(sessionID: SessionSchema.ID, effect: Effect.Effect<A, E, R>) =>
      lifecycle
        .use(sessionID, effect)
        .pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.fail(new NotFoundError({ sessionID }))))
    const readInput = <A, E>(target: SessionInputExecution.Target, effect: Effect.Effect<A, E>) =>
      lifecycle
        .read(
          target.sessionID,
          Effect.gen(function* () {
            yield* result.get(target.sessionID)
            const claim = yield* lifecycle.capture(target.sessionID)
            const value = yield* effect
            if (!lifecycle.available(claim)) return yield* new NotFoundError({ sessionID: target.sessionID })
            return value
          }),
        )
        .pipe(
          Effect.catchTag("SessionLifecycle.Closed", () =>
            Effect.fail(new NotFoundError({ sessionID: target.sessionID })),
          ),
        )
    const result = Service.of({
      inputExecution: (target) => readInput(target, inputExecutions.get(target)),
      waitInput: (target, timeoutMs) => readInput(target, inputExecutions.wait(target, timeoutMs)),
      interruptInput: (target) =>
        readInput(target, inputExecutions.interrupt(target, execution.interrupt)).pipe(Effect.uninterruptible),
      remove: removal.remove,
      create: Effect.fn("V2Session.create")(function* (input) {
        const sessionID = input.id ?? SessionSchema.ID.create()
        const claim = yield* lifecycle.capture(sessionID).pipe(Effect.mapError(() => new NotFoundError({ sessionID })))
        return yield* lifecycle
          .owned(
            claim,
            Effect.gen(function* () {
              const adopt = (recorded: SessionSchema.Info) =>
                policies.adopt(sessionID, input.commandSandbox).pipe(Effect.as(recorded))
              const recorded = yield* store.get(sessionID)
              if (recorded) return yield* adopt(recorded)
              const parent = input.parentID
                ? yield* Effect.gen(function* () {
                    if (!(yield* store.get(input.parentID!)))
                      return yield* new NotFoundError({ sessionID: input.parentID! })
                    const captured = yield* policies.capture(input.parentID!)
                    yield* policies.adopt(input.parentID!, input.commandSandbox)
                    return captured
                  })
                : undefined
              // Backend probing and Location construction never hold a Session write lease.
              const policy =
                parent || !input.commandSandbox || input.commandSandbox === "off"
                  ? CommandSandboxPolicy.off
                  : yield* Effect.gen(function* () {
                      const sandbox = yield* CommandSandbox.Service
                      return yield* sandbox.preflight(input.commandSandbox!)
                    }).pipe(
                      Effect.provide(locations.get(input.location)),
                      Effect.mapError((error) =>
                        error instanceof CommandSandboxPolicy.Failure
                          ? error
                          : new CommandSandboxPolicy.Failure({
                              code: "unavailable",
                              message: "The command sandbox Location could not be prepared.",
                            }),
                      ),
                    )
              const project = yield* projects.resolve(input.location.directory)
              const prepared = parent
                ? yield* policies.prepareChild(parent, sessionID)
                : yield* policies.prepareRoot(sessionID, policy)
              const create = Effect.gen(function* () {
                const recorded = yield* store.get(sessionID)
                if (recorded) return yield* adopt(recorded)
                yield* db
                  .insert(ProjectTable)
                  .values({ id: project.id, worktree: project.directory, vcs: project.vcs?.type, sandboxes: [] })
                  .onConflictDoNothing()
                  .run()
                  .pipe(Effect.orDie)
                const now = Date.now()
                const info = SessionV1.SessionInfo.make({
                  id: sessionID,
                  parentID: input.parentID,
                  metadata: input.metadata,
                  slug: Slug.create(),
                  version: InstallationVersion,
                  projectID: project.id,
                  directory: input.location.directory,
                  path: path.relative(project.directory, input.location.directory).replaceAll("\\", "/"),
                  workspaceID: input.location.workspaceID ? WorkspaceV2.ID.make(input.location.workspaceID) : undefined,
                  title: `New session - ${new Date(now).toISOString()}`,
                  agent: input.agent,
                  model: input.model
                    ? {
                        id: ModelV2.ID.make(input.model.id),
                        providerID: input.model.providerID,
                        variant: input.model.variant,
                      }
                    : undefined,
                  cost: 0,
                  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                  time: { created: now, updated: now },
                })
                const projected = yield* events
                  .publish(
                    SessionV1.Event.Created,
                    { sessionID, info },
                    {
                      location: input.location,
                      id: prepared.eventID,
                      commit: () => prepared.commit.pipe(Effect.orDie),
                    },
                  )
                  .pipe(
                    Effect.as({ type: "created" } as const),
                    Effect.catchDefect((defect) => {
                      if (defect instanceof CommandSandboxPolicy.Failure) return Effect.fail(defect)
                      if (!(defect instanceof SessionProjector.SessionAlreadyProjected)) return Effect.die(defect)
                      return store
                        .get(sessionID)
                        .pipe(
                          Effect.flatMap((session) =>
                            session
                              ? adopt(session).pipe(Effect.map((session) => ({ type: "existing", session }) as const))
                              : Effect.die(defect),
                          ),
                        )
                    }),
                  )
                if (projected.type === "existing") return projected.session
                return yield* result.get(sessionID)
              })
              return yield* input.parentID
                ? lifecycle.child(input.parentID, sessionID, create)
                : lifecycle.use(sessionID, create)
            }),
          )
          .pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.fail(new NotFoundError({ sessionID }))))
      }),
      get: Effect.fn("V2Session.get")(function* (sessionID) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* new NotFoundError({ sessionID })
        return session
      }),
      list: Effect.fn("V2Session.list")(function* (input = {}) {
        const direction = input.anchor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const sortColumn = SessionTable.time_created
        const conditions: SQL[] = []
        if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.anchor) {
          conditions.push(
            order === "asc"
              ? or(
                  gt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), gt(SessionTable.id, input.anchor.id)),
                )!
              : or(
                  lt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), lt(SessionTable.id, input.anchor.id)),
                )!,
          )
        }
        const query = db
          .select()
          .from(SessionTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            order === "asc" ? asc(sortColumn) : desc(sortColumn),
            order === "asc" ? asc(SessionTable.id) : desc(SessionTable.id),
          )
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return (direction === "previous" ? rows.toReversed() : rows).map((row) => fromRow(row))
      }),
      messages: Effect.fn("V2Session.messages")(function* (input) {
        yield* result.get(input.sessionID)
        const direction = input.cursor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const anchor = input.cursor
          ? yield* db
              .select({ seq: SessionMessageTable.seq })
              .from(SessionMessageTable)
              .where(
                and(eq(SessionMessageTable.session_id, input.sessionID), eq(SessionMessageTable.id, input.cursor.id)),
              )
              .get()
              .pipe(Effect.orDie)
          : undefined
        if (input.cursor && !anchor) return []
        const boundary = anchor
          ? order === "asc"
            ? gt(SessionMessageTable.seq, anchor.seq)
            : lt(SessionMessageTable.seq, anchor.seq)
          : undefined
        const where = boundary
          ? and(eq(SessionMessageTable.session_id, input.sessionID), boundary)
          : eq(SessionMessageTable.session_id, input.sessionID)
        const query = db
          .select()
          .from(SessionMessageTable)
          .where(where)
          .orderBy(order === "asc" ? asc(SessionMessageTable.seq) : desc(SessionMessageTable.seq))
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return yield* Effect.forEach(direction === "previous" ? rows.toReversed() : rows, decode)
      }),
      message: Effect.fn("V2Session.message")(function* (input) {
        const stored = yield* store.message(input.messageID)
        return stored?.sessionID === input.sessionID ? stored.message : undefined
      }),
      context: Effect.fn("V2Session.context")(function* (sessionID) {
        yield* result.get(sessionID)
        return yield* store.context(sessionID)
      }),
      events: (input) =>
        Stream.unwrap(
          result
            .get(input.sessionID)
            .pipe(Effect.as(events.durable({ aggregateID: input.sessionID, after: input.after }))),
        ).pipe(Stream.filter((event): event is SessionEvent.DurableEvent => isDurableSessionEvent(event))),
      history: Effect.fn("V2Session.history")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* EventV2.readAggregate(db, {
          ...input,
          aggregateID: input.sessionID,
          manifest: SessionDurable,
        })
      }),
      prompt: Effect.fn("V2Session.prompt")((input) =>
        mutate(
          input.sessionID,
          Effect.uninterruptible(
            Effect.gen(function* () {
              yield* result.get(input.sessionID)
              if (
                yield* tasks
                  .managed(input.sessionID)
                  .pipe(Effect.mapError(() => new ManagedInputError({ sessionID: input.sessionID })))
              )
                return yield* new ManagedInputError({ sessionID: input.sessionID })
              const prompt = resolvePrompt(input.prompt)
              const messageID = input.id ?? SessionMessage.ID.create()
              const delivery = input.delivery ?? "steer"
              const expected = {
                sessionID: input.sessionID,
                messageID,
                prompt,
                delivery,
                executionPolicy: input.executionPolicy,
              }
              const claim = yield* lifecycle.capture(input.sessionID)
              const admitted = yield* inputAdmission.admit(
                claim,
                Effect.gen(function* () {
                  const existing = yield* SessionInput.find(db, messageID)
                  const admitted = yield* SessionInput.admit(db, events, {
                    id: messageID,
                    sessionID: input.sessionID,
                    prompt,
                    delivery,
                    executionPolicy: input.executionPolicy,
                  }).pipe(
                    Effect.catchDefect((defect) =>
                      defect instanceof SessionInput.LifecycleConflict
                        ? new PromptConflictError({ sessionID: input.sessionID, messageID })
                        : Effect.die(defect),
                    ),
                  )
                  if (!SessionInput.equivalent(admitted, expected))
                    return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
                  return { value: admitted, changed: existing === undefined && admitted.promotedSeq === undefined }
                }),
              )
              if (input.resume !== false) yield* execution.wake(admitted.sessionID)
              return admitted
            }),
          ),
        ),
      ),
      shell: Effect.fn("V2Session.shell")(function* () {
        return yield* new OperationUnavailableError({ operation: "shell" })
      }),
      skill: Effect.fn("V2Session.skill")(function* () {
        return yield* new OperationUnavailableError({ operation: "skill" })
      }),
      switchAgent: Effect.fn("V2Session.switchAgent")(
        function* (input) {
          yield* result.get(input.sessionID)
          yield* events.publish(SessionEvent.AgentSwitched, {
            sessionID: input.sessionID,
            messageID: SessionMessage.ID.create(),
            timestamp: yield* DateTime.now,
            agent: input.agent,
          })
        },
        (effect, input) => mutate(input.sessionID, effect),
      ),
      switchModel: Effect.fn("V2Session.switchModel")(
        function* (input) {
          const session = yield* result.get(input.sessionID)
          if (
            session.model?.providerID === input.model.providerID &&
            session.model.id === input.model.id &&
            (session.model.variant ?? "default") === (input.model.variant ?? "default")
          )
            return
          yield* events.publish(SessionEvent.ModelSwitched, {
            sessionID: input.sessionID,
            messageID: SessionMessage.ID.create(),
            timestamp: yield* DateTime.now,
            model: input.model,
          })
        },
        (effect, input) => mutate(input.sessionID, effect),
      ),
      compact: Effect.fn("V2Session.compact")(function* (input) {
        yield* result.get(input.sessionID)
        yield* execution.compact(input.sessionID)
      }),
      wait: Effect.fn("V2Session.wait")(function* (sessionID) {
        yield* result.get(sessionID)
        yield* execution.wait(sessionID)
      }),
      active: execution.active,
      restore: Effect.fn("V2Session.restore")(
        function* (sessionID) {
          const { SessionScheduleRuntime } = yield* Effect.promise(() => import("./session/schedule"))
          const session = yield* result.get(sessionID)
          return yield* execution.control(
            sessionID,
            SessionScheduleRuntime.Service.use((runtime) => runtime.restore(sessionID)).pipe(
              Effect.provide(locations.get(session.location)),
            ),
          )
        },
        (effect, sessionID) =>
          lifecycle
            .run(sessionID, effect)
            .pipe(Effect.catchTag("SessionLifecycle.Closed", () => Effect.fail(new NotFoundError({ sessionID })))),
      ),
      resume: Effect.fn("V2Session.resume")(function* (sessionID) {
        yield* result.get(sessionID)
        yield* execution.resume(sessionID)
      }),
      interrupt: Effect.fn("V2Session.interrupt")((sessionID) =>
        Effect.uninterruptible(execution.interrupt(sessionID)),
      ),
      revert: {
        stage: Effect.fn("V2Session.revert.stage")(
          function* (input) {
            const session = yield* result.get(input.sessionID)
            return yield* SessionRevert.stage({ session, messageID: input.messageID, files: input.files }).pipe(
              Effect.provideService(Database.Service, database),
              Effect.provideService(EventV2.Service, events),
              Effect.provide(locations.get(session.location)),
            )
          },
          (effect, input) => mutate(input.sessionID, effect),
        ),
        clear: Effect.fn("V2Session.revert.clear")(
          function* (sessionID) {
            const session = yield* result.get(sessionID)
            yield* SessionRevert.clear(session).pipe(
              Effect.provideService(EventV2.Service, events),
              Effect.provide(locations.get(session.location)),
            )
          },
          (effect, sessionID) => mutate(sessionID, effect),
        ),
        commit: Effect.fn("V2Session.revert.commit")(
          function* (sessionID) {
            const session = yield* result.get(sessionID)
            yield* SessionRevert.commit(session).pipe(Effect.provideService(EventV2.Service, events))
          },
          (effect, sessionID) => mutate(sessionID, effect),
        ),
      },
    })

    return result
  }),
)

const resolvePrompt = (input: PromptInput.Prompt) =>
  Prompt.make({
    text: input.text,
    agents: input.agents,
    files: input.files?.map((file) => {
      const dataMime = file.uri.match(/^data:([^;,]+)[;,]/i)?.[1]
      const target = URL.canParse(file.uri) ? new URL(file.uri).pathname : (file.name ?? file.uri)
      return {
        ...file,
        mime: dataMime ?? (target.endsWith("/") ? "application/x-directory" : FSUtil.mimeType(target)),
      }
    }),
  })

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [
    SessionInputAdmission.node,
    SessionInputExecution.node,
    SessionLifecycle.node,
    SessionCommandSandbox.node,
    SessionRemoval.node,
    Database.node,
    EventV2.node,
    ProjectV2.node,
    SessionExecution.node,
    SessionStore.node,
    SessionManagedChild.node,
    LocationServiceMap.node,
    SessionProjector.node,
  ],
})
