import { expect, test } from "bun:test"
import { Model } from "@apexo/schema/model"
import { Provider } from "@apexo/schema/provider"
import { DateTime, Effect, Layer } from "effect"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionRunnerModel } from "@apexo/core/session/runner/model"
import { Project } from "@apexo/schema/project"
import { AbsolutePath } from "@apexo/schema/schema"
import { testEffect } from "../lib/effect"
import { WorkflowEffort } from "@apexo/core/workflow/effort"

const ref = { providerID: Provider.ID.make("fixture"), id: Model.ID.make("model") }
const variant = (id: string, body: Model.Info["request"]["body"], headers: Record<string, string> = {}) => ({
  id: Model.VariantID.make(id),
  body,
  headers,
})
const model = (packageName = "@ai-sdk/openai-compatible"): Model.Info => ({
  ...Model.Info.empty(ref.providerID, ref.id),
  api: { type: "aisdk", package: packageName, id: ref.id, url: "http://127.0.0.1:1/v1" },
})

test("native API wire fields, not variant names, declare effort", () => {
  for (const [packageName, body] of [
    ["@ai-sdk/openai-compatible", { reasoning_effort: "high" }],
    ["@ai-sdk/openai", { reasoning: { effort: "high" } }],
    ["@ai-sdk/xai", { reasoning: { effort: "high" } }],
    ["@ai-sdk/anthropic", { output_config: { effort: "high" } }],
  ] as const) {
    const input = { ...model(packageName), variants: [variant("careful", body), variant("high", {})] }
    expect(WorkflowEffort.select(input, ref, "HIGH").variant).toBe(Model.VariantID.make("careful"))
    expect(() => WorkflowEffort.select({ ...input, variants: [variant("high", {})] }, ref, "high")).toThrow(
      "unavailable",
    )
  }
})

test("all known efforts require an explicit matching native payload", () => {
  for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    expect(
      WorkflowEffort.select(
        { ...model(), variants: [variant("configured", { reasoning_effort: effort })] },
        ref,
        effort,
      ).variant,
    ).toBe(Model.VariantID.make("configured"))
  }
  expect(() => WorkflowEffort.select(model(), ref, "ultra")).toThrow("Unknown")
  expect(() => WorkflowEffort.select(model(), ref, "high")).toThrow("unavailable")
  expect(() =>
    WorkflowEffort.select({ ...model(), variants: [variant("uppercase", { reasoning_effort: "HIGH" })] }, ref, "high"),
  ).toThrow("unavailable")
})

test("inherited custom fields and headers cannot disappear when changing effort", () => {
  const input = {
    ...model(),
    variants: [
      variant("custom", { reasoning_effort: "low", custom: true }, { "x-custom": "retained" }),
      variant("plain", { reasoning_effort: "high" }),
    ],
  }
  expect(() => WorkflowEffort.select(input, { ...ref, variant: Model.VariantID.make("custom") }, "high")).toThrow(
    "other model settings",
  )
  const compatible = {
    ...input,
    variants: [
      ...input.variants,
      variant("custom-high", { reasoning_effort: "high", custom: true }, { "x-custom": "retained" }),
    ],
  }
  expect(WorkflowEffort.select(compatible, { ...ref, variant: Model.VariantID.make("custom") }, "high").variant).toBe(
    Model.VariantID.make("custom-high"),
  )
  expect(() =>
    WorkflowEffort.select(
      {
        ...compatible,
        variants: compatible.variants.map((value) => (value.id === "custom-high" ? { ...value, headers: {} } : value)),
      },
      { ...ref, variant: Model.VariantID.make("custom") },
      "high",
    ),
  ).toThrow("other model settings")
})

test("nested non-effort settings survive and conflicting values fail", () => {
  const input = {
    ...model("@ai-sdk/openai"),
    request: { headers: {}, body: { reasoning: { effort: "low", summary: "auto" } } },
    variants: [variant("high", { reasoning: { effort: "high", summary: "auto" } })],
  }
  expect(WorkflowEffort.select(input, ref, "high").variant).toBe(Model.VariantID.make("high"))
  expect(() =>
    WorkflowEffort.select({ ...input, variants: [variant("high", { reasoning: { effort: "high" } })] }, ref, "high"),
  ).toThrow("other model settings")
})

test("ambiguous mappings reject but an already-selected matching variant is stable", () => {
  const input = {
    ...model(),
    variants: [variant("one", { reasoning_effort: "high" }), variant("two", { reasoning_effort: "high" })],
  }
  expect(() => WorkflowEffort.select(input, ref, "high")).toThrow("multiple")
  expect(WorkflowEffort.select(input, { ...ref, variant: Model.VariantID.make("two") }, "high").variant).toBe(
    Model.VariantID.make("two"),
  )
  expect(
    WorkflowEffort.select({ ...input, request: { headers: {}, body: {}, variant: "one" } }, ref, "high").variant,
  ).toBe(Model.VariantID.make("one"))
})

test("attached child selection cannot be remapped on resume", () => {
  const input = {
    ...model(),
    variants: [variant("saved", { reasoning_effort: "low" }), variant("new", { reasoning_effort: "high" })],
  }
  expect(() => WorkflowEffort.select(input, { ...ref, variant: Model.VariantID.make("saved") }, "high", true)).toThrow(
    "Saved Workflow child",
  )
  expect(WorkflowEffort.select(input, { ...ref, variant: Model.VariantID.make("saved") }, "low", true).variant).toBe(
    Model.VariantID.make("saved"),
  )
})

test("wrong protocol field and unsupported native APIs do not masquerade as effort support", () => {
  expect(() =>
    WorkflowEffort.select(
      { ...model("@ai-sdk/openai"), variants: [variant("high", { reasoning_effort: "high" })] },
      ref,
      "high",
    ),
  ).toThrow("unavailable")
  expect(() => WorkflowEffort.select(Model.Info.empty(ref.providerID, ref.id), ref, "high")).toThrow("model API")
  expect(() => WorkflowEffort.select(model(), { ...ref, variant: Model.VariantID.make("absent") }, "high")).toThrow(
    "variant is unavailable",
  )
})

const it = testEffect(Layer.empty)
it.live("canonical native credential metadata cannot silently override effort", () =>
  Effect.gen(function* () {
    const input = { ...model(), variants: [variant("high", { reasoning_effort: "high" })] }
    const parent = SessionSchema.Info.make({
      id: SessionSchema.ID.create(),
      projectID: Project.ID.make("effort-fixture"),
      title: "Effort",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
      location: { directory: AbsolutePath.make("/fixture") },
      model: ref,
    })
    const catalog = { available: () => Effect.succeed([input]), default: () => Effect.succeed(input) }
    const normal = { resolve: (session: SessionSchema.Info) => SessionRunnerModel.resolve(session, input) }
    expect((yield* WorkflowEffort.resolve(catalog, normal, parent, undefined, "high")).variant).toBe(
      Model.VariantID.make("high"),
    )
    const credential = {
      resolve: (session: SessionSchema.Info) =>
        SessionRunnerModel.resolve(session, input, {
          type: "key",
          key: "fixture",
          metadata: { reasoning_effort: "low" },
        }),
    }
    expect(yield* WorkflowEffort.resolve(catalog, credential, parent, ref, "high").pipe(Effect.flip)).toMatchObject({
      code: "invalid",
      message: "Resolved model settings override the requested Workflow reasoning effort",
    })
  }),
)
