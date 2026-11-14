import type { ApexoClient } from "@apexo/sdk/v2"
import { serverProtocol } from "../util/server-protocol"

// Selection is cached by the consumer, so an authenticated native connection
// cannot silently change execution engines after a failed operation.
export function sessionTransport(
  client: ApexoClient,
  directory?: string,
  selection: "auto" | "native" | "compatibility" = "auto",
  owner?: AbortSignal,
  sessionID?: string,
) {
  const protocol = serverProtocol(client)
  const cache: { current?: Promise<SessionTransport> } = {}
  return (signal: AbortSignal): Promise<SessionTransport> =>
    (cache.current ??= (async () => {
      const kind = selection === "auto" ? await protocol(signal) : undefined
      // Mixed hosts share Session records; canonical history establishes native execution.
      const history =
        kind === "v1" && sessionID !== undefined
          ? await client.v2.session.history({ sessionID, limit: 1 }, { signal, throwOnError: false })
          : undefined
      if (history && !history.data && history.response?.status !== 404)
        throw history.error ?? new Error("Could not determine the Session protocol")
      if (selection === "native" || kind === "v2" || !!history?.data?.data.length) {
        const { nativeSessionTransport } = await import("./native-session")
        return nativeSessionTransport(client, directory, owner)
      }
      return { kind: "compatibility" as const, client }
    })().catch((error: unknown) => {
      // A failed initial probe may be retried; a selected transport is never
      // replaced because an operation against it fails.
      cache.current = undefined
      throw error
    }))
}

export type SessionTransport =
  | import("./native-session").NativeSessionTransport
  | { kind: "compatibility"; client: ApexoClient }
