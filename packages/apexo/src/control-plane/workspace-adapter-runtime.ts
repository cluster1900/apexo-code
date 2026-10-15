import type { Worktree } from "@/worktree"
import { Effect } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { getAdapter } from "./adapters"
import type { WorkspaceAdapter, WorkspaceInfo } from "./types"

const context = Effect.gen(function* () {
  return {
    instance: yield* InstanceRef,
    workspaceID: yield* WorkspaceRef,
  }
})

export const target = (info: WorkspaceInfo) =>
  Effect.gen(function* () {
    const adapter = getAdapter(info.projectID, info.type)
    const ctx = yield* context
    return yield* EffectBridge.fromPromise(() => adapter.target(info, ctx))
  })

export const configure = (worktree: Worktree.Service["Service"], adapter: WorkspaceAdapter, info: WorkspaceInfo) =>
  Effect.gen(function* () {
    const ctx = yield* context
    return yield* EffectBridge.fromPromise((signal) => adapter.configure(info, { ...ctx, worktree, signal }))
  })

export const create = (
  worktree: Worktree.Service["Service"],
  adapter: WorkspaceAdapter,
  info: WorkspaceInfo,
  env: Record<string, string | undefined>,
  from?: WorkspaceInfo,
) =>
  Effect.gen(function* () {
    const ctx = yield* context
    return yield* EffectBridge.fromPromise((signal) => adapter.create(info, env, from, { ...ctx, worktree, signal }))
  })

export const list = (worktree: Worktree.Service["Service"], adapter: WorkspaceAdapter) =>
  Effect.gen(function* () {
    const ctx = yield* context
    return yield* EffectBridge.fromPromise((signal) =>
      Promise.resolve(adapter.list?.({ ...ctx, worktree, signal }) ?? []),
    )
  })

export const remove = (worktree: Worktree.Service["Service"], info: WorkspaceInfo) =>
  Effect.gen(function* () {
    const adapter = getAdapter(info.projectID, info.type)
    const ctx = yield* context
    return yield* EffectBridge.fromPromise((signal) => adapter.remove(info, { ...ctx, worktree, signal }))
  })

export * as WorkspaceAdapterRuntime from "./workspace-adapter-runtime"
