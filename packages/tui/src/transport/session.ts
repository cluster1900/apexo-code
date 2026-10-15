import type { ApexoClient } from "@apexo/sdk/v2"
import { serverProtocol } from "../util/server-protocol"

// Selection is cached by the consumer, so an authenticated native connection
// cannot silently change execution engines after a failed operation.
export function sessionTransport(
  client: ApexoClient,
  directory?: string,
  selection: "auto" | "native" | "compatibility" = "auto",
  owner?: AbortSignal,
) {
  const protocol = serverProtocol(client)
  const cache: { current?: Promise<SessionTransport> } = {}
  return (signal: AbortSignal): Promise<SessionTransport> =>
    (cache.current ??= (async () => {
      if (selection === "native" || (selection === "auto" && (await protocol(signal)) === "v2")) {
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
