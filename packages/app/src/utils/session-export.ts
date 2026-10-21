import type { Message, Part, Session } from "@apexo/sdk/v2/client"
import { sessionTitle } from "./session-title"

// Matches the exact `{ info, messages: [{ info, parts }] }` structure produced by `apexo export` CLI
export type SessionExportData = {
  info: Session
  messages: {
    info: Message
    parts: Part[]
  }[]
}

export type SessionExportClient = {
  session: {
    get: (input: { sessionID: string }) => Promise<{ data?: Session | null }>
    messages: (input: { sessionID: string }) => Promise<{ data?: SessionExportData["messages"] | null }>
  }
}

export async function fetchSessionExport(input: {
  sessionID: string
  client: SessionExportClient
  fallbackMessages?: SessionExportData["messages"]
}): Promise<SessionExportData> {
  const [sessionRes, messagesRes] = await Promise.all([
    input.client.session.get({ sessionID: input.sessionID }),
    input.client.session.messages({ sessionID: input.sessionID }),
  ])

  if (!sessionRes?.data) {
    throw new Error(`Session not found: ${input.sessionID}`)
  }
  const messages =
    messagesRes?.data && messagesRes.data.length > 0
      ? messagesRes.data
      : (input.fallbackMessages ?? messagesRes?.data)
  if (!messages) {
    throw new Error(`Failed to load messages for session: ${input.sessionID}`)
  }

  return {
    info: sessionRes.data,
    messages,
  }
}

async function pickSessionJsonText(title?: string): Promise<string | null> {
  const api = (
    window as {
      api?: {
        openFilePicker?: (opts?: {
          multiple?: boolean
          title?: string
          extensions?: string[]
        }) => Promise<{ token: string; files: { path: string; name: string; size: number }[] } | null>
        readPickedFile?: (token: string, path: string) => Promise<ArrayBuffer>
        releasePickedFiles?: (token: string) => Promise<void>
      }
    }
  ).api
  if (api?.openFilePicker && api?.readPickedFile) {
    const picked = await api.openFilePicker({ multiple: false, title, extensions: ["json"] })
    const file = picked?.files?.[0]
    if (!picked || !file) return null
    const buffer = await api.readPickedFile(picked.token, file.path)
    await api.releasePickedFiles?.(picked.token).catch(() => undefined)
    return new TextDecoder().decode(buffer)
  }
  return new Promise<string | null>((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json,application/json"
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      void file.text().then(resolve, () => resolve(null))
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export async function importSessionFromFile(input: {
  url: string
  directory?: string
  title?: string
  headers?: Record<string, string>
}): Promise<Session | null> {
  const text = await pickSessionJsonText(input.title)
  if (!text) return null
  const parsed = JSON.parse(text) as Partial<SessionExportData>
  if (!parsed || typeof parsed !== "object" || !parsed.info || !Array.isArray(parsed.messages)) {
    throw new Error("Invalid session export file")
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(input.headers ?? {}),
  }
  if (input.directory) {
    headers["x-apexo-directory"] = input.directory
  }
  const response = await fetch(`${input.url.replace(/\/+$/, "")}/session`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: parsed.info.title,
      info: parsed.info,
      messages: parsed.messages,
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(detail || `Import failed (${response.status})`)
  }
  return (await response.json()) as Session
}

export function sessionExportFilename(session: { id: string; title?: string; slug?: string }) {
  const name = sessionTitle(session.title) || session.slug || session.id
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
  return `${clean || session.id}.json`
}

export async function downloadSessionExport(filename: string, data: unknown, title?: string): Promise<string | null> {
  const json = JSON.stringify(data, null, 2)
  const desktopSave = (
    window as {
      api?: {
        saveTextFile?: (opts: { title?: string; defaultPath?: string; content: string }) => Promise<string | null>
      }
    }
  ).api?.saveTextFile
  if (desktopSave) {
    return desktopSave({ title, defaultPath: filename, content: json })
  }
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return filename
}

/**
 * `/copy [N]`: the source markdown of the Nth-latest assistant response (1 = latest). Responses are assistant messages
 * with text, so tool-only steps between them do not count.
 */
export function sessionResponse(data: SessionExportData, index = 1) {
  const responses = data.messages.flatMap((item) => {
    if (item.info.role !== "assistant") return []
    const text = item.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim()
    return text ? [text] : []
  })
  return index >= 1 ? responses.at(-index) : undefined
}

// Desktop counterparts of the CLI `/copy`, `/usage` and `/trace` surfaces share one implementation with the TUI.
export {
  sessionTrace,
  sessionTranscript,
  sessionUsage,
  type SessionUsageModel,
  type SessionUsageSummary,
} from "@apexo/sdk/v2/session-report"
