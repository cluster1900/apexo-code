import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("APEXO_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: Config.boolean(name).pipe(Config.option) }).pipe(
    Config.map((flags) => Option.getOrElse(flags.enabled, () => flags.experimental)),
  )

export type RuntimeProfile = "apexo" | "grok-build"

const runtimeProfile = Config.string("APEXO_RUNTIME_PROFILE").pipe(
  Config.withDefault("apexo"),
  Config.map((value): RuntimeProfile => (value === "grok-build" ? "grok-build" : "apexo")),
)
const backgroundSubagents = Config.all({
  profile: runtimeProfile,
  enabled: enabledByExperimental("APEXO_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
}).pipe(Config.map((flags) => flags.profile === "grok-build" || flags.enabled))
const planMode = Config.all({
  profile: runtimeProfile,
  enabled: enabledByExperimental("APEXO_EXPERIMENTAL_PLAN_MODE"),
}).pipe(Config.map((flags) => flags.profile === "grok-build" || flags.enabled))
const lspTool = Config.all({
  profile: runtimeProfile,
  enabled: enabledByExperimental("APEXO_EXPERIMENTAL_LSP_TOOL"),
}).pipe(Config.map((flags) => flags.profile === "grok-build" || flags.enabled))

export class Service extends ConfigService.Service<Service>()("@apexo/RuntimeFlags", {
  runtimeProfile,
  pure: bool("APEXO_PURE"),
  disableDefaultPlugins: bool("APEXO_DISABLE_DEFAULT_PLUGINS"),
  disableEmbeddedWebUi: bool("APEXO_DISABLE_EMBEDDED_WEB_UI"),
  disableExternalSkills: bool("APEXO_DISABLE_EXTERNAL_SKILLS"),
  disableLspDownload: bool("APEXO_DISABLE_LSP_DOWNLOAD"),
  disableClaudeCodePrompt: Config.all({
    broad: bool("APEXO_DISABLE_CLAUDE_CODE"),
    direct: bool("APEXO_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("APEXO_DISABLE_CLAUDE_CODE"),
    direct: bool("APEXO_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  enableExa: Config.all({
    experimental,
    enabled: bool("APEXO_ENABLE_EXA"),
    legacy: bool("APEXO_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("APEXO_ENABLE_PARALLEL"),
    legacy: bool("APEXO_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("APEXO_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("APEXO_ENABLE_QUESTION_TOOL"),
  experimentalReferences: enabledByExperimental("APEXO_EXPERIMENTAL_REFERENCES"),
  experimentalBackgroundSubagents: backgroundSubagents,
  experimentalLspTy: bool("APEXO_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: lspTool,
  experimentalOxfmt: enabledByExperimental("APEXO_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: planMode,
  experimentalCodeMode: enabledByExperimental("APEXO_EXPERIMENTAL_CODE_MODE"),
  experimentalToolSearch: bool("APEXO_EXPERIMENTAL_TOOL_SEARCH"),
  experimentalEventSystem: enabledByExperimental("APEXO_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("APEXO_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("APEXO_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("APEXO_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("APEXO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  experimentalNativeLlm: bool("APEXO_EXPERIMENTAL_NATIVE_LLM"),
  experimentalWebSockets: bool("APEXO_EXPERIMENTAL_WEBSOCKETS"),
  client: Config.string("APEXO_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.layer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const node = LayerNode.make({ service: Service, layer: Service.layer.pipe(Layer.orDie), deps: [] })

export * as RuntimeFlags from "./runtime-flags"
import { LayerNode } from "@apexo/core/effect/layer-node"
