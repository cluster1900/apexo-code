import { Config } from "@/config/config"
import { ConfigV1 } from "@apexo/core/v1/config/config"
import { Provider } from "@/provider/provider"
import * as InstanceState from "@/effect/instance-state"
import { Effect } from "effect"
import { Global } from "@apexo/core/global"
import { ClaudeImport } from "@/config/claude-import"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal } from "../lifecycle"

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return ctx.payload
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
      }
    })

    const claudeImportPreview = Effect.fn("ConfigHttpApi.claudeImportPreview")(function* () {
      const ctx = yield* InstanceState.context
      return ClaudeImport.preview(yield* Effect.promise(() => ClaudeImport.load(Global.Path.home, ctx.directory)))
    })

    const claudeImportApply = Effect.fn("ConfigHttpApi.claudeImportApply")(function* (ctx) {
      const instance = yield* InstanceState.context
      const home = Global.Path.home
      const plan = yield* Effect.promise(() => ClaudeImport.load(home, instance.directory))
      const chosen = ctx.payload.sections
      const patch = ClaudeImport.configPatch(plan, chosen)
      if (Object.keys(patch).length) yield* configSvc.updateGlobal(patch as ConfigV1.Info)
      const hooksFile = chosen.includes("hooks")
        ? yield* Effect.promise(() => ClaudeImport.writeHooks(home, plan))
        : undefined
      if (Object.keys(patch).length) yield* markInstanceForDisposal(yield* InstanceState.context)
      return {
        applied: ClaudeImport.sections(plan).filter((section) => chosen.includes(section.id) && section.count > 0),
        skipped: plan.skipped,
        ...(hooksFile ? { hooksFile } : {}),
      }
    })

    return handlers
      .handle("get", get)
      .handle("update", update)
      .handle("providers", providers)
      .handle("claudeImportPreview", claudeImportPreview)
      .handle("claudeImportApply", claudeImportApply)
  }),
)
