import type { ApexoClient } from "@apexo/sdk/v2/client"

export function serverProtocol(client: ApexoClient) {
  const cache = { current: undefined as Promise<"v1" | "v2"> | undefined }
  return (signal: AbortSignal) =>
    (cache.current ??= (async () => {
      const legacy = await client.global.health({ signal, throwOnError: false })
      if (legacy.data?.healthy) return "v1" as const
      if (!legacy.response) throw legacy.error ?? new Error("Failed to connect to server")
      if (legacy.response.status !== 404) throw new Error("Could not determine the server protocol")
      await client.v2.health.get({ signal, throwOnError: true })
      return "v2" as const
    })().catch((error: unknown) => {
      // A cancelled panel must not poison the next caller's protocol probe.
      cache.current = undefined
      throw error
    }))
}
