export * as McpElicitation from "./mcp-elicitation"

import { McpElicitation } from "@apexo/schema/mcp-elicitation"
import { Context, Deferred, Effect, FiberSet, Layer, Schema } from "effect"
import { makeLocationNode } from "./effect/app-node"
import { EventV2 } from "./event"
import { Location } from "./location"
import { SessionLifecycle } from "./session/lifecycle"
import { SessionSchema } from "./session/schema"
import { McpElicitationForm } from "./mcp-elicitation-form"

export { ID, Request, Reply, Event } from "@apexo/schema/mcp-elicitation"

/** Only the native runner supplies this; a permission preference is not operator presence. */
export const Interactive = Context.Reference<boolean>("@apexo/McpElicitation/Interactive", {
  defaultValue: () => false,
})
export class Failure extends Schema.TaggedErrorClass<Failure>()("McpElicitation.Failure", {
  code: Schema.Literals(["invalid", "missing", "conflict", "unavailable"]),
  message: Schema.String,
  field: Schema.optional(Schema.String),
}) {}
const invalid = (error: unknown) =>
  new Failure({
    code: "invalid",
    message: error instanceof McpElicitationForm.Invalid ? error.message : "Invalid MCP form data",
    ...(error instanceof McpElicitationForm.Invalid && error.field !== undefined ? { field: error.field } : {}),
  })
type Pending = {
  request: McpElicitation.Request
  invocation: object
  claim: SessionLifecycle.Claim
  deferred: Deferred.Deferred<McpElicitation.Reply>
}
const make = Effect.gen(function* () {
  const events = yield* EventV2.Service
  const location = yield* Location.Service
  const lifecycle = yield* SessionLifecycle.Service
  const pending = new Map<McpElicitation.ID, Pending>()
  const settled = new Map<McpElicitation.ID, { sessionID: SessionSchema.ID; action: McpElicitation.Reply["action"] }>()
  const run = yield* FiberSet.makeRuntime<never, void, never>()
  const finish = (entry: Pending, reply: McpElicitation.Reply, reason: McpElicitation.Reason) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        if (pending.get(entry.request.id) !== entry) return
        pending.delete(entry.request.id)
        settled.set(entry.request.id, { sessionID: entry.request.sessionID, action: reply.action })
        if (settled.size > 100) settled.delete(settled.keys().next().value!)
        yield* events.publish(
          McpElicitation.Event.Settled,
          {
            sessionID: entry.request.sessionID,
            requestID: entry.request.id,
            server: entry.request.server,
            action: reply.action,
            reason,
          },
          { location },
        )
        yield* Deferred.succeed(entry.deferred, reply)
      }),
    )
  yield* Effect.addFinalizer(() =>
    Effect.forEach([...pending.values()], (entry) => finish(entry, { action: "cancel" }, "disconnected"), {
      discard: true,
    }),
  )
  return {
    ask: (input: {
      sessionID: SessionSchema.ID
      assistantMessageID: string
      toolCallID: string
      server: string
      message: string
      schema: unknown
      invocation: object
      claim: SessionLifecycle.Claim
      signal: AbortSignal
      ownerSignal: AbortSignal
      deadlineAt: number
      pause: () => void
      resume: () => void
      abort: (reason: "timed_out" | "interrupted") => void
    }) =>
      Effect.scoped(
        Effect.gen(function* () {
          if (!lifecycle.available(input.claim) || input.signal.aborted || input.ownerSignal.aborted)
            return yield* new Failure({ code: "unavailable", message: "The MCP invocation is no longer active" })
          if ([...pending.values()].some((entry) => entry.invocation === input.invocation))
            return yield* new Failure({ code: "conflict", message: "An MCP form is already pending for this call" })
          const form = yield* Effect.try({ try: () => McpElicitationForm.parse(input.schema), catch: invalid })
          const request = McpElicitation.Request.make({
            id: McpElicitation.ID.create(),
            sessionID: input.sessionID,
            assistantMessageID: input.assistantMessageID,
            toolCallID: input.toolCallID,
            server: input.server,
            message: input.message,
            form,
            createdAt: Date.now(),
            deadlineAt: input.deadlineAt,
            status: "pending",
          })
          const entry: Pending = {
            request,
            invocation: input.invocation,
            claim: input.claim,
            deferred: yield* Deferred.make<McpElicitation.Reply>(),
          }
          pending.set(request.id, entry)
          input.pause()
          const interrupt = () =>
            finish(entry, { action: "cancel" }, "interrupted").pipe(
              Effect.andThen(Effect.sync(() => input.abort("interrupted"))),
            )
          const release = yield* lifecycle.register(input.claim, entry, interrupt()).pipe(
            Effect.mapError(() => new Failure({ code: "unavailable", message: "The MCP Session is no longer active" })),
            Effect.onError(() => finish(entry, { action: "cancel" }, "interrupted")),
          )
          const serverCancel = () => run(finish(entry, { action: "cancel" }, "server_cancelled"))
          const ownerCancel = () =>
            run(
              finish(
                entry,
                { action: "cancel" },
                input.ownerSignal.reason === "timed_out" ? "timed_out" : "interrupted",
              ),
            )
          const timer = setTimeout(
            () => {
              input.abort("timed_out")
              run(finish(entry, { action: "cancel" }, "timed_out"))
            },
            Math.max(0, input.deadlineAt - Date.now()),
          )
          input.signal.addEventListener("abort", serverCancel, { once: true })
          input.ownerSignal.addEventListener("abort", ownerCancel, { once: true })
          yield* Effect.addFinalizer(() =>
            finish(entry, { action: "cancel" }, "call_completed").pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  release()
                  clearTimeout(timer)
                  input.signal.removeEventListener("abort", serverCancel)
                  input.ownerSignal.removeEventListener("abort", ownerCancel)
                  input.resume()
                }),
              ),
            ),
          )
          if (input.signal.aborted) yield* finish(entry, { action: "cancel" }, "server_cancelled")
          if (input.ownerSignal.aborted) yield* finish(entry, { action: "cancel" }, "interrupted")
          if (pending.has(request.id)) yield* events.publish(McpElicitation.Event.Requested, request, { location })
          return yield* Deferred.await(entry.deferred).pipe(Effect.onInterrupt(interrupt))
        }),
      ),
    list: (sessionID: SessionSchema.ID) =>
      Effect.sync(() =>
        [...pending.values()]
          .filter((entry) => entry.request.sessionID === sessionID && lifecycle.available(entry.claim))
          .map((entry) => entry.request),
      ),
    reply: (sessionID: SessionSchema.ID, requestID: McpElicitation.ID, input: unknown) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const decoded = yield* Effect.try({ try: () => McpElicitationForm.decodeReply(input), catch: invalid })
          const previous = settled.get(requestID)
          if (previous?.sessionID === sessionID) {
            if (previous.action !== decoded.action)
              return yield* new Failure({ code: "conflict", message: "This MCP form already has a different reply" })
            settled.delete(requestID)
            settled.set(requestID, previous)
            return
          }
          const entry = pending.get(requestID)
          if (!entry || entry.request.sessionID !== sessionID || !lifecycle.available(entry.claim))
            return yield* new Failure({ code: "missing", message: "MCP form is no longer pending" })
          if (Date.now() >= entry.request.deadlineAt)
            return yield* new Failure({ code: "missing", message: "MCP form has expired" })
          const reply = yield* Effect.try({
            try: () => McpElicitationForm.validate(entry.request.form, decoded),
            catch: invalid,
          })
          yield* finish(entry, reply, reply.action === "cancel" ? "dismissed" : "replied")
        }),
      ),
    cancelInvocation: (invocation: object, reason: McpElicitation.Reason = "call_completed") =>
      Effect.forEach(
        [...pending.values()].filter((entry) => entry.invocation === invocation),
        (entry) => finish(entry, { action: "cancel" }, reason),
        { discard: true },
      ),
  }
})
export type Interface = Effect.Success<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/McpElicitation") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [EventV2.node, Location.node, SessionLifecycle.node],
})
