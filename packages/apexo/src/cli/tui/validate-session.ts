import { createApexoClient } from "@apexo/sdk/v2/client"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"
import { sessionTransport } from "@apexo/tui/transport/session"

const decodeSessionID = Schema.decodeUnknownSync(SessionID)

export async function validateSession(input: {
  url: string
  sessionID?: string
  sessionProtocol?: "auto" | "native" | "compatibility"
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
}) {
  if (!input.sessionID) return

  let sessionID: SessionID
  try {
    sessionID = decodeSessionID(input.sessionID)
  } catch (error) {
    throw new Error(`Invalid session ID: ${error instanceof Error ? error.message : "unknown error"}`, { cause: error })
  }

  const client = createApexoClient({
    baseUrl: input.url,
    directory: input.directory,
    fetch: input.fetch,
    headers: input.headers,
  })
  const signal = AbortSignal.timeout(10_000)
  const transport = await sessionTransport(client, input.directory, input.sessionProtocol)(signal)
  if (transport.kind === "native") {
    await transport.get(sessionID, signal)
    return
  }
  await client.session.get({ sessionID }, { signal, throwOnError: true })
}
