export * as ConfigGoal from "./goal"

import { Schema } from "effect"
import { NonNegativeInt } from "@apexo/schema/schema"
import { Goal } from "@apexo/schema/goal"
import { EnvBoolean } from "../util/env-boolean"

export const Info = Schema.Struct({
  report_retention_days: Schema.optional(NonNegativeInt.check(Schema.isLessThanOrEqualTo(36_500))).annotate({
    description:
      "Retain superseded Goal reports for this many days after completion or budget stop. Omit to retain indefinitely. The current plan and latest verifier references are always retained.",
  }),
  use_current_model_only: Schema.optional(Schema.Boolean).annotate({
    description: "Ignore Goal role model/agent overrides. GROK_GOAL_USE_CURRENT_MODEL_ONLY takes precedence.",
  }),
  planner_model: Schema.optional(Goal.RoleModel).annotate({
    description: "Planner model (provider/model or current-provider model ID) and configured Apexo agent name.",
  }),
  summary_enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "Generate one optional native closing summary after verified completion (default true). GROK_GOAL_SUMMARY overrides this setting.",
  }),
  strategist_model: Schema.optional(Goal.RoleModel).annotate({
    description: "Native Goal strategy adviser model and configured Apexo agent name.",
  }),
  strategist_every: Schema.optional(NonNegativeInt.check(Schema.isLessThanOrEqualTo(4_294_967_295))).annotate({
    description:
      "Advise after this many unsuccessful Goal verifications (default 5, minimum 1). GROK_GOAL_STRATEGIST_EVERY overrides this setting.",
  }),
  skeptic_models: Schema.optional(Schema.Array(Goal.RoleModel)).annotate({
    description: "Verifier model/agent pairs, assigned round-robin and retained for each Goal across resume.",
  }),
  verifier_count: Schema.optional(NonNegativeInt.check(Schema.isLessThanOrEqualTo(4_294_967_295))).annotate({
    description:
      "Independent Goal verifiers (default: 3; clamped to 1–5). GROK_GOAL_VERIFIER_N overrides this setting.",
  }),
})

export function useCurrentModelOnly(configured: boolean | undefined, raw: string | undefined) {
  return EnvBoolean.parse(raw) ?? configured ?? false
}

export function summaryEnabled(configured: boolean | undefined, raw: string | undefined) {
  return EnvBoolean.parse(raw) ?? configured ?? true
}
