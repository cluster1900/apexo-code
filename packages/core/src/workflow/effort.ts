export * as WorkflowEffort from "./effort"

import { isDeepStrictEqual } from "node:util"
import { Effect } from "effect"
import { Catalog } from "../catalog"
import { ModelV2 } from "../model"
import { SessionSchema } from "../session/schema"
import { SessionRunnerModel } from "../session/runner/model"
import { WorkflowStore } from "./store"

export const pattern = /^(none|minimal|low|medium|high|xhigh|max)$/i

/** Existing native variants are the capability declaration; their names carry no effort semantics. */
export function select(model: ModelV2.Info, ref: ModelV2.Ref, effort: string, fixed = false): ModelV2.Ref {
  if (!pattern.test(effort)) throw invalid("Unknown workflow reasoning effort")
  const requested = effort.toLowerCase()
  const key = field(model)
  if (!key) throw invalid("Workflow reasoning effort is unavailable for this model API")
  const currentID = ref.variant === undefined || ref.variant === "default" ? model.request.variant : ref.variant
  const current = model.variants.find((variant) => variant.id === currentID)
  if (!current && ref.variant !== undefined && ref.variant !== "default")
    throw invalid("Workflow model variant is unavailable")
  const body = { ...model.request.body, ...current?.body }
  const headers = { ...model.request.headers, ...current?.headers }
  if (read(body, key) === requested) return { ...ref, variant: current?.id ?? ModelV2.VariantID.make("default") }
  if (fixed) throw invalid("Saved Workflow child no longer resolves its requested reasoning effort")
  const matches = model.variants.filter((variant) => {
    const candidate = { ...model.request.body, ...variant.body }
    return (
      read(candidate, key) === requested &&
      isDeepStrictEqual(without(candidate, key), without(body, key)) &&
      isDeepStrictEqual({ ...model.request.headers, ...variant.headers }, headers)
    )
  })
  if (matches.length !== 1)
    throw invalid(
      matches.length > 1
        ? "Workflow reasoning effort matches multiple native variants"
        : "Workflow reasoning effort is unavailable without changing other model settings",
    )
  return { ...ref, variant: matches[0]!.id }
}

/** Resolve credentials through the canonical native path before child mutation admission. */
export const resolve = Effect.fn("WorkflowEffort.resolve")(function* (
  catalog: Pick<Catalog.Interface["model"], "available" | "default">,
  models: SessionRunnerModel.Interface,
  parent: SessionSchema.Info,
  ref: ModelV2.Ref | undefined,
  effort: string,
  fixed = false,
) {
  const available = yield* catalog.available()
  const defaultModel = ref ? undefined : yield* catalog.default()
  const model = ref
    ? available.find((item) => item.providerID === ref.providerID && item.id === ref.id)
    : defaultModel && SessionRunnerModel.supported(defaultModel)
      ? defaultModel
      : available.find(SessionRunnerModel.supported)
  if (!model) return yield* invalid("Workflow model is unavailable for reasoning effort")
  const selected = yield* Effect.try({
    try: () => select(model, ref ?? { providerID: model.providerID, id: model.id }, effort, fixed),
    catch: (error) => (error instanceof WorkflowStore.Failure ? error : invalid("Invalid workflow reasoning effort")),
  })
  const resolved = yield* models
    .resolve({ ...parent, model: selected })
    .pipe(Effect.mapError((error) => invalid(error.message)))
  const key = field(model)!
  if (read(resolved.route.defaults.http?.body ?? {}, key) !== effort.toLowerCase())
    return yield* invalid("Resolved model settings override the requested Workflow reasoning effort")
  return selected
})

function invalid(message: string) {
  return new WorkflowStore.Failure({ code: "invalid", message })
}

function field(model: ModelV2.Info): readonly string[] | undefined {
  if (model.api.type !== "aisdk") return
  // Match SessionRunnerModel's native routing precedence, including the xai provider fallback.
  if (model.api.package === "@ai-sdk/openai" || model.api.package === "@ai-sdk/xai" || model.providerID === "xai")
    return ["reasoning", "effort"]
  if (model.api.package === "@ai-sdk/anthropic") return ["output_config", "effort"]
  if (model.api.package === "@ai-sdk/openai-compatible" && model.api.url) return ["reasoning_effort"]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function read(body: Readonly<Record<string, unknown>>, key: readonly string[]) {
  const nested = body[key[0]!]
  const value = key.length === 1 ? nested : record(nested) ? nested[key[1]!] : undefined
  return typeof value === "string" && pattern.test(value) && value === value.toLowerCase() ? value : undefined
}

function without(body: Readonly<Record<string, unknown>>, key: readonly string[]) {
  if (key.length === 1) return Object.fromEntries(Object.entries(body).filter(([name]) => name !== key[0]))
  const nested = body[key[0]!]
  if (!record(nested)) return body
  const remaining = Object.fromEntries(Object.entries(nested).filter(([name]) => name !== key[1]))
  return Object.fromEntries(
    Object.entries(body).flatMap(([name, value]) =>
      name !== key[0] ? [[name, value]] : Object.keys(remaining).length ? [[name, remaining]] : [],
    ),
  )
}
