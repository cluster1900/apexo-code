import { SessionExecutionPolicy } from "./session/execution-policy"
import { PermissionAuthority } from "./permission/authority"
import { SessionHookSnapshot } from "./session/hook-snapshot"
export * as PermissionV2 from "./permission"

import { makeLocationNode } from "./effect/app-node"
import { Context, Deferred, Effect as EffectRuntime, Fiber, Layer, Schema, Scope } from "effect"
import { Permission } from "@apexo/schema/permission"
import { EventV2 } from "./event"
import { Location } from "./location"
import { AgentV2 } from "./agent"
import { SessionV2 } from "./session"
import { SessionStore } from "./session/store"
import { Wildcard } from "./util/wildcard"
import { Database } from "./database/database"
import { PermissionReview } from "./permission/review"
import { PermissionReviewState } from "./permission/review-state"
import { PermissionReviewContext } from "./permission/review-context"
import { SessionLifecycle } from "./session/lifecycle"
import { PermissionSaved } from "./permission/saved"
import { BashApproval } from "./tool/bash-approval"
import { HookObserver } from "./hook-observer"
import { PermissionV1 } from "./v1/permission"

export { Effect, Rule, Ruleset } from "@apexo/schema/permission"
const missingAgentPermissions: Permission.Ruleset = [{ action: "*", resource: "*", effect: "deny" }]

export const ID = Permission.ID
export type ID = typeof ID.Type

export const Source = Permission.Source
export type Source = typeof Source.Type

const RequestFields = {
  sessionID: Permission.Request.fields.sessionID,
  action: Permission.Request.fields.action,
  resources: Permission.Request.fields.resources,
  save: Permission.Request.fields.save,
  metadata: Permission.Request.fields.metadata,
  source: Permission.Request.fields.source,
}

export const Request = Permission.Request
export type Request = typeof Request.Type

export const Reply = Permission.Reply
export type Reply = typeof Reply.Type

export const AssertInput = Schema.Struct({
  id: ID.pipe(Schema.optional),
  ...RequestFields,
  agent: AgentV2.ID.pipe(Schema.optional),
}).annotate({ identifier: "PermissionV2.AssertInput" })
export type AssertInput = typeof AssertInput.Type

export const ReplyInput = Schema.Struct({
  requestID: ID,
  reply: Reply,
  message: Schema.String.pipe(Schema.optional),
  /** "always" only: one of the save sets offered in metadata.alwaysChoices (scope picker); anything else is ignored. */
  save: Schema.Array(Schema.String).pipe(Schema.optional),
}).annotate({ identifier: "PermissionV2.ReplyInput" })
export type ReplyInput = typeof ReplyInput.Type

export const AskResult = Schema.Struct({
  id: ID,
  effect: Permission.Effect,
}).annotate({ identifier: "PermissionV2.AskResult" })
export type AskResult = typeof AskResult.Type

export const Event = Permission.Event

export class DeclinedError extends Schema.TaggedErrorClass<DeclinedError>()("PermissionV2.DeclinedError", {}) {}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionV2.CorrectedError", {
  feedback: Schema.String,
}) {}

export class BlockedError extends Schema.TaggedErrorClass<BlockedError>()("PermissionV2.BlockedError", {
  rules: Permission.Ruleset,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("PermissionV2.NotFoundError", {
  requestID: ID,
}) {}

export type Error = BlockedError | CorrectedError

export function evaluate(action: string, resource: string, ...rulesets: Permission.Ruleset[]): Permission.Rule {
  const canonical = PermissionV1.canonicalPermission(action)
  return (
    rulesets
      .flat()
      .findLast(
        (rule) =>
          Wildcard.match(canonical, PermissionV1.canonicalPermission(rule.action)) &&
          Wildcard.match(resource, rule.resource),
      ) ?? {
      action: canonical,
      resource: "*",
      effect: "ask",
    }
  )
}

export function merge(...rulesets: Permission.Ruleset[]): Permission.Ruleset {
  return rulesets.flat()
}

/** Serializable frozen policy; only first-party owned launch records may restore it. */
export const Authority = PermissionAuthority.Snapshot
export type Authority = typeof Authority.Type
export const Inherited = Context.Reference<ReadonlyMap<SessionV2.ID, readonly Authority[]>>(
  "@apexo/Permission/Inherited",
  {
    defaultValue: () => new Map(),
  },
)

export interface Interface {
  readonly capture: (
    sessionID: SessionV2.ID,
    agent?: AgentV2.ID,
  ) => EffectRuntime.Effect<readonly Authority[], SessionV2.NotFoundError>
  /** Read-only authority snapshot. Does not emit a request or ask for approval. */
  readonly inspect: (
    sessionID: SessionV2.ID,
    agent?: AgentV2.ID,
  ) => EffectRuntime.Effect<
    (action: string, resources: readonly string[]) => Permission.Effect,
    SessionV2.NotFoundError
  >
  /** Whether a literal allow grant equal to `resource` was saved (session consent or project saved rules); wildcards never count. */
  readonly exact: (
    sessionID: SessionV2.ID,
    action: string,
    resource: string,
  ) => EffectRuntime.Effect<boolean, SessionV2.NotFoundError>
  readonly ask: (input: AssertInput) => EffectRuntime.Effect<AskResult, SessionV2.NotFoundError>
  readonly assert: (input: AssertInput) => EffectRuntime.Effect<void, Error | SessionV2.NotFoundError>
  readonly reply: (input: ReplyInput) => EffectRuntime.Effect<void, NotFoundError>
  readonly get: (id: ID) => EffectRuntime.Effect<Request | undefined>
  readonly forSession: (sessionID: SessionV2.ID) => EffectRuntime.Effect<ReadonlyArray<Request>>
  readonly list: () => EffectRuntime.Effect<ReadonlyArray<Request>>
  /** Evaluate static agent permissions plus project-saved rules without mutating or requiring a Session. */
  readonly evaluateOffline: (input: {
    readonly action: string
    readonly resources: readonly string[]
    readonly exactResource?: string
    readonly agent?: AgentV2.ID | string
  }) => EffectRuntime.Effect<{
    readonly agent: string
    readonly agentFound: boolean
    readonly effect: Permission.Effect
    readonly exactGranted: boolean
    readonly segments: ReadonlyArray<{
      readonly resource: string
      readonly effect: Permission.Effect
      readonly rule: Permission.Rule
    }>
  }>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/v2/Permission") {}

interface Pending {
  readonly claim: SessionLifecycle.Claim
  review?: NonNullable<Request["review"]>
  work?: {
    stale: boolean
    finished: boolean
    release?: () => void
    fiber?: Fiber.Fiber<void>
  }
  readonly inherited: readonly Authority[]
  readonly hook?: HookObserver.Invocation
  readonly request: Request
  readonly agent?: AgentV2.ID
  readonly deferred: Deferred.Deferred<void, DeclinedError | CorrectedError>
}

const layer = Layer.effect(
  Service,
  EffectRuntime.gen(function* () {
    const hookSnapshots = yield* SessionHookSnapshot.Service
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const agents = yield* AgentV2.Service
    const sessions = yield* SessionStore.Service
    const saved = yield* PermissionSaved.Service
    const lifecycle = yield* SessionLifecycle.Service
    const reviewState = yield* PermissionReviewState.Service
    const reviewer = yield* PermissionReview.Service
    const database = yield* Database.Service
    const pending = new Map<ID, Pending>()
    const scope = yield* Scope.Scope

    const savedRules = EffectRuntime.fnUntraced(function* () {
      return (yield* saved.list({ projectID: location.project.id })).map(
        (item): Permission.Rule => ({
          action: item.action,
          resource: item.resource,
          effect: "allow",
        }),
      )
    })

    const configured = EffectRuntime.fn("PermissionV2.configured")(function* (
      sessionID: SessionV2.ID,
      agentID?: AgentV2.ID,
    ) {
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new SessionV2.NotFoundError({ sessionID })
      const agent = yield* agents.resolve(agentID ?? session.agent)
      return agent?.permissions ?? missingAgentPermissions
    })

    function denied(input: Pick<AssertInput, "action" | "resources">, rules: Permission.Ruleset) {
      return input.resources.some((resource) => evaluate(input.action, resource, rules).effect === "deny")
    }

    function relevant(input: AssertInput, rules: Permission.Ruleset) {
      return rules.filter((rule) =>
        Wildcard.match(PermissionV1.canonicalPermission(input.action), PermissionV1.canonicalPermission(rule.action)),
      )
    }

    const authority = EffectRuntime.fnUntraced(function* (sessionID: SessionV2.ID, agent?: AgentV2.ID) {
      const rules = yield* configured(sessionID, agent)
      const sessionRules = ((yield* sessions.permissions(sessionID)) ?? []).map((rule) => ({
        action: PermissionV1.canonicalPermission(rule.permission),
        resource: rule.pattern,
        effect: rule.action,
      }))
      return {
        rules,
        all: [...rules, ...sessionRules, ...(yield* savedRules())],
        consent: sessionRules,
        inherited: (yield* Inherited).get(sessionID) ?? [],
      }
    })

    function assess(
      input: Pick<AssertInput, "action" | "resources">,
      snapshot: EffectRuntime.Success<ReturnType<typeof authority>>,
    ) {
      if (denied(input, snapshot.rules)) return { effect: "deny" as const, rules: snapshot.rules }
      const effects = input.resources.flatMap((resource) => {
        const child = evaluate(input.action, resource, snapshot.all).effect
        const inherited = snapshot.inherited.map((parent) =>
          denied({ action: input.action, resources: [resource] }, parent.rules)
            ? ("deny" as const)
            : evaluate(input.action, resource, parent.all).effect,
        )
        if (inherited.includes("deny")) return ["deny" as const]
        // A scoped child approval can satisfy a captured ask, but can never lift a deny.
        if (inherited.includes("ask") && evaluate(input.action, resource, snapshot.consent).effect !== "allow")
          return [child, "ask" as const]
        return [child]
      })
      const effect: Permission.Effect = effects.includes("deny") ? "deny" : effects.includes("ask") ? "ask" : "allow"
      return { effect, rules: [...snapshot.all, ...snapshot.inherited.flatMap((parent) => parent.all)] }
    }

    const capture = EffectRuntime.fn("PermissionV2.capture")(function* (sessionID: SessionV2.ID, agent?: AgentV2.ID) {
      const snapshot = yield* authority(sessionID, agent)
      return structuredClone([{ rules: snapshot.rules, all: snapshot.all }, ...snapshot.inherited])
    })

    const inspect = EffectRuntime.fn("PermissionV2.inspect")(function* (sessionID: SessionV2.ID, agent?: AgentV2.ID) {
      const snapshot = yield* authority(sessionID, agent)
      return (action: string, resources: readonly string[]) => assess({ action, resources }, snapshot).effect
    })

    const exact = EffectRuntime.fn("PermissionV2.exact")(function* (
      sessionID: SessionV2.ID,
      action: string,
      resource: string,
    ) {
      const canonical = PermissionV1.canonicalPermission(action)
      const sessionRules = ((yield* sessions.permissions(sessionID)) ?? []).map((rule) => ({
        action: PermissionV1.canonicalPermission(rule.permission),
        resource: rule.pattern,
        effect: rule.action,
      }))
      return [...sessionRules, ...(yield* savedRules())].some(
        (rule) =>
          rule.effect === "allow" &&
          rule.resource === resource &&
          PermissionV1.canonicalPermission(rule.action) === canonical,
      )
    })

    const evaluateInput = EffectRuntime.fn("PermissionV2.evaluateInput")(function* (input: AssertInput) {
      const snapshot = yield* authority(input.sessionID, input.agent)
      const result = assess(input, snapshot)
      const policy = yield* SessionExecutionPolicy.forSession(input.sessionID)
      if (!policy || result.effect === "deny") return result
      const action = PermissionV1.canonicalPermission(input.action)
      if (SessionExecutionPolicy.unsupported.has(action)) return { ...result, effect: "deny" as const }
      if (result.effect !== "ask") return result
      if (action === "doom_loop") return { ...result, effect: "deny" as const }
      return { ...result, effect: policy.permissions === "approve_once" ? ("allow" as const) : ("deny" as const) }
    })

    function request(input: AssertInput): Request {
      return {
        id: input.id ?? ID.create(),
        sessionID: input.sessionID,
        action: PermissionV1.canonicalPermission(input.action),
        resources: input.resources,
        save: input.save,
        metadata: input.metadata,
        source: input.source,
      }
    }

    const view = (item: Pending): Request => ({ ...item.request, ...(item.review ? { review: item.review } : {}) })
    const finishReview = (
      item: Pending,
      outcome: "allowed_once" | "ask_manual" | "superseded",
      reason: string,
      model?: string,
    ) =>
      EffectRuntime.gen(function* () {
        if (!item.work || item.work.finished) return
        item.work.finished = true
        item.work.release?.()
        if (outcome !== "allowed_once") item.review = { status: "ask_manual", reason }
        yield* events.publish(PermissionReview.Event.Settled, {
          sessionID: item.request.sessionID,
          requestID: item.request.id,
          outcome,
          reason,
          ...(model ? { model } : {}),
        })
      })
    const stopReview = (item: Pending) =>
      EffectRuntime.gen(function* () {
        if (!item.work) return
        item.work.stale = true
        yield* finishReview(item, "superseded", "Permission was settled or cancelled")
      })
    const joinReview = (item: Pending) =>
      item.work?.fiber ? Fiber.interrupt(item.work.fiber).pipe(EffectRuntime.asVoid) : EffectRuntime.void
    const cancel = (item: Pending) =>
      reviewState
        .settle(
          item.claim,
          EffectRuntime.gen(function* () {
            if (pending.get(item.request.id) !== item) return
            yield* stopReview(item)
            pending.delete(item.request.id)
            yield* Deferred.fail(item.deferred, new DeclinedError())
            yield* events.publish(Event.Replied, {
              sessionID: item.request.sessionID,
              requestID: item.request.id,
              reply: "reject",
            })
          }),
        )
        .pipe(
          EffectRuntime.catchTag("SessionLifecycle.Closed", () => EffectRuntime.void),
          EffectRuntime.andThen(joinReview(item)),
        )

    yield* EffectRuntime.addFinalizer(() => EffectRuntime.forEach([...pending.values()], cancel, { discard: true }))

    const review = (
      item: Pending,
      action: PermissionReviewContext.Action,
      state: PermissionReview.State,
      admittedSeq: number,
    ) =>
      EffectRuntime.gen(function* () {
        const evidence = yield* PermissionReviewContext.instructions(database.db, item.request.sessionID)
        const captured = yield* action.capture
        if (item.work?.stale || pending.get(item.request.id) !== item) return
        const result = yield* reviewer.review(item.request.sessionID, captured.facts, evidence)
        yield* reviewState.settle(
          item.claim,
          EffectRuntime.gen(function* () {
            if (pending.get(item.request.id) !== item || item.work?.finished) return
            const mode = yield* reviewState.get(item.request.sessionID)
            const sequence = yield* PermissionReviewContext.admissionSequence(database.db, item.request.sessionID)
            if (
              item.work?.stale ||
              !lifecycle.available(item.claim) ||
              mode.mode !== "review" ||
              mode.revision !== state.revision ||
              sequence !== admittedSeq
            ) {
              yield* finishReview(item, "superseded", "Instructions or review mode changed", result.model)
              return
            }
            if (result.decision !== "allow_once") {
              yield* finishReview(item, "ask_manual", result.reason, result.model)
              return
            }
            const current = yield* authority(item.request.sessionID, item.agent)
            if (assess(item.request, { ...current, inherited: item.inherited }).effect === "deny") {
              yield* finishReview(item, "ask_manual", "Current permission policy blocks this action", result.model)
              return
            }
            const fresh = yield* action.capture
            const instructions = yield* PermissionReviewContext.instructions(database.db, item.request.sessionID)
            if (
              captured.fingerprint !== fresh.fingerprint ||
              JSON.stringify(instructions) !== JSON.stringify(evidence)
            ) {
              yield* finishReview(item, "superseded", "Execution scope or effective instructions changed", result.model)
              return
            }
            yield* finishReview(item, "allowed_once", result.reason, result.model)
            yield* events.publish(Event.Replied, {
              sessionID: item.request.sessionID,
              requestID: item.request.id,
              reply: "once",
            })
            pending.delete(item.request.id)
            yield* Deferred.succeed(item.deferred, undefined)
          }),
        )
      }).pipe(
        EffectRuntime.catch((error) =>
          reviewState
            .settle(
              item.claim,
              EffectRuntime.gen(function* () {
                if (pending.get(item.request.id) !== item) return
                yield* finishReview(
                  item,
                  item.work?.stale ? "superseded" : "ask_manual",
                  error instanceof Error ? error.message : "Review unavailable; manual approval required",
                )
              }),
            )
            .pipe(EffectRuntime.catchTag("SessionLifecycle.Closed", () => EffectRuntime.void)),
        ),
      )

    const create = (request: Request, agent?: AgentV2.ID) =>
      EffectRuntime.uninterruptible(
        EffectRuntime.gen(function* () {
          const claim = yield* lifecycle.capture(request.sessionID).pipe(EffectRuntime.orDie)
          const current = yield* HookObserver.CurrentTool
          const hook =
            current?.sessionID === request.sessionID && current.callID === request.source?.callID ? current : undefined
          const action = yield* PermissionReviewContext.CurrentAction
          const eligible = (yield* PermissionReviewContext.Interactive) && !!hook
          const created = yield* reviewState
            .settle(
              claim,
              EffectRuntime.gen(function* () {
                const state = yield* reviewState.get(request.sessionID)
                const item: Pending = {
                  request,
                  agent,
                  claim,
                  deferred: yield* Deferred.make<void, DeclinedError | CorrectedError>(),
                  hook,
                  inherited: (yield* Inherited).get(request.sessionID) ?? [],
                }
                if (pending.has(request.id))
                  return yield* EffectRuntime.die(`Duplicate pending permission ID: ${request.id}`)
                const reviewing = eligible && state.mode === "review"
                if (reviewing) {
                  item.review = { status: "reviewing" }
                  item.work = { stale: false, finished: false }
                  item.work.release = yield* reviewState.watch(claim, item, () => {
                    if (item.work) item.work.stale = true
                    return reviewState
                      .settle(claim, finishReview(item, "superseded", "Instructions or review mode changed"))
                      .pipe(
                        EffectRuntime.catchTag("SessionLifecycle.Closed", () => EffectRuntime.void),
                        EffectRuntime.andThen(joinReview(item)),
                      )
                  })
                }
                pending.set(request.id, item)
                yield* events
                  .publish(Event.Asked, view(item))
                  .pipe(EffectRuntime.onError(() => EffectRuntime.sync(() => pending.delete(request.id))))
                if (reviewing)
                  yield* events.publish(PermissionReview.Event.Started, {
                    sessionID: request.sessionID,
                    requestID: request.id,
                  })
                return {
                  item,
                  state,
                  admittedSeq: yield* PermissionReviewContext.admissionSequence(database.db, request.sessionID),
                }
              }),
            )
            .pipe(EffectRuntime.orDie)
          if (created.item.work) {
            const work =
              action?.sessionID === request.sessionID && action.callID === hook?.callID
                ? review(created.item, action, created.state, created.admittedSeq)
                : reviewState
                    .settle(
                      claim,
                      finishReview(created.item, "ask_manual", "No verified execution scope; manual approval required"),
                    )
                    .pipe(EffectRuntime.orDie)
            created.item.work.fiber = yield* work.pipe(EffectRuntime.forkIn(scope))
          }
          const snapshot = yield* hookSnapshots.get(request.sessionID)
          yield* HookObserver.observe({
            registry: snapshot?.registry,
            selection: snapshot?.selection,
            directory: location.directory,
            sessionID: request.sessionID,
            event: "Notification",
            matcher: "permission_prompt",
            payload: {
              notificationType: "permission_prompt",
              notification_type: "permission_prompt",
              message: `Approval required for ${request.action}`,
              title: "Permission required",
              level: "info",
            },
          }).pipe(EffectRuntime.forkIn(scope))
          return created.item
        }),
      )

    const reportDenied = EffectRuntime.fnUntraced(function* (input: AssertInput, captured?: HookObserver.Invocation) {
      const hook = captured ?? (yield* HookObserver.CurrentTool)
      if (!hook || hook.sessionID !== input.sessionID || hook.callID !== input.source?.callID) return
      const snapshot = yield* hookSnapshots.get(input.sessionID)
      yield* HookObserver.observe({
        registry: snapshot?.registry,
        selection: snapshot?.selection,
        directory: location.directory,
        sessionID: input.sessionID,
        event: "PermissionDenied",
        matcher: hook.toolName,
        payload: HookObserver.deniedPayload(hook),
      })
    })

    const ask = EffectRuntime.fn("PermissionV2.ask")(function* (input: AssertInput) {
      const result = yield* evaluateInput(input)
      const value = request(input)
      if (result.effect === "ask") yield* create(value, input.agent)
      if (result.effect === "deny") yield* reportDenied(input)
      return { id: value.id, effect: result.effect }
    })

    const assert = EffectRuntime.fn("PermissionV2.assert")((input: AssertInput) =>
      EffectRuntime.uninterruptibleMask((restore) =>
        EffectRuntime.gen(function* () {
          const result = yield* evaluateInput(input)
          if (result.effect === "deny") {
            yield* reportDenied(input)
            return yield* new BlockedError({
              rules: relevant(input, result.rules),
            })
          }
          if (result.effect === "allow") return
          const item = yield* create(request(input), input.agent)
          return yield* restore(Deferred.await(item.deferred)).pipe(
            EffectRuntime.catchTag("PermissionV2.DeclinedError", (error) => EffectRuntime.die(error)),
            EffectRuntime.ensuring(cancel(item)),
          )
        }),
      ),
    )

    const reply = EffectRuntime.fn("PermissionV2.reply")((input: ReplyInput) =>
      EffectRuntime.uninterruptible(
        EffectRuntime.gen(function* () {
          const existing = pending.get(input.requestID)
          if (!existing) return yield* new NotFoundError({ requestID: input.requestID })
          const settled = yield* reviewState
            .settle(
              existing.claim,
              EffectRuntime.gen(function* () {
                if (pending.get(input.requestID) !== existing)
                  return yield* new NotFoundError({ requestID: input.requestID })
                const current =
                  input.reply === "reject"
                    ? undefined
                    : yield* authority(existing.request.sessionID, existing.agent).pipe(
                        EffectRuntime.catchTag("Session.NotFoundError", () => EffectRuntime.succeed(undefined)),
                      )
                const rejected =
                  input.reply === "reject" ||
                  !lifecycle.available(existing.claim) ||
                  !current ||
                  assess(existing.request, { ...current, inherited: existing.inherited }).effect === "deny"
                const chosen =
                  input.save && BashApproval.offered(existing.request.metadata, input.save)
                    ? input.save
                    : existing.request.save
                const affected = rejected
                  ? [...pending.values()].filter((item) => item.request.sessionID === existing.request.sessionID)
                  : [existing]
                if (!rejected && input.reply === "always" && chosen?.length) {
                  yield* sessions.setPermissions({
                    sessionID: existing.request.sessionID,
                    permissions: [
                      ...((yield* sessions.permissions(existing.request.sessionID)) ?? []),
                      ...chosen.map((resource) => ({
                        permission: existing.request.action,
                        pattern: resource,
                        action: "allow" as const,
                      })),
                    ],
                  })
                  if (!existing.inherited.length)
                    yield* saved.add({
                      projectID: location.project.id,
                      action: existing.request.action,
                      resources: chosen,
                    })
                }
                for (const item of affected) {
                  yield* stopReview(item)
                  yield* events.publish(Event.Replied, {
                    sessionID: item.request.sessionID,
                    requestID: item.request.id,
                    reply: rejected ? "reject" : input.reply,
                  })
                  pending.delete(item.request.id)
                  if (rejected) {
                    yield* reportDenied(item.request, item.hook)
                    yield* Deferred.fail(
                      item.deferred,
                      item === existing && input.message
                        ? new CorrectedError({ feedback: input.message })
                        : new DeclinedError(),
                    )
                    continue
                  }
                  yield* Deferred.succeed(item.deferred, undefined)
                }
                return { affected, saved: !rejected && input.reply === "always" && !!chosen?.length }
              }),
            )
            .pipe(
              EffectRuntime.catchTag(
                "SessionLifecycle.Closed",
                () => new NotFoundError({ requestID: input.requestID }),
              ),
            )
          yield* EffectRuntime.forEach(settled.affected, joinReview, { discard: true })
          if (!settled.saved) return
          // Project-wide grants may settle other Sessions. Acquire one Session gate at a time.
          for (const item of [...pending.values()]) {
            if (existing.inherited.length && item.request.sessionID !== existing.request.sessionID) continue
            yield* reviewState
              .settle(
                item.claim,
                EffectRuntime.gen(function* () {
                  if (pending.get(item.request.id) !== item || !lifecycle.available(item.claim)) return
                  const current = yield* authority(item.request.sessionID, item.agent).pipe(
                    EffectRuntime.catchTag("Session.NotFoundError", () => EffectRuntime.succeed(undefined)),
                  )
                  if (!current || assess(item.request, { ...current, inherited: item.inherited }).effect !== "allow")
                    return
                  yield* stopReview(item)
                  yield* events.publish(Event.Replied, {
                    sessionID: item.request.sessionID,
                    requestID: item.request.id,
                    reply: "always",
                  })
                  pending.delete(item.request.id)
                  yield* Deferred.succeed(item.deferred, undefined)
                }),
              )
              .pipe(EffectRuntime.catchTag("SessionLifecycle.Closed", () => EffectRuntime.void))
            if (!pending.has(item.request.id)) yield* joinReview(item)
          }
        }),
      ),
    )

    const list = EffectRuntime.fn("PermissionV2.list")(function* () {
      return Array.from(pending.values(), view)
    })

    const get = EffectRuntime.fn("PermissionV2.get")(function* (id: ID) {
      const item = pending.get(id)
      return item ? view(item) : undefined
    })

    const forSession = EffectRuntime.fn("PermissionV2.forSession")(function* (sessionID: SessionV2.ID) {
      return Array.from(pending.values(), view).filter((request) => request.sessionID === sessionID)
    })

    const evaluateOffline = EffectRuntime.fn("PermissionV2.evaluateOffline")(function* (input: {
      readonly action: string
      readonly resources: readonly string[]
      readonly exactResource?: string
      readonly agent?: AgentV2.ID | string
    }) {
      const defaultAgent = yield* agents.default()
      const requested = input.agent ?? defaultAgent?.id ?? AgentV2.defaultID
      const resolved = yield* agents.resolve(requested)
      const rules = resolved?.permissions ?? missingAgentPermissions
      const savedList = yield* savedRules()
      const all = [...rules, ...savedList]
      const canonical = PermissionV1.canonicalPermission(input.action)
      const wholeConfigured =
        input.exactResource !== undefined ? evaluate(input.action, input.exactResource, rules) : undefined
      const wholeAll = input.exactResource !== undefined ? evaluate(input.action, input.exactResource, all) : undefined
      const wholeDeniedRule =
        wholeConfigured?.effect === "deny" ? wholeConfigured : wholeAll?.effect === "deny" ? wholeAll : undefined
      if (wholeDeniedRule && input.exactResource !== undefined) {
        return {
          agent: resolved?.id ?? String(requested),
          agentFound: resolved !== undefined,
          effect: "deny" as const,
          exactGranted: false,
          segments: [{ resource: input.exactResource, effect: "deny" as const, rule: wholeDeniedRule }],
        }
      }
      const trimmedExact = input.exactResource?.trim()
      const exactGranted =
        trimmedExact !== undefined &&
        !denied(input, rules) &&
        !input.resources.some((resource) => evaluate(input.action, resource, all).effect === "deny") &&
        savedList.some(
          (rule) =>
            rule.effect === "allow" &&
            rule.resource === trimmedExact &&
            PermissionV1.canonicalPermission(rule.action) === canonical,
        )
      const segments = input.resources.map((resource) => {
        const configuredRule = evaluate(input.action, resource, rules)
        const rule = configuredRule.effect === "deny" ? configuredRule : evaluate(input.action, resource, all)
        return {
          resource,
          effect: exactGranted ? ("allow" as const) : rule.effect,
          rule,
        }
      })
      const effect: Permission.Effect = segments.some((item) => item.effect === "deny")
        ? "deny"
        : segments.some((item) => item.effect === "ask")
          ? "ask"
          : "allow"
      return {
        agent: resolved?.id ?? String(requested),
        agentFound: resolved !== undefined,
        effect,
        exactGranted,
        segments,
      }
    })

    return Service.of({ capture, inspect, exact, ask, assert, reply, get, forSession, list, evaluateOffline })
  }),
)

export const locationLayer = layer.pipe(Layer.provideMerge(AgentV2.locationLayer))

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    SessionHookSnapshot.node,
    EventV2.node,
    Location.node,
    AgentV2.node,
    SessionStore.node,
    PermissionSaved.node,
    PermissionReviewState.node,
    PermissionReview.node,
    SessionLifecycle.node,
    Database.node,
  ],
})
