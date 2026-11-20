import path from "node:path"
import { existingAncestor, verifiedMigratedWorktreePaths } from "../app-directory"

export function permissionResourcePaths(data: string, action: string, resource: string) {
  if (!path.isAbsolute(resource) || !["external_directory", "read", "edit"].includes(action)) return [resource]
  const suffix = /[/\\]\*{1,2}$/.exec(resource)?.[0] ?? ""
  const target = suffix ? resource.slice(0, -suffix.length) : resource
  // Edits can target a new file. Stop at the first existing entry so an intervening symlink
  // still has to pass the worktree identity check.
  const anchor = action === "edit" ? existingAncestor(target) : target
  if (!anchor) return [resource]
  const relative = path.relative(anchor, target)
  return [
    resource,
    ...verifiedMigratedWorktreePaths(data, anchor).map((alias) => {
      const result = path.join(alias, relative) + suffix
      return process.platform === "win32" ? result.replaceAll("\\", "/") : result
    }),
  ]
}
