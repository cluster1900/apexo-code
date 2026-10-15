export * as MemorySession from "./memory-session"

import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { Global } from "./global"
import { SessionV1 } from "./v1/session"
import { Flock } from "./util/flock"
import { WorkspaceMemory } from "./workspace-memory"
import { MemoryMaintenance } from "./memory-maintenance"

export type Record = { sessionID: string; captured: number; content: string; generation?: string }

export function summarize(sessionID: string, messages: SessionV1.WithParts[], captured: number): Record | undefined {
  const queries = messages
    .filter((message) => message.info.role === "user")
    .map((message) =>
      message.parts
        .filter((part): part is SessionV1.TextPart => part.type === "text" && !part.synthetic && !part.ignored)
        .map((part) => part.text)
        .join("\n")
        .trim(),
    )
    .filter((query) => query.length > 0 && query !== "__auto_continue__")
  if (queries.length < 3 || queries.reduce((total, query) => total + Buffer.byteLength(query), 0) < 50) return
  const assistants = messages.filter((message) => message.info.role === "assistant").length
  const tools = messages
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "tool" && ["completed", "error"].includes(part.state.status)).length
  return {
    sessionID,
    captured,
    content: [
      `<!-- apexo-session-checkpoint:${captured} -->`,
      "## Session Summary",
      "",
      `- **Messages:** ${queries.length} user, ${assistants} assistant, ${tools} tool results`,
      `- **Date:** ${new Date(captured).toISOString().slice(0, 16).replace("T", " ")} UTC`,
      "",
      "## Topics Discussed",
      "",
      ...queries
        .slice(0, 5)
        .map((query, index) => `${index + 1}. ${Array.from(query).slice(0, 100).join("").replace(/\s+/g, " ")}`),
      "",
    ].join("\n"),
  }
}

export function file(
  directory: string,
  record: Record,
  home = Global.Path.home,
  location: WorkspaceMemory.Location = {},
) {
  if (!/^[a-zA-Z0-9_-]+$/.test(record.sessionID)) throw new Error("Invalid session ID for memory record")
  return path.join(
    path.dirname(WorkspaceMemory.file(directory, home, { ...location, scope: "workspace" })),
    "sessions",
    `${new Date(record.captured).toISOString().slice(0, 10)}-${record.sessionID}.md`,
  )
}

export async function save(
  directory: string,
  record: Record,
  home = Global.Path.home,
  location: WorkspaceMemory.Location = {},
) {
  const target = file(directory, record, home, location)
  return MemoryMaintenance.write(
    WorkspaceMemory.maintenance(directory, home, location),
    () =>
      Flock.withLock(
        target,
        async () => {
          // A replaced scope or sessions directory must not redirect automatic writes outside memory.
          for (const folder of [
            path.dirname(WorkspaceMemory.file(directory, home, { scope: "global" })),
            path.dirname(path.dirname(target)),
            path.dirname(target),
          ]) {
            const existing = await lstat(folder).catch((error: unknown) => {
              if (missing(error)) return undefined
              throw error
            })
            if (existing?.isSymbolicLink()) throw new Error("Memory directories must not be symbolic links")
            if (!existing) await mkdir(folder, { recursive: true, mode: 0o700 })
          }
          const existing = await lstat(target).catch((error: unknown) => {
            if (missing(error)) return undefined
            throw error
          })
          if (existing?.isSymbolicLink()) throw new Error("Memory session file must not be a symbolic link")
          const previous = existing ? await readFile(target, "utf8") : ""
          const captured = Number(previous.match(/^<!-- apexo-session-checkpoint:(\d+) -->/)?.[1] ?? 0)
          if (captured > record.captured || previous === record.content) return target
          const temporary = `${target}.${randomUUID()}.tmp`
          await writeFile(temporary, record.content, { mode: 0o600 })
          await rename(temporary, target).catch(async (error: unknown) => {
            await rm(temporary, { force: true })
            throw error
          })
          return target
        },
        { dir: path.join(home, ".grok", "memory", ".locks") },
      ),
    record.generation,
  )
}

export async function load(
  directory: string,
  record: Record,
  home = Global.Path.home,
  location: WorkspaceMemory.Location = {},
) {
  const target = file(directory, record, home, location)
  const existing = await lstat(target).catch((error: unknown) => {
    if (missing(error)) return undefined
    throw error
  })
  if (!existing) return ""
  const canonical = file(directory, record, await realpath(home), location)
  if (!existing.isFile() || existing.isSymbolicLink() || (await realpath(target)) !== canonical)
    throw new Error("Memory session file must not be redirected")
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== existing.dev || opened.ino !== existing.ino)
      throw new Error("Memory session file changed while reading")
    const content = await handle.readFile("utf8")
    if ((await realpath(target)) !== canonical) throw new Error("Memory session file changed while reading")
    return content
  } finally {
    await handle.close()
  }
}

function missing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
