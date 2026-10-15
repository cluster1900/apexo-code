import type { FilePart } from "@apexo/sdk/v2"
import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

const limit = 100 * 1024 * 1024

export async function readNativeMedia(input: {
  server: ServerConnection.HttpBase
  directory: string
  file: FilePart
  signal: AbortSignal
  fetch: typeof globalThis.fetch
}): Promise<Blob> {
  if (input.file.mime !== "video/mp4") throw new Error("Unsupported local media")
  const source = new URL(input.file.url)
  if (source.protocol !== "file:" || source.host) throw new Error("Invalid local media path")
  const directory = input.directory.replaceAll("\\", "/").replace(/\/$/, "")
  const decoded = decodeURIComponent(source.pathname)
  const path = /^[A-Za-z]:/.test(directory) ? decoded.replace(/^\//, "") : decoded
  if (!path.startsWith(`${directory}/`)) throw new Error("Media is outside the Location")
  const relative = path.slice(directory.length + 1)
  if (
    !relative ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    relative.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("Invalid local media path")
  const url = new URL(`/api/fs/read/${encodeURIComponent(relative)}`, input.server.url)
  url.searchParams.set("location[directory]", input.directory)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30_000)])
  const fetch = input.fetch
  const response = await fetch(url, {
    signal,
    redirect: "error",
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({ username: input.server.username, password: input.server.password })}`,
        }
      : undefined,
  })
  if (!response.ok || response.headers.get("content-type")?.split(";")[0].trim() !== "video/mp4" || !response.body) {
    await response.body?.cancel()
    throw new Error("Media is unavailable")
  }
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body.cancel()
    throw new Error("Media exceeds the preview limit")
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) throw new Error("Media exceeds the preview limit")
      chunks.push(new Uint8Array(chunk.value))
    }
    signal.throwIfAborted()
    return new Blob(chunks, { type: "video/mp4" })
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}
