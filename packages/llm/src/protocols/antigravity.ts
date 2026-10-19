export * as Antigravity from "./antigravity"

import { Effect, Schema } from "effect"
import { Route } from "../route/client"
import { Auth } from "../route/auth"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Protocol } from "../route/protocol"
import { InvalidRequestReason, LLMError, type LLMRequest } from "../schema"
import { Gemini } from "./gemini"

const Body = Schema.Struct({
  project: Schema.NonEmptyString,
  model: Schema.String,
  userAgent: Schema.Literal("antigravity"),
  requestType: Schema.Literal("agent"),
  requestId: Schema.String,
  request: Schema.Struct({ ...Gemini.GeminiBody.fields, sessionId: Schema.optional(Schema.String) }),
})

const fromRequest = Effect.fn("Antigravity.fromRequest")(function* (request: LLMRequest) {
  const options = request.providerOptions?.antigravity
  if (typeof options?.projectID !== "string" || !options.projectID)
    return yield* new LLMError({
      module: "Antigravity",
      method: "fromRequest",
      reason: new InvalidRequestReason({ message: "The native Antigravity session has no project." }),
    })
  const body = yield* Gemini.protocol.body.from(request)
  return {
    project: options.projectID,
    model: request.model.id,
    userAgent: "antigravity" as const,
    requestType: "agent" as const,
    requestId: crypto.randomUUID(),
    request: { ...body, sessionId: typeof options.sessionID === "string" ? options.sessionID : undefined },
  }
})

export const protocol = Protocol.make({
  id: "antigravity",
  body: { schema: Body, from: fromRequest },
  stream: {
    initial: Gemini.protocol.stream.initial,
    onHalt: Gemini.protocol.stream.onHalt,
    event: Protocol.jsonEvent(Schema.Struct({ response: Gemini.GeminiEvent })),
    step: (state, event) => Gemini.protocol.stream.step(state, event.response),
  },
})

export const route = Route.make({
  id: "antigravity",
  provider: "antigravity",
  protocol,
  endpoint: Endpoint.path("/v1internal:streamGenerateContent?alt=sse", {
    baseURL: "https://daily-cloudcode-pa.googleapis.com",
  }),
  auth: Auth.none,
  defaults: { headers: { "user-agent": "antigravity/cli/1.4.2" } },
  framing: Framing.sse,
})
