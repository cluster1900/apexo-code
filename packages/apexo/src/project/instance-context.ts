import path from "path"
import { LocalContext } from "@/util/local-context"
import { existingAncestor, worktreeRelativePath } from "@apexo/core/app-directory"
import { FSUtil } from "@apexo/core/fs-util"
import { Global } from "@apexo/core/global"
import type * as Project from "./project"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
}

export const context = LocalContext.create<InstanceContext>("instance")

/**
 * Check if a path is within the project boundary.
 * Returns true if path is inside ctx.directory OR ctx.worktree.
 * Paths within the worktree but outside the working directory should not trigger external_directory permission.
 */
export function containsPath(filepath: string, ctx: InstanceContext): boolean {
  if (withinWorktree(ctx.directory, filepath)) return true
  // Non-git projects set worktree to "/" which would match ANY absolute path.
  // Skip worktree check in this case to preserve external_directory permissions.
  if (ctx.worktree === "/" || ctx.worktree === "\\") return false
  return withinWorktree(ctx.worktree, filepath)
}

function withinWorktree(directory: string, filepath: string) {
  if (FSUtil.contains(directory, filepath)) return true
  if (worktreeRelativePath(Global.Path.data, directory, filepath) === undefined) return false
  const anchor = existingAncestor(filepath)
  return anchor !== undefined && FSUtil.contains(FSUtil.resolve(directory), FSUtil.resolve(anchor))
}

export function projectRelativePath(filepath: string, ctx: Pick<InstanceContext, "directory" | "worktree">): string {
  if (ctx.worktree === "/" || ctx.worktree === "\\") {
    const relative = worktreeRelativePath(Global.Path.data, ctx.directory, filepath)
    return relative === undefined ? filepath : relative || "."
  }
  return worktreeRelativePath(Global.Path.data, ctx.worktree, filepath) ?? path.relative(ctx.worktree, filepath)
}
