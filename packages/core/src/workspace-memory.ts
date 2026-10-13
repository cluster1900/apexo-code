export * as WorkspaceMemory from "./workspace-memory"

import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { Global } from "./global"
import { Flock } from "./util/flock"

export function file(directory: string, home = Global.Path.home) {
  const resolved = path.resolve(directory)
  const name = `${path.basename(resolved).replace(/[^a-zA-Z0-9._-]/g, "-") || "workspace"}-${createHash("sha256").update(resolved).digest("hex").slice(0, 8)}`
  return path.join(home, ".grok", "memory", name, "MEMORY.md")
}

export async function read(directory: string, home = Global.Path.home) {
  return readFile(file(directory, home), "utf8").catch((error: unknown) => {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return ""
    throw error
  })
}

export async function update(
  directory: string,
  input: { operation: "remember" | "flush" | "dream"; content?: string },
  home = Global.Path.home,
) {
  const target = file(directory, home)
  return Flock.withLock(
    target,
    async () => {
      const current = await read(directory, home)
      const content = input.content?.trim()
      if (input.operation !== "dream" && !content)
        throw new Error(`${input.operation} requires a non-empty note or summary`)
      const next =
        input.operation === "dream"
          ? consolidate(current)
          : consolidate(`${current.trim() || "# Memory"}\n\n- ${new Date().toISOString()} — ${content}\n`)
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      const temporary = `${target}.${randomUUID()}.tmp`
      await writeFile(temporary, next, { mode: 0o600 })
      await rename(temporary, target).catch(async (error: unknown) => {
        await rm(temporary, { force: true })
        throw error
      })
      return next
    },
    { dir: path.join(home, ".grok", "memory", ".locks") },
  )
}

// Keep Markdown blocks intact. Timestamps do not make identical notes distinct.
function consolidate(text: string) {
  const seen = new Set<string>()
  const blocks = text
    .trim()
    .split(/\n(?=- \d{4}-\d\d-\d\dT)/)
    .filter((block) => {
      const key = block.replace(/^- \d{4}-\d\d-\d\dT\S+ — /, "").trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  return `${blocks.join("\n").trim() || "# Memory"}\n`
}
