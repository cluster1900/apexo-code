import { Effect, Schema } from "effect"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { type WorkspaceAdapter, type WorkspaceAdapterContext, WorkspaceInfo } from "../types"

const WorktreeConfig = Schema.Struct({
  name: WorkspaceInfo.fields.name,
  branch: Schema.optional(Schema.NullOr(Schema.String)),
  directory: Schema.String,
})
const decodeWorktreeConfig = Schema.decodeUnknownSync(WorktreeConfig)

function requireWorktree(context: WorkspaceAdapterContext | undefined) {
  if (!context?.worktree) throw new Error("Worktree adapter requires a caller-owned Worktree service")
  return context.worktree
}

function requireInstance(context: WorkspaceAdapterContext | undefined) {
  if (!context?.instance) throw new Error("Worktree adapter requires an instance context")
  return context.instance
}

const provideContext = <A, E, R>(effect: Effect.Effect<A, E, R>, context: WorkspaceAdapterContext | undefined) =>
  effect.pipe(
    Effect.provideService(InstanceRef, requireInstance(context)),
    Effect.provideService(WorkspaceRef, context?.workspaceID),
  )

export const WorktreeAdapter: WorkspaceAdapter = {
  name: "Worktree",
  description: "Create a git worktree",
  async configure(info, context) {
    const worktree = requireWorktree(context)
    const next = await Effect.runPromise(provideContext(worktree.makeWorktreeInfo({ detached: true }), context), {
      signal: context?.signal,
    })
    return {
      ...info,
      name: next.name,
      directory: next.directory,
    }
  },
  async create(info, _env, _from, context) {
    const worktree = requireWorktree(context)
    const config = decodeWorktreeConfig(info)
    await Effect.runPromise(
      provideContext(
        worktree.createFromInfo({
          name: config.name,
          directory: config.directory,
          ...(config.branch ? { branch: config.branch } : {}),
        }),
        context,
      ),
      { signal: context?.signal },
    )
  },
  async list(context) {
    const worktree = requireWorktree(context)
    const ctx = requireInstance(context)
    return (await Effect.runPromise(provideContext(worktree.list(), context), { signal: context?.signal })).map(
      (info) => ({
        type: "worktree",
        name: info.name,
        branch: info.branch,
        directory: info.directory,
        projectID: ctx.project.id,
      }),
    )
  },
  async remove(info, context) {
    const worktree = requireWorktree(context)
    const config = decodeWorktreeConfig(info)
    await Effect.runPromise(provideContext(worktree.remove({ directory: config.directory }), context), {
      signal: context?.signal,
    })
  },
  target(info) {
    const config = decodeWorktreeConfig(info)
    return {
      type: "local",
      directory: config.directory,
    }
  },
}
