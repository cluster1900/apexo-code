export * as WorkflowScratch from "./scratch"

import path from "node:path"
import fs from "node:fs/promises"
import { constants } from "node:fs"
import { Workflow } from "@apexo/schema/workflow"
import { WorkflowLimits } from "./limits"

const writes = new Map<string, Promise<string>>()

/** Serialize capacity checks with writes, including concurrent host callers in this process. */
export function file(data: string, id: Workflow.ID, name: string, content?: string) {
  if (content === undefined) return access(data, id, name)
  const key = path.resolve(data, id)
  const prior = writes.get(key) ?? Promise.resolve("")
  const pending = prior.catch(() => "").then(() => access(data, id, name, content))
  writes.set(key, pending)
  return pending.finally(() => {
    if (writes.get(key) === pending) writes.delete(key)
  })
}

/** Private workflow scratch never resolves script-supplied paths outside its own directory. */
async function access(data: string, id: Workflow.ID, name: string, content?: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name) || Buffer.byteLength(content ?? "") > WorkflowLimits.fileBytes)
    throw new Error("Invalid workflow scratch name or size")
  const base = await fs.realpath(data)
  const root = path.join(base, "workflow-scratch")
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error("Workflow scratch root cannot be a symlink")
  const directory = path.join(root, id)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error("Workflow scratch directory cannot be a symlink")
  const target = path.join(directory, name)
  if (content !== undefined) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    if (
      entries.length > WorkflowLimits.scratchFiles ||
      (entries.length === WorkflowLimits.scratchFiles && !entries.some((entry) => entry.name === name))
    )
      throw new Error("Workflow scratch file capacity exceeded")
    const sizes = await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile()) throw new Error("Unsafe workflow scratch entry")
        const stat = await fs.lstat(path.join(directory, entry.name))
        if (!stat.isFile() || stat.nlink !== 1) throw new Error("Unsafe workflow scratch file")
        return entry.name === name ? 0 : stat.size
      }),
    )
    if (sizes.reduce((total, size) => total + size, Buffer.byteLength(content)) > WorkflowLimits.scratchBytes)
      throw new Error("Workflow scratch byte capacity exceeded")
  }
  const handle = await fs.open(
    target,
    (content === undefined ? constants.O_RDONLY : constants.O_RDWR | constants.O_CREAT) | constants.O_NOFOLLOW,
    0o600,
  )
  return Promise.resolve()
    .then(async () => {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > WorkflowLimits.fileBytes)
        throw new Error("Unsafe workflow scratch file")
      if (content === undefined) return handle.readFile("utf8")
      await handle.truncate(0)
      await handle.writeFile(content)
      await handle.sync()
      return target
    })
    .finally(() => handle.close())
}
