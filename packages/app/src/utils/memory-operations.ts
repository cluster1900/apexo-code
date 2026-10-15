import type { ApexoClient } from "@apexo/sdk/v2/client"
import type { MemoryOperationMigrationPreview, MemoryOperationRecoveryPreview } from "@apexo/sdk/v2"
import { MemoryActionError } from "./session-memory"

export type MemoryOperationCommand =
  | { kind: "flush" | "dream"; id: string }
  | { kind: "retry"; id: string; retryOf: string }
  | { kind: "migration"; id: string; preview: MemoryOperationMigrationPreview }
  | { kind: "recovery"; id: string; preview: MemoryOperationRecoveryPreview }
  | { kind: "cancel"; operationID: string }

function checked<T>(result: { data?: T; error?: unknown; response: Response }) {
  if (result.error || !result.response?.ok) {
    const status = result.response?.status
    throw new MemoryActionError(
      status === 403
        ? "forbidden"
        : status === 409
          ? "changed"
          : status === 404
            ? "missing"
            : status === 503
              ? "unavailable"
              : "failed",
    )
  }
  return result.data!
}

export function memoryOperationActions(client: ApexoClient, sessionID: () => Promise<string>, owner: AbortSignal) {
  // One dialog observes one Session, even when its host can navigate to another.
  const selected: { value?: Promise<string> } = {}
  const context = async (signal: AbortSignal) => {
    const lifetime = AbortSignal.any([owner, signal])
    lifetime.throwIfAborted()
    selected.value ??= sessionID()
    const id = await selected.value
    lifetime.throwIfAborted()
    return { sessionID: id, options: { signal: lifetime, throwOnError: false as const } }
  }
  return {
    list: async (signal: AbortSignal) => {
      const ctx = await context(signal)
      return checked(await client.v2.memory.operations({ sessionID: ctx.sessionID }, ctx.options))
    },
    get: async (operationID: string, signal: AbortSignal) => {
      const ctx = await context(signal)
      return checked(await client.v2.memory.operation({ sessionID: ctx.sessionID, operationID }, ctx.options))
    },
    migrationPreview: async (kind: "relocation" | "carryover", scope: "workspace" | "global", signal: AbortSignal) => {
      const ctx = await context(signal)
      return checked(await client.v2.memory.migrationPreview({ sessionID: ctx.sessionID, kind, scope }, ctx.options))
    },
    recoveryPreview: async (action: "discard" | "clear", scope: "workspace" | "global", signal: AbortSignal) => {
      const ctx = await context(signal)
      return checked(await client.v2.memory.recoveryPreview({ sessionID: ctx.sessionID, action, scope }, ctx.options))
    },
    execute: async (command: MemoryOperationCommand, signal: AbortSignal) => {
      const ctx = await context(signal)
      const sessionID = ctx.sessionID
      if (command.kind === "cancel")
        return checked(await client.v2.memory.cancel({ sessionID, operationID: command.operationID }, ctx.options))
      if (command.kind === "retry")
        return checked(
          await client.v2.memory.retry(
            { sessionID, memoryOperationRetryInput: { id: command.id, retryOf: command.retryOf } },
            ctx.options,
          ),
        )
      if (command.kind === "migration")
        return checked(
          await client.v2.memory.migrate(
            { sessionID, memoryOperationMigrationInput: { id: command.id, preview: command.preview } },
            ctx.options,
          ),
        )
      if (command.kind === "recovery")
        return checked(
          await client.v2.memory.recover(
            { sessionID, memoryOperationRecoveryInput: { id: command.id, preview: command.preview } },
            ctx.options,
          ),
        )
      return checked(
        await client.v2.memory[command.kind]({ sessionID, memoryOperationInput: { id: command.id } }, ctx.options),
      )
    },
  }
}
export type MemoryOperationsActions = ReturnType<typeof memoryOperationActions>
