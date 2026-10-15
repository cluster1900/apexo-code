import { BackgroundJob } from "@/background/job"
import path from "node:path"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Global } from "@apexo/core/global"
import { PluginStore } from "@apexo/core/plugin-store"
import { InstanceHttpApi } from "../api"
import { InvalidRequestError, ConflictError } from "../errors"
import { SessionStatus } from "@/session/status"
import { InstanceState } from "@/effect/instance-state"
import { markInstanceForDisposal } from "../lifecycle"

export const pluginsHandlers = HttpApiBuilder.group(InstanceHttpApi, "plugins", (handlers) =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const background = yield* BackgroundJob.Service
    const root = path.join(Global.Path.data, "plugins")
    const run = <T>(fn: () => Promise<T>) =>
      Effect.tryPromise({
        try: fn,
        catch: (error) =>
          new InvalidRequestError({
            message: error instanceof Error ? error.message : String(error),
            kind: error instanceof PluginStore.Error ? error.code : "failed",
          }),
      })
    return handlers
      .handle("reload", () =>
        Effect.gen(function* () {
          if (
            [...(yield* status.list()).values()].some((value) => value.type !== "idle") ||
            (yield* background.list()).some((job) => job.status === "running")
          )
            return yield* new ConflictError({ message: "Wait for running sessions before reloading plugins" })
          yield* markInstanceForDisposal(yield* InstanceState.context)
          return true
        }),
      )
      .handle("list", () => run(() => PluginStore.catalog(root)))
      .handle("detail", (ctx) => run(() => PluginStore.detail(root, ctx.query.id)))
      .handle("manage", (ctx) => run(() => PluginStore.mutate(root, ctx.payload)))
  }),
)
