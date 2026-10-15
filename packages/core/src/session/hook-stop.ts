export * as SessionHookStop from "./hook-stop"

import { and, eq, desc } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { Database } from "../database/database"
import { HostHooks } from "../hooks"
import { HookDispatch } from "../hook-dispatch"
import { HookPreferences } from "../hook-preferences"
import { SystemContext } from "../system-context/index"
import { SessionSchema } from "./schema"
import { SessionMessage } from "./message"
import { MessageID } from "../v1/session"
import { MessageTable, SessionMessageTable, SessionContextEpochTable } from "./sql"
import { SessionHookStopTable } from "./hook-stop.sql"

export const maximumContinuations = 8
const maximumContext = 64 * 1024

type DB = Database.Interface["db"]
export type Input = {
  sessionID: SessionSchema.ID
  messageID: string
  engine: "v1" | "v2"
  directory: string
  enabled: boolean
  continuations: number
  lastAssistantMessage?: string
  // Supplied only by the live Task owner; the child identity is sessionID.
  subagent?: { readonly type: string }
  home?: string
  registry?: HostHooks.Inspection
  selection?: HookPreferences.Selection
}
export type Decision = { continue: boolean; forceStop: boolean; reason?: string }

// The caller owns eligibility: only a normal completion at a live worker or Task idle boundary.
// A claim is durable before external commands run. Interrupted claims are never replayed.
export const evaluate = Effect.fn("SessionHookStop.evaluate")(function* (db: DB, input: Input) {
  if (!input.enabled || input.continuations >= maximumContinuations)
    return { continue: false, forceStop: false } satisfies Decision
  const owner =
    input.engine === "v1"
      ? yield* db
          .select()
          .from(MessageTable)
          .where(
            and(eq(MessageTable.id, MessageID.make(input.messageID)), eq(MessageTable.session_id, input.sessionID)),
          )
          .get()
          .pipe(Effect.orDie)
      : yield* db
          .select()
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.id, SessionMessage.ID.make(input.messageID)),
              eq(SessionMessageTable.session_id, input.sessionID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
  if (
    !owner ||
    (input.engine === "v1" ? record(owner.data).role !== "assistant" : Reflect.get(owner, "type") !== "assistant")
  )
    return { continue: false, forceStop: false } satisfies Decision
  const completion = record(owner.data)
  if (completion.finish !== "stop" || completion.error || typeof record(completion.time).completed !== "number")
    return { continue: false, forceStop: false } satisfies Decision
  const choices = HostHooks.choices(
    input.registry,
    input.subagent ? "SubagentStop" : "Stop",
    input.selection,
    input.subagent?.type,
  )
  if (choices instanceof HookPreferences.Failure) return yield* choices
  const claimed = yield* db
    .insert(SessionHookStopTable)
    .values({
      engine: input.engine,
      message_id: input.messageID,
      session_id: input.sessionID,
      state: "evaluating",
      time_created: (yield* DateTime.nowAsDate).getTime(),
    })
    .onConflictDoNothing()
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (!claimed) return { continue: false, forceStop: false } satisfies Decision
  const decision = yield* Effect.acquireUseRelease(
    Effect.sync(() => {
      const controller = new AbortController()
      return { controller, pending: dispatch({ ...input, selection: () => choices }, controller.signal) }
    }),
    ({ controller, pending }) =>
      Effect.tryPromise({
        try: (signal) => {
          signal.addEventListener("abort", () => controller.abort(), { once: true })
          return pending
        },
        catch: () => new Error("Stop hook discovery or dispatch failed"),
      }),
    ({ controller, pending }) =>
      Effect.promise(async () => {
        controller.abort()
        // Cancellation must join Hook command cleanup before the Task/Session owner settles.
        await pending.catch(() => undefined)
      }),
  ).pipe(Effect.catch(() => Effect.succeed<Decision>({ continue: false, forceStop: false })))
  yield* db
    .update(SessionHookStopTable)
    .set({
      state: decision.continue ? "ready" : "consumed",
      reason: decision.reason ?? null,
      force_stop: decision.forceStop,
    })
    .where(and(eq(SessionHookStopTable.engine, input.engine), eq(SessionHookStopTable.message_id, input.messageID)))
    .run()
    .pipe(Effect.orDie)
  return decision
})

// Snapshot the row before preparing the context epoch, then acknowledge that exact row.
export const pending = Effect.fn("SessionHookStop.pending")(function* (db: DB, sessionID: SessionSchema.ID) {
  return yield* db
    .select()
    .from(SessionHookStopTable)
    .where(and(eq(SessionHookStopTable.session_id, sessionID), eq(SessionHookStopTable.state, "ready")))
    .orderBy(desc(SessionHookStopTable.time_created))
    .get()
    .pipe(Effect.orDie)
})

export const load = Effect.fn("SessionHookStop.load")(function* (db: DB, sessionID: SessionSchema.ID) {
  const row = yield* pending(db, sessionID)
  return { messageID: row?.message_id, engine: row?.engine, context: context(row?.reason ?? "") }
})

export function context(reason: string) {
  return SystemContext.make({
    key: SystemContext.Key.make("session/stop-hook"),
    codec: Schema.toCodecJson(Schema.String),
    load: Effect.succeed(reason),
    baseline: render,
    update: (_previous, current) =>
      current ? render(current) : "The prior Stop hook continuation has been delivered.",
  })
}

export const consume = Effect.fn("SessionHookStop.consume")(function* (
  db: DB,
  sessionID: SessionSchema.ID,
  messageID: string,
  engine: "v1" | "v2",
) {
  if (engine === "v2") {
    const row = yield* pending(db, sessionID)
    const epoch = yield* db
      .select()
      .from(SessionContextEpochTable)
      .where(eq(SessionContextEpochTable.session_id, sessionID))
      .get()
      .pipe(Effect.orDie)
    if (
      !row ||
      row.message_id !== messageID ||
      record(record(epoch?.snapshot)["session/stop-hook"]).value !== row.reason
    )
      return
  }
  yield* db
    .update(SessionHookStopTable)
    .set({ state: "consumed" })
    .where(
      and(
        eq(SessionHookStopTable.session_id, sessionID),
        eq(SessionHookStopTable.message_id, messageID),
        eq(SessionHookStopTable.engine, engine),
        eq(SessionHookStopTable.state, "ready"),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

export function render(reason: string) {
  return reason ? `Trusted local Stop hooks requested continued work:\n${reason}` : "No pending Stop hook continuation."
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function dispatch(input: Input, signal?: AbortSignal): Promise<Decision> {
  const discovered = input.registry
  if (!discovered) return { continue: false, forceStop: false }
  const event = input.subagent ? "SubagentStop" : "Stop"
  const choices = HostHooks.choices(discovered, event, input.selection, input.subagent?.type)
  if (choices instanceof HookPreferences.Failure) throw choices
  const reasons: string[] = []
  const payload = JSON.stringify({
    hook_event_name: event,
    ...(input.subagent
      ? {
          hookEventName: "subagent_stop",
          phase: "gate",
          subagent_id: input.sessionID,
          subagentId: input.sessionID,
          subagent_type: input.subagent.type,
          subagentType: input.subagent.type,
        }
      : {}),
    session_id: input.sessionID,
    cwd: input.directory,
    stop_hook_active: input.continuations > 0,
    stopHookActive: input.continuations > 0,
    last_assistant_message: input.lastAssistantMessage?.slice(0, maximumContext),
    lastAssistantMessage: input.lastAssistantMessage?.slice(0, maximumContext),
  })
  for (const source of discovered.sources) {
    const groups = source.hooks[event]
    if (!Array.isArray(groups)) continue
    for (const [groupIndex, group] of groups.entries()) {
      if (
        input.subagent &&
        typeof record(group).matcher === "string" &&
        !HostHooks.matches(String(record(group).matcher), input.subagent.type)
      )
        continue
      const handlers = record(group).hooks
      if (!Array.isArray(handlers)) continue
      for (const [handlerIndex, handler] of handlers.entries()) {
        if (signal?.aborted) return { continue: false, forceStop: false }
        const hook = record(handler)
        if (
          HostHooks.blocked(
            source,
            hook,
            HostHooks.key(source, event, groupIndex, handlerIndex, hook),
            choices.disabled,
          )
        )
          continue
        const timeout =
          typeof hook.timeout === "number" && Number.isFinite(hook.timeout)
            ? Math.max(100, hook.timeout * 1000)
            : 600_000
        const output = await HookDispatch.run(
          hook,
          payload,
          source.root,
          input.directory,
          timeout,
          source.host,
          event,
          signal,
          HostHooks.name(hook, `${source.name}:${event}:${groupIndex}:${handlerIndex}`),
          source.data,
          source.projectAuthority,
        ).catch(() => "")
        const parsed = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(output)
        if (parsed._tag === "None") continue
        const result = record(parsed.value)
        if (result.continue === false)
          return {
            continue: false,
            forceStop: true,
            reason: typeof result.stopReason === "string" ? result.stopReason.slice(0, maximumContext) : undefined,
          }
        if (result.decision === "block")
          reasons.push(typeof result.reason === "string" ? result.reason : "Stop hook requested continued work.")
        const context = record(result.hookSpecificOutput).additionalContext
        if (typeof context === "string" && context.trim()) reasons.push(context)
      }
    }
  }
  const reason = reasons.join("\n").slice(0, maximumContext)
  return { continue: reason.length > 0, forceStop: false, ...(reason ? { reason } : {}) }
}
