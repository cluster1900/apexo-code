import { SessionExecution } from "@apexo/core/session/execution"
import { MemoryNative } from "@apexo/core/memory-native"
import {
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "@apexo/protocol/errors"
import { MemoryForbiddenError } from "@apexo/protocol/groups/memory"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

const boundary = <A>(id: string, work: Effect.Effect<A, MemoryNative.Failure>) =>
  work.pipe(
    Effect.mapError((error) => {
      if (error.code === "missing") return new SessionNotFoundError({ sessionID: id, message: error.message })
      if (error.code === "forbidden" || error.code === "disabled")
        return new MemoryForbiddenError({ message: error.message })
      if (error.code === "invalid") return new InvalidRequestError({ message: error.message })
      if (["busy", "changed", "unsupported"].includes(error.code)) return new ConflictError({ message: error.message })
      return new ServiceUnavailableError({ service: "memory", message: "Memory storage is unavailable" })
    }),
  )
export const MemoryHandler = HttpApiBuilder.group(Api, "server.memory", (handlers) =>
  Effect.gen(function* () {
    const execution = yield* SessionExecution.Service
    return handlers
      .handle("memory.status", ({ params }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          const value = yield* boundary(
            params.sessionID,
            memory.status(params.sessionID, (yield* execution.active).has(params.sessionID)),
          )
          return { ...value.info, backend: value.backend }
        }),
      )
      .handle("memory.toggle", ({ params, payload }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          const value = yield* boundary(
            params.sessionID,
            memory.toggle(params.sessionID, payload.enabled, (yield* execution.active).has(params.sessionID)),
          )
          return { ...value.info, backend: value.backend }
        }),
      )
      .handle("memory.list", ({ params, query }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          return yield* boundary(params.sessionID, memory.list(params.sessionID, query.query))
        }),
      )
      .handle("memory.preview", ({ params, query }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          return yield* boundary(params.sessionID, memory.preview(params.sessionID, query.path))
        }),
      )
      .handle("memory.forget", ({ params, payload }) =>
        Effect.gen(function* () {
          const memory = yield* MemoryNative.Service
          return yield* boundary(params.sessionID, memory.forget(params.sessionID, payload))
        }),
      )
  }),
)
