import { createApexoClient } from "@apexo/sdk/v2/client"
import { resolveSessionReference, sessionMatches } from "@apexo/sdk/v2/grok-commands"
import { SessionID } from "@/session/schema"
import { Option, Schema } from "effect"
import { sessionTransport } from "@apexo/tui/transport/session"

const decodeSessionID = Schema.decodeUnknownOption(SessionID)

/**
 * Checks `-s/--session` before the terminal starts and returns the session ID to open. Like Grok Build's `--resume`,
 * an ID-shaped value always means an ID; any other value names a top-level session of this project by title (exact,
 * ignoring case, or the same words joined by any separators). A miss or several matches fail instead of guessing.
 */
export async function validateSession(input: {
  url: string
  sessionID?: string
  sessionProtocol?: "auto" | "native" | "compatibility"
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
}) {
  if (!input.sessionID) return

  const client = createApexoClient({
    baseUrl: input.url,
    directory: input.directory,
    fetch: input.fetch,
    headers: input.headers,
  })
  const signal = AbortSignal.timeout(10_000)
  const transport = await sessionTransport(client, input.directory, input.sessionProtocol)(signal)
  const sessionID = decodeSessionID(input.sessionID)
  if (Option.isSome(sessionID)) {
    if (transport.kind === "native") await transport.get(sessionID.value, signal)
    else await client.session.get({ sessionID: sessionID.value }, { signal, throwOnError: true })
    return sessionID.value
  }

  const sessions =
    transport.kind === "native"
      ? (await transport.list(undefined, signal)).data
          .filter((item) => !item.parentID)
          .map((item) => ({ id: item.id, title: item.title }))
      : ((await client.session.list({ roots: true, limit: 1000 }, { signal, throwOnError: true })).data ?? [])
  const found = resolveSessionReference(input.sessionID, sessions)
  if (found) return found.id
  const similar = sessions.filter((item) => sessionMatches(input.sessionID!, item)).slice(0, 5)
  if (similar.length > 1)
    throw new Error(
      `Session "${input.sessionID}" is ambiguous; matching sessions: ${similar.map((item) => `${item.id} (${item.title})`).join(", ")}`,
    )
  throw new Error(`Session not found: no session ID or title matches "${input.sessionID}"`)
}
