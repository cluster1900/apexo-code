export * as QuestionV2 from "./question"

import { makeLocationNode } from "./effect/app-node"
import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { Question } from "@apexo/schema/question"
import { EventV2 } from "./event"
import { SessionPlan } from "./session/plan"
import { SessionLifecycle } from "./session/lifecycle"
import { SessionSchema } from "./session/schema"

export const ID = Question.ID
export type ID = typeof ID.Type

export const Option = Question.Option
export type Option = typeof Option.Type

export const Info = Question.Info
export type Info = typeof Info.Type

export const Prompt = Question.Prompt
export type Prompt = typeof Prompt.Type

export const Tool = Question.Tool
export type Tool = typeof Tool.Type

export const Request = Question.Request
export type Request = typeof Request.Type

export const Answer = Question.Answer
export type Answer = typeof Answer.Type

export const Reply = Question.Reply
export type Reply = typeof Reply.Type

export const Event = Question.Event

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("QuestionV2.RejectedError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("QuestionV2.NotFoundError", {
  requestID: ID,
}) {}

export interface AskInput {
  readonly sessionID: SessionSchema.ID
  readonly questions: ReadonlyArray<Info>
  readonly tool?: Tool
}

export interface ReplyInput {
  readonly requestID: ID
  readonly answers: ReadonlyArray<Answer>
}

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<ReadonlyArray<Answer>, RejectedError>
  /** A recovered Plan decision can return a trusted continuation claim. In-process callers must
   * schedule SessionExecution.wake under lifecycle.owned(claim); ordinary/exact replies return undefined. */
  readonly reply: (
    input: ReplyInput,
  ) => Effect.Effect<SessionLifecycle.Claim | undefined, NotFoundError | SessionPlan.Failure>
  readonly reject: (requestID: ID) => Effect.Effect<void, NotFoundError | SessionPlan.Failure>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>, SessionPlan.Failure>
  readonly find: (sessionID: SessionSchema.ID, requestID: ID) => Effect.Effect<Request | undefined, SessionPlan.Failure>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/v2/Question") {}

interface Pending {
  readonly request: Request
  readonly deferred: Deferred.Deferred<ReadonlyArray<Answer>, RejectedError>
}

/**
 * Location-owned pending prompts. The Location layer map must materialize this
 * layer once per embedded Location so replies cannot settle another Location's
 * deferred request.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const plans = yield* SessionPlan.Service
    const pending = new Map<ID, Pending>()

    yield* Effect.addFinalizer(() =>
      Effect.forEach(pending.values(), (item) => Deferred.fail(item.deferred, new RejectedError()), {
        discard: true,
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            pending.clear()
          }),
        ),
      ),
    )

    const ask = Effect.fn("QuestionV2.ask")((input: AskInput) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const id = ID.ascending()
          const deferred = yield* Deferred.make<ReadonlyArray<Answer>, RejectedError>()
          const request: Request = { id, ...input }
          pending.set(id, { request, deferred })
          return yield* events.publish(Event.Asked, request).pipe(
            Effect.andThen(restore(Deferred.await(deferred))),
            Effect.ensuring(
              Effect.sync(() => {
                pending.delete(id)
              }),
            ),
          )
        }),
      ),
    )

    const reply = Effect.fn("QuestionV2.reply")((input: ReplyInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const existing = pending.get(input.requestID)
          if (!existing) {
            const receipt = yield* plans.lookupForReply(input.requestID)
            if (!receipt) return yield* new NotFoundError({ requestID: input.requestID })
            const decision = yield* plans.decide(receipt.sessionID, input.requestID, input.answers)
            return decision?.resume ? decision.claim : undefined
          }
          yield* events.publish(Event.Replied, {
            sessionID: existing.request.sessionID,
            requestID: existing.request.id,
            answers: input.answers.map((answer) => [...answer]),
          })
          yield* Deferred.succeed(existing.deferred, input.answers)
          pending.delete(input.requestID)
        }),
      ),
    )

    const reject = Effect.fn("QuestionV2.reject")((requestID: ID) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const existing = pending.get(requestID)
          if (!existing) {
            const receipt = yield* plans.lookupForReply(requestID)
            if (!receipt) return yield* new NotFoundError({ requestID })
            yield* plans.decide(receipt.sessionID, requestID)
            return
          }
          yield* events.publish(Event.Rejected, {
            sessionID: existing.request.sessionID,
            requestID: existing.request.id,
          })
          yield* Deferred.fail(existing.deferred, new RejectedError())
          pending.delete(requestID)
        }),
      ),
    )

    const list = Effect.fn("QuestionV2.list")(function* () {
      return [...Array.from(pending.values(), (item) => item.request), ...(yield* plans.list())]
    })

    const find = (sessionID: SessionSchema.ID, requestID: ID) =>
      Effect.gen(function* () {
        const request = pending.get(requestID)?.request
        if (request) return request.sessionID === sessionID ? request : undefined
        return (yield* plans.lookup(sessionID, requestID))?.request
      })
    return Service.of({ ask, reply, reject, list, find })
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [EventV2.node, SessionPlan.node] })
