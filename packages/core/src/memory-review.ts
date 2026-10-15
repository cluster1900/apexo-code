export * as MemoryReview from "./memory-review"

import { randomUUID } from "node:crypto"
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { MemoryReview } from "@apexo/schema/memory-review"
import { MemoryCatalog } from "./memory-catalog"
import { MemoryFiles } from "./memory-files"
import { MemoryMaintenance } from "./memory-maintenance"
import { WorkspaceMemory } from "./workspace-memory"
import { Flock } from "./util/flock"

export function content(value: string) {
  const text = value.replace(/\r\n?/g, "\n").trim()
  if (!text || Buffer.byteLength(text) > 32768)
    throw new MemoryCatalog.Error({ reason: "invalid", message: "A memory note must contain 1–32768 UTF-8 bytes" })
  return text
}

// Review and rewriting never call this function. Only explicit confirmation appends the selected draft.
export async function save(input: MemoryCatalog.Location, request: MemoryReview.Save): Promise<MemoryReview.Saved> {
  const text = content(request.content)
  const scope = request.scope ?? "global"
  const home = await realpath(input.home)
  const file = WorkspaceMemory.file(input.directory, home, { ...input, scope })
  const alias = WorkspaceMemory.file(input.directory, input.home, { ...input, scope })
  const root = { path: path.dirname(file), alias: path.dirname(alias), source: scope }
  if (!(["read", "edit"] as const).every((action) => input.permitted([file, alias], action)))
    throw new MemoryCatalog.Error({ reason: "forbidden", message: "Saving this memory is not permitted" })
  await WorkspaceMemory.migrate(
    input.directory,
    input.home,
    { ...input, scope },
    (paths) => input.permitted(paths.read, "read") && input.permitted(paths.edit, "edit"),
  )
  return MemoryMaintenance.write({ home, root: root.path }, () =>
    Flock.withLock(
      file,
      async () => {
        const previous = await MemoryFiles.read(file, root, 1_000_001).catch((error: unknown) => {
          if (MemoryFiles.missing(error)) return undefined
          throw error
        })
        if (previous && previous.size > 1_000_000)
          throw new MemoryCatalog.Error({ reason: "invalid", message: "Memory file exceeds the editable size limit" })
        const current = previous?.bytes.toString("utf8").trimEnd() ?? ""
        const next = `${current ? `${current}\n\n` : ""}${text}\n`
        await mkdir(root.path, { recursive: true, mode: 0o700 })
        const temporary = path.join(root.path, `.${randomUUID()}.tmp`)
        await writeFile(temporary, next, { mode: 0o600, flag: "wx" })
        // External editors do not take our locks; preserve their edits if the read snapshot changed.
        const latest = await lstat(file, { bigint: true }).catch(async (error: unknown) => {
          if (MemoryFiles.missing(error)) return undefined
          await rm(temporary, { force: true })
          throw error
        })
        if (
          (previous &&
            (!latest?.isFile() ||
              latest.ino !== previous.identity.ino ||
              latest.mtimeNs !== previous.identity.mtimeNs ||
              latest.ctimeNs !== previous.identity.ctimeNs)) ||
          (!previous && latest)
        ) {
          await rm(temporary, { force: true })
          throw new MemoryCatalog.Error({ reason: "changed", message: "Memory changed while saving; try again" })
        }
        await rename(temporary, file).catch(async (error: unknown) => {
          await rm(temporary, { force: true })
          throw error
        })
        return { path: file }
      },
      { dir: path.join(home, ".grok", "memory", ".locks") },
    ),
  )
}
