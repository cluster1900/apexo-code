import { SessionExecutionPolicy } from "./session/execution-policy"
import { PermissionAuthority } from "./permission/authority"
import { SessionHookSnapshot } from "./session/hook-snapshot"
export * as PermissionV2 from "./permission"

import { makeLocationNode } from "./effect/app-node"
import { Context, Deferred, Effect as EffectRuntime, Layer, Schema, Scope } from "effect"
import { Permission } from "@apexo/schema/permission"
import { EventV2 } from "./event"
import { Location } from "./location"
import { AgentV2 } from "./agent"
import { SessionV2 } from "./session"
import { SessionStore } from "./session/store"
import { Wildcard } from "./util/wildcard"
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
}

export class Service extends Context.Service<Service, Interface>()("@apexo/v2/Permission") {}

interface Pending {
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
    const pending = new Map<ID, Pending>()
    const scope = yield* Scope.Scope

    yield* EffectRuntime.addFinalizer(() =>
      EffectRuntime.forEach(pending.values(), (item) => Deferred.fail(item.deferred, new DeclinedError()), {
        discard: true,
      }).pipe(
        EffectRuntime.ensuring(
          EffectRuntime.sync(() => {
            pending.clear()
          }),
        ),
      ),
    )

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

    const create = (request: Request, agent?: AgentV2.ID) =>
      EffectRuntime.uninterruptible(
        EffectRuntime.gen(function* () {
          const deferred = yield* Deferred.make<void, DeclinedError | CorrectedError>()
          const current = yield* HookObserver.CurrentTool
          const hook =
            current?.sessionID === request.sessionID && current.callID === request.source?.callID ? current : undefined
          const item = { request, agent, deferred, hook, inherited: (yield* Inherited).get(request.sessionID) ?? [] }
          if (pending.has(request.id)) return yield* EffectRuntime.die(`Duplicate pending permission ID: ${request.id}`)
          pending.set(request.id, item)
          yield* events
            .publish(Event.Asked, request)
            .pipe(EffectRuntime.onError(() => EffectRuntime.sync(() => pending.delete(request.id))))
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
          return item
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
            EffectRuntime.ensuring(
              EffectRuntime.sync(() => {
                pending.delete(item.request.id)
              }),
            ),
          )
        }),
      ),
    )

    const reply = EffectRuntime.fn("PermissionV2.reply")((input: ReplyInput) =>
      EffectRuntime.uninterruptible(
        EffectRuntime.gen(function* () {
          const existing = pending.get(input.requestID)
          if (!existing) return yield* new NotFoundError({ requestID: input.requestID })
          if (input.reply !== "reject") {
            const current = yield* authority(existing.request.sessionID, existing.agent).pipe(
              EffectRuntime.catchTag("Session.NotFoundError", () => EffectRuntime.succeed(undefined)),
            )
            if (!current || assess(existing.request, { ...current, inherited: existing.inherited }).effect === "deny") {
              yield* events.publish(Event.Replied, {
                sessionID: existing.request.sessionID,
                requestID: existing.request.id,
                reply: "reject",
              })
              yield* reportDenied(existing.request, existing.hook)
              yield* Deferred.fail(existing.deferred, new DeclinedError())
              pending.delete(existing.request.id)
              return
            }
          }
          yield* events.publish(Event.Replied, {
            sessionID: existing.request.sessionID,
            requestID: existing.request.id,
            reply: input.reply,
          })

          if (input.reply === "reject") {
            yield* reportDenied(existing.request, existing.hook)
            yield* Deferred.fail(
              existing.deferred,
              input.message ? new CorrectedError({ feedback: input.message }) : new DeclinedError(),
            )
            pending.delete(input.requestID)
            for (const [id, item] of pending) {
              if (item.request.sessionID !== existing.request.sessionID) continue
              yield* events.publish(Event.Replied, {
                sessionID: item.request.sessionID,
                requestID: item.request.id,
                reply: "reject",
              })
              yield* reportDenied(item.request, item.hook)
              yield* Deferred.fail(item.deferred, new DeclinedError())
              pending.delete(id)
            }
            return
          }

          const chosen =
            input.save && BashApproval.offered(existing.request.metadata, input.save)
              ? input.save
              : existing.request.save
          if (input.reply === "always" && chosen?.length) {
            const current = (yield* sessions.permissions(existing.request.sessionID)) ?? []
            yield* sessions.setPermissions({
              sessionID: existing.request.sessionID,
              permissions: [
                ...current,
                ...chosen.map((resource) => ({
                  permission: existing.request.action,
                  pattern: resource,
                  action: "allow" as const,
                })),
              ],
            })
            // Inherited Task consent belongs to this child, never unrelated project tasks.
            if (!existing.inherited.length)
              yield* saved.add({
                projectID: location.project.id,
                action: existing.request.action,
                resources: chosen,
              })
          }
          yield* Deferred.succeed(existing.deferred, undefined)
          pending.delete(input.requestID)
          if (input.reply !== "always" || !chosen?.length) return

          for (const [id, item] of pending) {
            if (existing.inherited.length && item.request.sessionID !== existing.request.sessionID) continue
            const current = yield* authority(item.request.sessionID, item.agent).pipe(
              EffectRuntime.catchTag("Session.NotFoundError", () => EffectRuntime.succeed(undefined)),
            )
            if (!current || assess(item.request, { ...current, inherited: item.inherited }).effect !== "allow") continue
            yield* events.publish(Event.Replied, {
              sessionID: item.request.sessionID,
              requestID: item.request.id,
              reply: "always",
            })
            yield* Deferred.succeed(item.deferred, undefined)
            pending.delete(id)
          }
        }),
      ),
    )

    const list = EffectRuntime.fn("PermissionV2.list")(function* () {
      return Array.from(pending.values(), (item) => item.request)
    })

    const get = EffectRuntime.fn("PermissionV2.get")(function* (id: ID) {
      return pending.get(id)?.request
    })

    const forSession = EffectRuntime.fn("PermissionV2.forSession")(function* (sessionID: SessionV2.ID) {
      return Array.from(pending.values(), (item) => item.request).filter((request) => request.sessionID === sessionID)
    })

    return Service.of({ capture, inspect, exact, ask, assert, reply, get, forSession, list })
  }),
)

export const locationLayer = layer.pipe(Layer.provideMerge(AgentV2.locationLayer))

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [SessionHookSnapshot.node, EventV2.node, Location.node, AgentV2.node, SessionStore.node, PermissionSaved.node],
})
