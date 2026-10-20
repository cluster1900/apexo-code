import { Effect } from "effect"
import { define } from "../internal"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"

const GROK_MODELS = [
  { id: "grok-4.7", name: "Grok 4.7" },
  { id: "grok-4.7-build-fast", name: "Grok 4.7 Fast" },
  { id: "grok-4.6", name: "Grok 4.6" },
  { id: "grok-4.5", name: "Grok 4.5" },
] as const

export const XAIPlugin = define({
  id: "xai",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const providerID = ProviderV2.ID.make("xai")
        if (!evt.provider.get(providerID)) return
        for (const item of GROK_MODELS) {
          evt.model.update(providerID, ModelV2.ID.make(item.id), (model) => {
            model.name = item.name
            model.status = "active"
            model.limit = { context: 256_000, output: 64_000 }
            model.capabilities = {
              tools: true,
              input: ["text", "image"],
              output: ["text"],
            }
            model.variants = ["low", "medium", "high", "xhigh"].map((effort) => ({
              id: ModelV2.VariantID.make(effort),
              headers: {},
              body: { reasoningEffort: effort },
            }))
          })
        }
      }),
    )
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/xai") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/xai"))
        evt.sdk = mod.createXai(evt.options)
      }),
    )
    yield* ctx.aisdk.language(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("xai")) return
        evt.language = evt.sdk.responses(evt.model.api.id)
      }),
    )
  }),
})
