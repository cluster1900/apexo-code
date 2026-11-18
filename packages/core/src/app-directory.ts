import { lstatSync, readlinkSync, realpathSync, renameSync, statSync, symlinkSync, unlinkSync } from "node:fs"
import path from "node:path"
import { LEGACY_APP_DIR_NAME } from "./legacy-compat"
import { Flock } from "./util/flock"

export const APP_DIR_NAME = "apexo"

export async function migrateAppDirectory(base: string, name: string, oldName: string) {
  const directory = path.join(base, name)
  const legacy = path.join(base, oldName)
  const staged = path.join(base, `.${name}.directory-migration`)
  if (
    (lstatSync(directory, { throwIfNoEntry: false }) || !statSync(legacy, { throwIfNoEntry: false })?.isDirectory()) &&
    !lstatSync(staged, { throwIfNoEntry: false })
  )
    return directory

  await using lock = await Flock.acquire(`directory:${name}`, {
    dir: path.join(base, ".apexo-migration-locks"),
    reclaimDeadOwner: true,
  })
  const link = lstatSync(staged, { throwIfNoEntry: false })
  if (
    link &&
    (!link.isSymbolicLink() ||
      path.relative(path.toNamespacedPath(directory), path.toNamespacedPath(path.resolve(base, readlinkSync(staged)))))
  )
    throw new Error(`Unexpected Apexo directory migration entry: ${staged}`)

  const previous = lstatSync(legacy, { throwIfNoEntry: false })
  if (lstatSync(directory, { throwIfNoEntry: false })) {
    if (link) {
      if (previous) unlinkSync(staged)
      else renameSync(staged, legacy)
    }
    return directory
  }
  if (!statSync(legacy, { throwIfNoEntry: false })?.isDirectory()) {
    if (link) unlinkSync(staged)
    return directory
  }

  // Keep references saved with the old absolute path, including Git worktrees and SQLite sidecars.
  // A staged alias also allows recovery if startup stops between the two atomic renames.
  if (!link) {
    const windows = process.platform === "win32"
    symlinkSync(windows ? path.resolve(directory) : name, staged, windows ? "junction" : "dir")
  }
  renameSync(legacy, directory)
  renameSync(staged, legacy)
  return directory
}

export function migratedAppDirectoryAliases(directory: string) {
  if (path.basename(directory) !== APP_DIR_NAME) return
  const base = path.dirname(directory)
  const legacy = path.join(base, LEGACY_APP_DIR_NAME)
  try {
    if (!lstatSync(legacy, { throwIfNoEntry: false })?.isSymbolicLink()) return
    const resolved = realpathSync(directory)
    if (realpathSync(legacy) !== resolved) return

    // The XDG base itself can be a symlink, while persisted paths may already have been resolved.
    return {
      current: [...new Set([directory, resolved])],
      legacy: [...new Set([legacy, path.join(realpathSync(base), LEGACY_APP_DIR_NAME)])],
    }
  } catch {
    return
  }
}

export function migratedWorktreePaths(data: string, directory: string) {
  if (!path.isAbsolute(directory)) return [directory]
  const aliases = migratedAppDirectoryAliases(data)
  if (!aliases) return [directory]
  const roots = [...aliases.current, ...aliases.legacy].map((root) => path.join(root, "worktree"))
  const relative = roots
    .map((root) => path.relative(root, directory))
    .find((suffix) => !path.isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${path.sep}`))
  if (relative === undefined) return [directory]
  return [...new Set([directory, ...roots.map((root) => path.join(root, relative))])]
}
