import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { SessionSchema } from "@apexo/core/session/schema"
import { HookObserver } from "@apexo/core/hook-observer"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { ConfigPermissionV1 } from "@apexo/core/v1/config/permission"
import { InstanceState } from "@/effect/instance-state"
import { Wildcard } from "@apexo/core/util/wildcard"
import { Deferred, Effect, Layer, Context, Scope } from "effect"
import os from "os"
import { PermissionV1 } from "@apexo/core/v1/permission"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@apexo/core/database/database"
import { SessionTable } from "@apexo/core/session/sql"
import { eq } from "drizzle-orm"
import { BashApproval } from "@apexo/core/tool/bash-approval"

const offeredChoice = BashApproval.offered

export const Event = PermissionV1.Event

export interface Interface {
  readonly ask: (
    input: PermissionV1.AskInput & { force?: boolean; hook?: HookObserver.Invocation },
  ) => Effect.Effect<void, PermissionV1.Error>
  readonly reply: (input: PermissionV1.ReplyInput) => Effect.Effect<void, PermissionV1.NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<PermissionV1.Request>>
}

interface PendingEntry {
  hook?: HookObserver.Invocation
  force?: boolean
  info: PermissionV1.Request
  deferred: Deferred.Deferred<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>
}

interface State {
  scope: Scope.Scope
  pending: Map<PermissionV1.ID, PendingEntry>
  approved: Map<string, PermissionV1.Rule[]>
}

export function evaluate(permission: string, pattern: string, ...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule {
  const canonical = PermissionV1.canonicalPermission(permission)
  return (
    rulesets
      .flat()
      .findLast(
        (rule) =>
          Wildcard.match(canonical, PermissionV1.canonicalPermission(rule.permission)) &&
          Wildcard.match(pattern, rule.pattern),
      ) ?? {
      action: "ask",
      permission: canonical,
      pattern: "*",
    }
  )
}

export class Service extends Context.Service<Service, Interface>()("@apexo/Permission") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hookSnapshots = yield* SessionHookSnapshot.Service
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        void ctx
        const state = {
          scope: yield* Scope.Scope,
          pending: new Map<PermissionV1.ID, PendingEntry>(),
          approved: new Map<string, PermissionV1.Rule[]>(),
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const reportDenied = Effect.fnUntraced(function* (hook: HookObserver.Invocation | undefined) {
      if (!hook) return
      const ctx = yield* InstanceState.context
      const snapshot = yield* hookSnapshots.get(SessionSchema.ID.make(hook.sessionID))
      yield* HookObserver.observe({
        directory: ctx.directory,
        sessionID: hook.sessionID,
        registry: snapshot?.registry,
        selection: snapshot?.selection,
        event: "PermissionDenied",
        matcher: hook.toolName,
        payload: HookObserver.deniedPayload(hook),
      })
    })

    const ask = Effect.fn("Permission.ask")(function* (
      input: PermissionV1.AskInput & { force?: boolean; hook?: HookObserver.Invocation },
    ) {
      const { approved, pending, scope } = yield* InstanceState.get(state)
      const { ruleset, force, hook, ...request } = input
      const sessionKey = String(request.sessionID)
      const persisted = yield* db
        .select({ permission: SessionTable.permission })
        .from(SessionTable)
        .where(eq(SessionTable.id, request.sessionID))
        .get()
        .pipe(Effect.orDie)
      const sessionRules = persisted?.permission ?? []
      const sessionApproved = [
        ...sessionRules.filter((rule) => rule.action === "allow"),
        ...(approved.get(sessionKey) ?? []),
      ]
      const permission = PermissionV1.canonicalPermission(request.permission)
      let needsAsk = false

      for (const pattern of request.patterns) {
        const rule = evaluate(permission, pattern, ruleset, sessionRules, ...(force ? [] : [sessionApproved]))
        yield* Effect.logInfo("evaluated", { permission, pattern, action: rule })
        if (
          rule.action === "deny" ||
          (force && [ruleset, sessionRules].some((rules) => evaluate(permission, pattern, rules).action === "deny"))
        ) {
          yield* reportDenied(hook)
          return yield* new PermissionV1.DeniedError({
            ruleset: ruleset.filter((rule) =>
              Wildcard.match(permission, PermissionV1.canonicalPermission(rule.permission)),
            ),
          })
        }
        if (rule.action === "allow" && !force) continue
        needsAsk = true
      }

      if (!needsAsk) return
      // Grok Build whole_script_grant: an exact grant saved for this whole script (raw text) still replays
      // after per-command reduction. Only literal, exactly-equal allow rules count; wildcards never do.
      const whole = request.metadata?.wholeScript
      if (
        !force &&
        typeof whole === "string" &&
        sessionApproved.some(
          (rule) =>
            rule.action === "allow" &&
            rule.pattern === whole &&
            PermissionV1.canonicalPermission(rule.permission) === permission,
        )
      )
        return

      const id = request.id ?? PermissionV1.ID.ascending()
      const info: PermissionV1.Request = {
        id,
        sessionID: request.sessionID,
        permission,
        patterns: request.patterns,
        metadata: request.metadata,
        always: request.always,
        tool: request.tool,
      }
      yield* Effect.logInfo("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>()
      pending.set(id, { info, deferred, force, hook })
      yield* events.publish(Event.Asked, info)
      const ctx = yield* InstanceState.context
      const snapshot = yield* hookSnapshots.get(info.sessionID)
      yield* HookObserver.observe({
        directory: ctx.directory,
        sessionID: info.sessionID,
        registry: snapshot?.registry,
        selection: snapshot?.selection,
        event: "Notification",
        matcher: "permission_prompt",
        payload: {
          notificationType: "permission_prompt",
          notification_type: "permission_prompt",
          message: `Approval required for ${info.permission}`,
          title: "Permission required",
          level: "info",
        },
      }).pipe(Effect.forkIn(scope))
      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Permission.reply")(function* (input: PermissionV1.ReplyInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const existing = pending.get(input.requestID)
      if (!existing) return yield* new PermissionV1.NotFoundError({ requestID: input.requestID })

      pending.delete(input.requestID)
      yield* events.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })

      if (input.reply === "reject") {
        yield* reportDenied(existing.hook)
        yield* Deferred.fail(
          existing.deferred,
          input.message
            ? new PermissionV1.CorrectedError({ feedback: input.message })
            : new PermissionV1.RejectedError(),
        )

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          pending.delete(id)
          yield* events.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
          })
          yield* reportDenied(item.hook)
          yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
        }
        return
      }

      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return

      const sessionKey = String(existing.info.sessionID)
      const sessionApproved = approved.get(sessionKey) ?? []
      // Scope picker: a chosen save set must be one this request offered; otherwise the default scope persists.
      const always =
        input.always && offeredChoice(existing.info.metadata, input.always) ? input.always : existing.info.always
      for (const pattern of always) {
        sessionApproved.push({
          permission: PermissionV1.canonicalPermission(existing.info.permission),
          pattern,
          action: "allow",
        })
      }
      approved.set(sessionKey, sessionApproved)
      if (always.length > 0) {
        const persisted = yield* db
          .select({ permission: SessionTable.permission })
          .from(SessionTable)
          .where(eq(SessionTable.id, existing.info.sessionID))
          .get()
          .pipe(Effect.orDie)
        if (persisted) {
          yield* db
            .update(SessionTable)
            .set({
              permission: [
                ...(persisted.permission ?? []),
                ...always.map((pattern) => ({
                  permission: PermissionV1.canonicalPermission(existing.info.permission),
                  pattern,
                  action: "allow" as const,
                })),
              ],
              time_updated: Date.now(),
            })
            .where(eq(SessionTable.id, existing.info.sessionID))
            .run()
            .pipe(Effect.orDie)
        }
      }

      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID || item.force) continue
        const ok = item.info.patterns.every(
          (pattern) => evaluate(item.info.permission, pattern, sessionApproved).action === "allow",
        )
        if (!ok) continue
        pending.delete(id)
        yield* events.publish(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "always",
        })
        yield* Deferred.succeed(item.deferred, undefined)
      }
    })

    const list = Effect.fn("Permission.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (item) => item.info)
    })

    return Service.of({ ask, reply, list })
  }),
)

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermissionV1.Info) {
  const ruleset: PermissionV1.Rule[] = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: PermissionV1.canonicalPermission(key), action: value, pattern: "*" })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({
        permission: PermissionV1.canonicalPermission(key),
        pattern: expand(pattern),
        action,
      })),
    )
  }
  return ruleset
}

export function merge(...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule[] {
  return rulesets.flat()
}

export function disabled(tools: string[], ruleset: PermissionV1.Ruleset): Set<string> {
  const edits = ["edit", "write", "apply_patch"]
  const reads = ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]
  return new Set(
    tools.filter((tool) => {
      const permission = PermissionV1.canonicalPermission(
        edits.includes(tool) ? "edit" : reads.includes(tool) ? "read" : tool,
      )
      const rule = ruleset.findLast((rule) =>
        Wildcard.match(permission, PermissionV1.canonicalPermission(rule.permission)),
      )
      return rule?.pattern === "*" && rule.action === "deny"
    }),
  )
}

export function visibleTools<T>(tools: Record<string, T>, ruleset: PermissionV1.Ruleset): Record<string, T> {
  const hidden = disabled(Object.keys(tools), ruleset)
  return Object.fromEntries(Object.entries(tools).filter(([name]) => !hidden.has(name)))
}

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [SessionHookSnapshot.node, EventV2Bridge.node, Database.node],
})

export * as Permission from "."
