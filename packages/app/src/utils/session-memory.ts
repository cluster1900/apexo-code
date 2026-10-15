import type { ApexoClient } from "@apexo/sdk/v2/client"

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
  return { ...result, data: result.data! }
}

export function memoryActions(client: ApexoClient, sessionID: string, protocol: Promise<"v1" | "v2">) {
  return {
    status: async (signal: AbortSignal) =>
      (await protocol) === "v2"
        ? checked(await client.v2.memory.status({ sessionID }, { signal, throwOnError: false }), true)
        : client.experimental.memory.status({ sessionID }, { signal, throwOnError: true }),
    toggle: async (enabled: boolean, signal: AbortSignal) =>
      (await protocol) === "v2"
        ? checked(
            await client.v2.memory.toggle(
              { sessionID, memoryModeUpdate: { enabled } },
              { signal, throwOnError: false },
            ),
          )
        : client.experimental.memory.toggle(
            { sessionID, memoryModeUpdate: { enabled } },
            { signal, throwOnError: true },
          ),
    list: async (query: string, signal: AbortSignal) =>
      (await protocol) === "v2"
        ? checked(await client.v2.memory.list({ sessionID, query }, { signal, throwOnError: false }))
        : client.experimental.memory.list({ sessionID, search: query }, { signal, throwOnError: true }),
    get: async (path: string, signal: AbortSignal) =>
      (await protocol) === "v2"
        ? checked(await client.v2.memory.preview({ sessionID, path }, { signal, throwOnError: false }))
        : client.experimental.memory.get({ sessionID, path }, { signal, throwOnError: true }),
    forget: async (memoryNoteForget: { path: string; hash: string }, signal: AbortSignal) =>
      (await protocol) === "v2"
        ? checked(await client.v2.memory.forget({ sessionID, memoryNoteForget }, { signal, throwOnError: false }))
        : client.experimental.memory.forget({ sessionID, memoryNoteForget }, { signal, throwOnError: true }),
  }
}
