export * as MemoryV2Scan from "./memory-v2-scan"

import { opendir } from "node:fs/promises"
import path from "node:path"
import { MemoryV2 } from "./memory-v2"

export const maxFiles = 10_000
export const maxEntries = 100_000

// Iterate directory entries instead of allocating an unbounded readdir result.
// Clear consumes the entire walk; read-only views select a bounded file set.
export async function* walk(root: MemoryV2.Root, options: { archives?: boolean; entries?: number } = {}) {
  const pending = ["topics", "observations", ...(options.archives ? ["archive"] : [])]
  let directories = 0
  while (pending.length) {
    if (++directories > maxEntries) throw new Error("Memory directory exceeds its directory scan limit")
    const relative = pending.shift()!
    await MemoryV2.validate(root, `${relative}/.scan`)
    let entries = 0
    const directory = await opendir(path.join(root.path, relative))
    for await (const item of directory) {
      if (++entries > (options.entries ?? maxEntries)) throw new Error("Memory directory exceeds its entry scan limit")
      if (item.isSymbolicLink() || item.name.startsWith(".")) continue
      const file = `${relative}/${item.name}`
      if (item.isDirectory()) {
        if (pending.length + directories >= maxEntries)
          throw new Error("Memory directory exceeds its directory scan limit")
        pending.push(file)
      }
      if (item.isFile() && item.name.endsWith(".md")) yield file
    }
  }
}

export async function discover(
  root: MemoryV2.Root,
  excluded: ReadonlySet<string> = new Set(),
  options: { files?: number; entries?: number } = {},
) {
  const files: string[] = []
  const limit = options.files ?? maxFiles
  for await (const file of walk(root, options)) {
    if (excluded.has(file)) continue
    files.push(file)
    // Keep the alphabetically earliest topics, then observations, regardless
    // of filesystem enumeration order. Memory stays bounded even above the cap.
    if (files.length > limit * 2) files.sort(compare).splice(limit)
  }
  return files.sort(compare).slice(0, limit)
}

function compare(a: string, b: string) {
  const kind = Number(b.startsWith("topics/")) - Number(a.startsWith("topics/"))
  return kind || (a < b ? -1 : a > b ? 1 : 0)
}
