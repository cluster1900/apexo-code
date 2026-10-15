import { SessionMemoryOperation } from "@apexo/core/session/memory-operation"
import { MemoryOperationNotFoundError } from "@apexo/protocol/groups/memory-operation"
import { MemoryForbiddenError } from "@apexo/protocol/groups/memory"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "@apexo/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

const boundary = <A>(work: Effect.Effect<A, SessionMemoryOperation.Failure>) =>
  work.pipe(
    Effect.mapError((error) => {
      if (error.code === "missing")
        return new MemoryOperationNotFoundError({ message: "Memory operation or Session not found" })
      if (error.code === "denied" || error.code === "unsupported")
        return new MemoryForbiddenError({ message: error.message })
      if (error.code === "invalid") return new InvalidRequestError({ message: error.message })
      if (error.code === "storage")
        return new ServiceUnavailableError({ service: "memory", message: "Memory operation state is unavailable" })
      return new ConflictError({ message: error.message })
    }),
  )
export const MemoryOperationHandler = HttpApiBuilder.group(Api, "server.memoryOperation", (handlers) =>
  Effect.gen(function* () {
    const operations = yield* SessionMemoryOperation.Service
    return handlers
      .handle("memory.retry", ({ params, payload }) => boundary(operations.retry(params.sessionID, payload)))
      .handle("memory.recoveryPreview", ({ params, query }) =>
        boundary(operations.previewRecovery(params.sessionID, query)),
      )
      .handle("memory.recover", ({ params, payload }) => boundary(operations.recover(params.sessionID, payload)))
      .handle("memory.migrationPreview", ({ params, query }) =>
        boundary(operations.previewMigration(params.sessionID, query)),
      )
      .handle("memory.migrate", ({ params, payload }) => boundary(operations.migrate(params.sessionID, payload)))
      .handle("memory.dream", ({ params, payload }) => boundary(operations.dream(params.sessionID, payload)))
      .handle("memory.flush", ({ params, payload }) => boundary(operations.start(params.sessionID, payload)))
      .handle("memory.operations", ({ params }) => boundary(operations.list(params.sessionID)))
      .handle("memory.operation", ({ params }) => boundary(operations.get(params.sessionID, params.operationID)))
      .handle("memory.cancel", ({ params }) => boundary(operations.cancel(params.sessionID, params.operationID)))
  }),
)
