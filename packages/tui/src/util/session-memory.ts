import type { ApexoClient } from "@apexo/sdk/v2/client"
import { memoryOperationActions } from "./memory-operations"
import type { MemoryBrowserActions } from "../component/memory-browser"

export class MemoryActionError extends Error {
  constructor(readonly code: "restricted" | "forbidden" | "changed" | "missing" | "unavailable" | "failed") {
    super("Memory management request failed")
  }
}

function checked<T>(result: { data?: T; error?: unknown; response: Response }, status = false) {
  if (result.error || !result.response.ok) {
    const code = result.response.status
    throw new MemoryActionError(
      code === 403
        ? "forbidden"
        : code === 409
          ? status
            ? "restricted"
            : "changed"
          : code === 404
            ? "missing"
            : code === 503
              ? "unavailable"
              : "failed",
    )
  }
  return result.data!
}

export function memoryError(error: unknown, fallback: string) {
  if (!(error instanceof MemoryActionError)) return fallback
  return {
    restricted: "Memory management is unavailable for this managed session. Open its parent session.",
    forbidden: "Memory access is disabled or denied by this session's policy.",
    changed: "Memory state or this note changed. Refresh and review it again before retrying.",
    missing: "This session or note is no longer available.",
    unavailable: "Memory management is temporarily unavailable. Try again later.",
    failed: fallback,
  }[error.code]
}

export function nativeMemoryActions(client: ApexoClient, sessionID: () => Promise<string>): MemoryBrowserActions {
  return {
    native: true,
    operations: (owner) => memoryOperationActions(client, sessionID, owner),
    status: async (signal) =>
      checked(await client.v2.memory.status({ sessionID: await sessionID() }, { signal, throwOnError: false }), true),
    toggle: async (enabled, signal) =>
      checked(
        await client.v2.memory.toggle(
          { sessionID: await sessionID(), memoryModeUpdate: { enabled } },
          { signal, throwOnError: false },
        ),
      ),
    list: async (query, signal) =>
      checked(await client.v2.memory.list({ sessionID: await sessionID(), query }, { signal, throwOnError: false })),
    get: async (path, signal) =>
      checked(await client.v2.memory.preview({ sessionID: await sessionID(), path }, { signal, throwOnError: false })),
    forget: async (memoryNoteForget, signal) =>
      checked(
        await client.v2.memory.forget(
          { sessionID: await sessionID(), memoryNoteForget },
          { signal, throwOnError: false },
        ),
      ),
  }
}
