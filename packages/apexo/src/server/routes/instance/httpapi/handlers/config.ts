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

function redactSecret<T>(value: T): T {
  if (typeof value !== "string" || !value.length) return value
  if (/^\{(env|file):[^}]+\}$/.test(value)) return value
  return "***" as T
}

export function redactConfigSecrets<T extends ConfigV1.Info>(config: T): T {
  const provider = config.provider
    ? Object.fromEntries(
        Object.entries(config.provider).map(([key, item]) => [
          key,
          item?.options && typeof item.options === "object" && "apiKey" in item.options
            ? { ...item, options: { ...item.options, apiKey: redactSecret(item.options.apiKey) } }
            : item,
        ]),
      )
    : config.provider
  const mcp = config.mcp
    ? Object.fromEntries(
        Object.entries(config.mcp).map(([key, item]) => [
          key,
          item &&
          typeof item === "object" &&
          "oauth" in item &&
          item.oauth &&
          typeof item.oauth === "object" &&
          "clientSecret" in item.oauth
            ? {
                ...item,
                oauth: { ...item.oauth, clientSecret: redactSecret(item.oauth.clientSecret) as string | undefined },
              }
            : item,
        ]),
      )
    : config.mcp
  return {
    ...config,
    ...(provider === config.provider ? {} : { provider }),
    ...(mcp === config.mcp ? {} : { mcp }),
  }
}

export function redactProviderSecrets(provider: Provider.Info): Provider.Info {
  const pub = Provider.toPublicInfo(provider)
  if (pub.key) pub.key = redactSecret(pub.key)
  if (pub.options && typeof pub.options === "object" && "apiKey" in pub.options) {
    pub.options = { ...pub.options, apiKey: redactSecret(pub.options.apiKey) }
  }
  return pub
}

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return redactConfigSecrets(yield* configSvc.get())
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return redactConfigSecrets(ctx.payload)
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers).map(redactProviderSecrets),
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
