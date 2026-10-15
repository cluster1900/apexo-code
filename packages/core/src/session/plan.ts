export * as SessionPlan from "./plan"

import { createHash } from "node:crypto"
import path from "node:path"
import { Context, DateTime, Deferred, Effect, FileSystem, Layer, Option, Schema } from "effect"
import { and, desc, eq } from "drizzle-orm"
import { EventTable } from "../event/sql"
import { AgentV2 } from "../agent"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { filesystem } from "../effect/app-node-platform"
import { EventV2 } from "../event"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "../tool/registry"
import { Tool } from "../tool/tool"
import { SessionEvent } from "./event"
import { SessionGoal } from "./goal"
import { SessionIncarnation } from "./incarnation"
import { SessionLifecycle } from "./lifecycle"
import { SessionManagedChild } from "./managed-child"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { SessionPlanReceipt } from "./plan-receipt"
import { Question } from "@apexo/schema/question"

export const Failure = SessionPlanReceipt.Failure
export type Failure = SessionPlanReceipt.Failure
export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("SessionPlan.RejectedError", {}) {}

const names = new Set([
  "bash",
  "read",
  "glob",
  "grep",
  "skill",
  "webfetch",
  "websearch",
  "lsp",
  "question",
  "todowrite",
  "write",
  "edit",
  "plan_exit",
])
export const transition = (name: string) => name === "plan_enter" || name === "plan_exit"
export const materialize = (tools: ToolRegistry.Materialization): ToolRegistry.Materialization => ({
  definitions: tools.definitions.filter((tool) => names.has(tool.name)),
  settle: (input) =>
    names.has(input.call.name)
      ? tools.settle(input)
      : Effect.succeed({
          result: { type: "error", value: `Tool unavailable in native Plan mode: ${input.call.name}` },
        }),
})

export const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const sessions = yield* SessionStore.Service
  const managed = yield* SessionManagedChild.Service
  const goals = yield* SessionGoal.Service
  const agents = yield* AgentV2.Service
  const lifecycle = yield* SessionLifecycle.Service
  const permission = yield* PermissionV2.Service
  const events = yield* EventV2.Service
  const location = yield* Location.Service
  const mutation = yield* LocationMutation.Service
  const fs = yield* FileSystem.FileSystem
  const receipts = yield* SessionPlanReceipt.Service
  const pending = new Map<Question.ID, Deferred.Deferred<SessionPlanReceipt.Record, RejectedError>>()

  const validate = Effect.fn("SessionPlan.validate")(function* (sessionID: SessionSchema.ID, expected?: AgentV2.ID) {
    const session = yield* sessions.get(sessionID)
    if (
      !session ||
      session.location.directory !== location.directory ||
      session.location.workspaceID !== location.workspaceID
    )
      return yield* new Failure({ code: "conflict", message: "Plan Session is unavailable at this Location" })
    if (session.parentID || (yield* managed.managed(sessionID)))
      return yield* new Failure({
        code: "conflict",
        message: "Plan transitions are unavailable for managed or child Sessions",
      })
    const goal = yield* goals.get(sessionID)
    if (goal && goal.status !== "complete")
      return yield* new Failure({
        code: "conflict",
        message: "Finish or clear Goal work before using ordinary Plan mode",
      })
    const selected = yield* agents.select(session.agent)
    if ((expected && selected.id !== expected) || !["build", "plan"].includes(selected.id))
      return yield* new Failure({
        code: "conflict",
        message: "Plan transitions support ordinary build and plan agents only",
      })
    for (const id of ["build", "plan"]) {
      const agent = yield* agents.get(AgentV2.ID.make(id))
      if (!agent || agent.mode === "subagent" || agent.hidden)
        return yield* new Failure({ code: "conflict", message: `Required primary agent is unavailable: ${id}` })
    }
    const created = yield* SessionIncarnation.created(database.db, sessionID)
    if (!created)
      return yield* new Failure({ code: "conflict", message: "Plan Session has no durable creation identity" })
    const filename = `${createHash("sha256").update(sessionID).update("\0").update(created).digest("hex")}.md`
    const target = yield* mutation.resolve({ path: path.join(".apexo", "plans", filename), kind: "file" })
    if (target.externalDirectory)
      return yield* new Failure({
        code: "conflict",
        message: "The native Plan directory must remain inside this workspace",
      })
    const selection = yield* database.db
      .select({ id: EventTable.id })
      .from(EventTable)
      .where(
        and(
          eq(EventTable.aggregate_id, sessionID),
          eq(
            EventTable.type,
            EventV2.versionedType(SessionEvent.AgentSwitched.type, SessionEvent.AgentSwitched.durable!.version),
          ),
        ),
      )
      .orderBy(desc(EventTable.seq))
      .get()
    return { session, created, target, selection: selection?.id }
  })

  const authorize = (call: Tool.Context, action: string, resources: readonly string[]) =>
    permission.assert({
      sessionID: call.sessionID,
      agent: call.agent,
      action,
      resources,
      source: { type: "tool", messageID: call.assistantMessageID, callID: call.toolCallID },
    })
  const switched = (sessionID: SessionSchema.ID, agent: string) =>
    Effect.gen(function* () {
      return yield* events.publish(SessionEvent.AgentSwitched, {
        sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        agent,
      })
    })
  const read = (file: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        if (!(yield* fs.exists(file))) return ""
        const handle = yield* fs.open(file, { flag: "r" })
        const bytes = new Uint8Array(32_769)
        let size = 0
        while (size < bytes.length) {
          const chunk = yield* handle.readAlloc(bytes.length - size)
          if (Option.isNone(chunk)) break
          if (chunk.value.length === 0) break
          bytes.set(chunk.value, size)
          size += chunk.value.length
        }
        if (size > 32_768)
          return yield* new Failure({ code: "conflict", message: "Plan exceeds the 32 KiB approval limit" })
        return yield* Effect.try({
          try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)),
          catch: () => new Failure({ code: "conflict", message: "Plan must be valid UTF-8" }),
        })
      }),
    )
  const hash = (content: string) => createHash("sha256").update(content).digest("hex")

  const failure = (error: unknown) =>
    error instanceof Failure ? error : new Failure({ code: "unavailable", message: "Plan approval is unavailable" })
  const outcome = (record: SessionPlanReceipt.Record) => ({
    path: record.artifact.path,
    message:
      record.decision === "approved"
        ? `The user approved the plan at ${record.artifact.path}. Build mode is active.`
        : "The plan was not approved. Stay in Plan mode and continue refining it.",
  })
  const checkApproval = (record: SessionPlanReceipt.Record, current: Effect.Success<ReturnType<typeof validate>>) =>
    Effect.gen(function* () {
      const allowed = yield* permission.inspect(record.sessionID, AgentV2.ID.make("plan"))
      if (allowed("plan_exit", ["*"]) === "deny" || allowed("read", [current.target.resource]) === "deny")
        return yield* new Failure({ code: "denied", message: "Current permissions deny this Plan approval" })
      if (
        current.target.canonical !== record.artifact.path ||
        hash(yield* read(record.artifact.path)) !== record.artifact.hash
      )
        return yield* new Failure({
          code: "conflict",
          message: "Plan changed during review; request approval of the new content",
        })
    })

  return {
    enter: (call: Tool.Context) =>
      Effect.gen(function* () {
        const claim = yield* lifecycle.capture(call.sessionID)
        return yield* lifecycle.owned(
          claim,
          Effect.gen(function* () {
            const current = yield* validate(call.sessionID, AgentV2.ID.make("build"))
            yield* authorize(call, "plan_enter", ["*"])
            yield* authorize(call, "edit", [current.target.resource])
            yield* lifecycle.use(
              call.sessionID,
              Effect.gen(function* () {
                const next = yield* validate(call.sessionID, AgentV2.ID.make("build"))
                if (next.created !== current.created || next.selection !== current.selection)
                  return yield* new Failure({ code: "conflict", message: "Plan Session changed" })
                yield* fs.makeDirectory(path.dirname(current.target.canonical), { recursive: true })
                yield* switched(call.sessionID, "plan")
              }),
            )
            return {
              path: current.target.canonical,
              message: `Plan mode is active. Draft the plan at ${current.target.canonical}; call plan_exit when ready for the user's approval. Shell requires permission in Plan mode. Task, Workflow and dynamic tools remain unavailable.`,
            }
          }),
        )
      }),
    ask: (call: Tool.Context) =>
      Effect.gen(function* () {
        const claim = yield* lifecycle.capture(call.sessionID)
        return yield* lifecycle.owned(
          claim,
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const current = yield* restore(validate(call.sessionID, AgentV2.ID.make("plan")))
              yield* restore(authorize(call, "plan_exit", ["*"]))
              yield* restore(authorize(call, "read", [current.target.resource]))
              const content = yield* restore(read(current.target.canonical))
              const turn = yield* SessionPlanReceipt.CurrentTurn
              if (!turn)
                return yield* new Failure({
                  code: "unavailable",
                  message: "Plan approval requires a completed provider turn",
                })
              const request: Question.Request = {
                id: Question.ID.create(),
                sessionID: call.sessionID,
                tool: { messageID: call.assistantMessageID, callID: call.toolCallID },
                questions: [
                  {
                    purpose: "plan_approval",
                    header: "Plan approval",
                    custom: false,
                    question: `Approve this plan and switch to build mode?\n\n${current.target.canonical}\n\n${content || "The plan file is empty or absent."}`,
                    options: [
                      { label: "Approve", description: "Switch to build mode and implement the reviewed plan" },
                      { label: "Keep planning", description: "Stay in Plan mode and revise the plan" },
                    ],
                  },
                ],
              }
              const record: SessionPlanReceipt.Record = {
                sessionID: call.sessionID,
                created: current.created,
                selection: current.selection,
                request,
                assistantMessageID: call.assistantMessageID,
                callID: call.toolCallID,
                artifact: {
                  path: current.target.canonical,
                  resource: current.target.resource,
                  content,
                  hash: hash(content),
                },
                turn,
                decision: "pending",
                answers: [],
                settled: false,
              }
              const deferred = yield* Deferred.make<SessionPlanReceipt.Record, RejectedError>()
              yield* lifecycle.use(
                call.sessionID,
                receipts.lock(
                  claim,
                  Effect.gen(function* () {
                    const next = yield* validate(call.sessionID, AgentV2.ID.make("plan"))
                    if (next.created !== record.created || next.selection !== record.selection)
                      return yield* new Failure({ code: "conflict", message: "Plan Session changed before review" })
                    if ((yield* receipts.list(call.sessionID)).some((item) => item.decision === "pending"))
                      return yield* new Failure({ code: "conflict", message: "A Plan review is already pending" })
                    yield* receipts.write(record)
                    pending.set(request.id, deferred)
                  }),
                ),
              )
              return yield* events.publish(Question.Event.Asked, request).pipe(
                Effect.andThen(restore(Deferred.await(deferred))),
                Effect.map(outcome),
                Effect.onInterrupt(() =>
                  lifecycle
                    .owned(
                      claim,
                      lifecycle.use(
                        call.sessionID,
                        receipts.lock(
                          claim,
                          Effect.gen(function* () {
                            const existing = yield* receipts.read(request.id, call.sessionID)
                            if (existing?.decision !== "pending") return
                            yield* receipts.write({ ...existing, decision: "cancelled" })
                            yield* events.publish(Question.Event.Rejected, {
                              sessionID: call.sessionID,
                              requestID: request.id,
                            })
                          }),
                        ),
                      ),
                    )
                    .pipe(Effect.ignore),
                ),
                Effect.ensuring(Effect.sync(() => pending.delete(request.id))),
              )
            }),
          ),
        )
      }).pipe(Effect.mapError((error) => (error instanceof RejectedError ? error : failure(error)))),
    lookupForReply: (id: Question.ID) =>
      receipts.read(id).pipe(
        Effect.flatMap((record) =>
          Effect.gen(function* () {
            if (!record) return undefined
            const session = yield* sessions.get(record.sessionID)
            return session?.location.directory === location.directory &&
              session?.location.workspaceID === location.workspaceID
              ? record
              : undefined
          }),
        ),
      ),
    lookup: (sessionID: SessionSchema.ID, id: Question.ID) => receipts.read(id, sessionID),
    list: () =>
      receipts.list().pipe(
        Effect.flatMap((items) =>
          Effect.filter(items, (item) =>
            Effect.gen(function* () {
              if (item.decision !== "pending") return false
              const session = yield* sessions.get(item.sessionID)
              return (
                session?.location.directory === location.directory &&
                session?.location.workspaceID === location.workspaceID
              )
            }),
          ),
        ),
        Effect.map((items) => items.map((item) => item.request)),
      ),
    decide: (sessionID: SessionSchema.ID, id: Question.ID, answers?: readonly Question.Answer[]) =>
      Effect.gen(function* () {
        const claim = yield* lifecycle.capture(sessionID)
        const checkpoint = receipts.checkpoint(claim)
        return yield* lifecycle.owned(
          claim,
          lifecycle.use(
            sessionID,
            receipts.lock(
              claim,
              Effect.gen(function* () {
                const record = yield* receipts.read(id, sessionID)
                if (!record) return undefined
                const decision =
                  answers === undefined
                    ? "cancelled"
                    : answers.length === 1 && answers[0]?.length === 1 && answers[0][0] === "Approve"
                      ? "approved"
                      : "rejected"
                const supplied = answers?.map((answer) => [...answer]) ?? []
                if (record.decision !== "pending") {
                  if (record.decision !== decision || JSON.stringify(record.answers) !== JSON.stringify(supplied))
                    return yield* new Failure({
                      code: "conflict",
                      message: "This Plan review already has a different decision",
                    })
                  return { resume: false, claim }
                }
                const current =
                  decision === "cancelled" ? undefined : yield* validate(sessionID, AgentV2.ID.make("plan"))
                if (current && (record.created !== current.created || record.selection !== current.selection))
                  return yield* new Failure({
                    code: "conflict",
                    message: "Plan approval authority changed; request review again",
                  })
                const next: SessionPlanReceipt.Record = { ...record, decision, answers: supplied }
                if (decision === "approved" && current) {
                  yield* checkApproval(record, current)
                  const eventID = EventV2.ID.create()
                  yield* events.publish(
                    SessionEvent.AgentSwitched,
                    {
                      sessionID,
                      messageID: SessionMessage.ID.create(),
                      timestamp: yield* DateTime.now,
                      agent: "build",
                    },
                    { id: eventID, commit: () => receipts.write({ ...next, selection: eventID }).pipe(Effect.orDie) },
                  )
                } else yield* receipts.write(next)
                const waiter = pending.get(id)
                if (answers === undefined) {
                  yield* events.publish(Question.Event.Rejected, { sessionID, requestID: id })
                  if (waiter) yield* Deferred.fail(waiter, new RejectedError())
                } else {
                  yield* events.publish(Question.Event.Replied, { sessionID, requestID: id, answers: supplied })
                  if (waiter) yield* Deferred.succeed(waiter, next)
                }
                return { resume: !waiter && decision !== "cancelled" && (yield* receipts.issue(id, checkpoint)), claim }
              }),
            ),
          ),
        )
      }).pipe(Effect.mapError(failure)),
    blocked: (sessionID: SessionSchema.ID) =>
      receipts.list(sessionID).pipe(Effect.map((items) => items.some((item) => item.decision === "pending"))),
    settled: (sessionID: SessionSchema.ID, assistantMessageID: SessionMessage.ID) =>
      receipts.list(sessionID).pipe(
        Effect.flatMap((items) =>
          Effect.forEach(
            items.filter(
              (item) => item.assistantMessageID === assistantMessageID && !item.settled && item.decision !== "pending",
            ),
            (item) => receipts.write({ ...item, settled: true }),
            { discard: true },
          ),
        ),
      ),
    reconcile: (sessionID: SessionSchema.ID) =>
      Effect.gen(function* () {
        const claim = yield* lifecycle.capture(sessionID)
        return yield* receipts.lock(
          claim,
          Effect.gen(function* () {
            const items = yield* receipts.list(sessionID)
            if (items.some((item) => item.decision === "pending")) return false
            for (const item of items.filter((item) => !item.settled)) {
              const current = yield* validate(sessionID)
              if (
                current.created !== item.created ||
                (item.decision !== "cancelled" && current.selection !== item.selection)
              )
                return yield* new Failure({ code: "conflict", message: "Plan continuation authority changed" })
              if (item.decision === "approved") yield* checkApproval(item, current)
              const message = yield* sessions.message(item.assistantMessageID)
              const tool =
                message?.message.type === "assistant"
                  ? message.message.content.find((part) => part.type === "tool" && part.id === item.callID)
                  : undefined
              if (message?.sessionID !== sessionID || !tool || tool.type !== "tool" || tool.name !== "plan_exit")
                return yield* new Failure({ code: "conflict", message: "Original Plan tool is unavailable" })
              if (
                tool.state.status === "completed" &&
                (item.decision === "cancelled" ||
                  tool.state.structured.path !== item.artifact.path ||
                  tool.state.structured.message !== outcome(item).message)
              )
                return yield* new Failure({ code: "conflict", message: "Original Plan tool has a different result" })
              if (tool.state.status === "error" && item.decision !== "cancelled")
                return yield* new Failure({
                  code: "conflict",
                  message: "Original Plan tool failed before continuation",
                })
              if (tool.state.status === "pending" || tool.state.status === "running") {
                if (item.decision === "cancelled")
                  yield* events.publish(SessionEvent.Tool.Failed, {
                    sessionID,
                    assistantMessageID: item.assistantMessageID,
                    callID: item.callID,
                    timestamp: yield* DateTime.now,
                    error: { type: "unknown", message: "The user dismissed this Plan review" },
                    provider: { executed: false },
                  })
                else
                  yield* events.publish(SessionEvent.Tool.Success, {
                    sessionID,
                    assistantMessageID: item.assistantMessageID,
                    callID: item.callID,
                    timestamp: yield* DateTime.now,
                    structured: outcome(item),
                    content: [{ type: "text", text: outcome(item).message }],
                    provider: { executed: false },
                  })
              }
              yield* events.publish(
                SessionEvent.Step.Ended,
                {
                  sessionID,
                  assistantMessageID: item.assistantMessageID,
                  timestamp: yield* DateTime.now,
                  finish: item.turn.finish,
                  tokens: item.turn.tokens,
                  cost: 0,
                },
                { commit: () => receipts.write({ ...item, settled: true }).pipe(Effect.orDie) },
              )
            }
            yield* receipts.consume(sessionID)
            return true
          }),
        )
      }).pipe(Effect.mapError(failure)),
    context: (sessionID: SessionSchema.ID) =>
      Effect.gen(function* () {
        const current = yield* validate(sessionID, AgentV2.ID.make("plan"))
        const rules: PermissionV2.Ruleset = [
          { action: "*", resource: "*", effect: "allow" },
          { action: "edit", resource: "*", effect: "deny" },
          { action: "bash", resource: "*", effect: "ask" },
          { action: "edit", resource: current.target.resource, effect: "allow" },
        ]
        return {
          authority: { rules, all: rules },
          system: `Native Plan mode is active. Inspect the task and write the plan only to ${current.target.canonical}. Use plan_exit to request explicit approval before implementation. Shell requires explicit permission and can modify files; it is not classified as read-only. Task, Workflow and dynamic tools are unavailable.`,
        }
      }).pipe(
        Effect.mapError((error) =>
          error instanceof Failure
            ? error
            : new Failure({ code: "conflict", message: "Native Plan context is unavailable" }),
        ),
      ),
  }
})
export type Interface = Effect.Success<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionPlan") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    SessionPlanReceipt.node,
    Location.node,
    Database.node,
    SessionStore.node,
    SessionManagedChild.node,
    SessionGoal.node,
    AgentV2.node,
    SessionLifecycle.node,
    PermissionV2.node,
    EventV2.node,
    LocationMutation.node,
    filesystem,
  ],
})
