import type { ApexoClient } from "./client.js"

export type McpAttachmentRequest = NonNullable<
  Parameters<ApexoClient["v2"]["sessionMcpAttachment"]["reserve"]>[0]["request"]
>
export type McpAttachmentResult = NonNullable<
  Awaited<ReturnType<ApexoClient["v2"]["sessionMcpAttachment"]["execute"]>>["data"]
>

/** One owned operation. Cancellation waits for reservation and joins the server's local owner. */
export function createMcpAttachmentOperation(client: ApexoClient, sessionID: string) {
  const api = client.v2.sessionMcpAttachment
  const observer = new AbortController()
  let cancelled = false
  let reservation: Promise<string> | undefined
  let cancellation: Promise<void> | undefined
  return {
    get cancelled() {
      return cancelled
    },
    async run(request: McpAttachmentRequest) {
      if (reservation || cancelled) throw new Error("MCP attachment operation has already been used")
      // Keep reservation observable during navigation; a lost response can only leave a bounded zero-work lease.
      reservation = api.reserve({ sessionID, request }, { throwOnError: true }).then((result) => result.data.id)
      const operationID = await reservation
      if (cancelled) return
      const result = await api
        .execute({ sessionID, operationID, request }, { signal: observer.signal, throwOnError: true })
        .catch((error: unknown) => {
          if (cancelled) return
          throw error
        })
      if (cancelled || !result) return
      if (result.data.status !== "completed")
        throw new Error(result.data.error?.message ?? "MCP attachment operation did not complete")
      return result.data
    },
    cancel() {
      cancelled = true
      return (cancellation ??= (async () => {
        if (!reservation) return
        const operationID = await reservation
        await api.cancel({ sessionID, operationID }, { throwOnError: true })
        observer.abort()
      })().catch((error: unknown) => {
        cancellation = undefined
        throw error
      }))
    },
  }
}

export function mcpAttachmentParts(text: string, prepared: NonNullable<McpAttachmentResult["prepared"]>) {
  return prepared.files.reduce(
    (result, file) => {
      const value = `@${file.name}`
      const start = result.text.length + 1
      return {
        text: `${result.text} ${value}`,
        parts: [
          ...result.parts,
          {
            type: "file" as const,
            mime: file.mimeType,
            filename: file.name,
            url: file.uri,
            source: {
              type: "file" as const,
              path: prepared.resourceURI,
              text: { start, end: start + value.length, value },
            },
          },
        ],
      }
    },
    {
      text,
      parts: [] as {
        type: "file"
        mime: string
        filename: string
        url: string
        source: { type: "file"; path: string; text: { start: number; end: number; value: string } }
      }[],
    },
  )
}
