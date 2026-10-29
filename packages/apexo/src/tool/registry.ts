import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionSchedulerOwner } from "@apexo/core/session/scheduler-owner"
import { Auth } from "@/auth"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { httpClient } from "@apexo/core/effect/app-node-platform"
import { Ripgrep } from "@apexo/core/ripgrep"
import { PlanExitTool } from "./plan"
import { PlanEnterTool } from "./plan-enter"
import { Session } from "@/session/session"
import { QuestionTool } from "./question"
import { ShellTool } from "./shell"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { Database } from "@apexo/core/database/database"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionFeedback } from "@apexo/core/session/feedback"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import * as Tool from "./tool"
import { Config } from "@/config/config"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@apexo/plugin"
import type { JSONSchema7, JSONSchema7Definition } from "@ai-sdk/provider"
import { Schema } from "effect"
import z from "zod"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"

import { WebSearchTool } from "./websearch"
import { LspTool } from "./lsp"
import * as Truncate from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "@apexo/core/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context, Scope, Exit } from "effect"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "../session/instruction"
import { FSUtil } from "@apexo/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MemorySearch } from "@apexo/core/memory-search"
import { MemoryIndex } from "@/session/memory-index"
import { SessionMemoryDream } from "@/session/memory-dream"
import { SessionMemoryMode } from "@/session/memory-mode"
import { SessionMemoryBackend } from "@/session/memory-backend"
import { SessionID } from "@/session/schema"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { MCP } from "@/mcp"
import { PermissionV1 } from "@apexo/core/v1/permission"
import { McpCatalog } from "@/mcp/catalog"
import { Scheduler } from "@apexo/core/scheduler"
import { SchedulerStore } from "@apexo/core/scheduler-store"
import { GrokBuildTools } from "./grok-build"
import { ComputerTool } from "./computer"
import { Computer } from "@apexo/core/computer"
import { LocationServiceMap, locationServiceMapLayer } from "@apexo/core/location-services"

export function webSearchEnabled(flags = { exa: false, parallel: false }) {
  return flags.exa || flags.parallel
}

const locationServiceMapNode = LayerNode.make({
  service: LocationServiceMap.Service,
  layer: locationServiceMapLayer,
  deps: [],
})

type TaskDef = Tool.InferDef<typeof TaskTool>
type ReadDef = Tool.InferDef<typeof ReadTool>

type State = {
  memory?: Effect.Effect<MemorySearch.Interface, MemorySearch.MemoryError>
  scheduler: Scheduler.Interface
  custom: Tool.Def[]
  builtin: Tool.Def[]
  task: TaskDef
  read: ReadDef
}

export interface Interface {
  readonly scheduler: () => Effect.Effect<Scheduler.Interface>
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
  readonly tools: (model: {
    providerID: ProviderV2.ID
    modelID: ModelV2.ID
    agent: Agent.Info
    permission?: PermissionV1.Ruleset
    sessionID?: SessionID
  }) => Effect.Effect<Tool.Def[]>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/ToolRegistry") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const truncate = yield* Truncate.Service
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const lifecycle = yield* SessionLifecycle.Service
    const goals = SessionGoal.make(database.db)
    const feedback = SessionFeedback.make(database.db)
    const auth = yield* Auth.Service
    const provider = yield* Provider.Service
    const mcp = yield* MCP.Service
    const background = yield* BackgroundJob.Service
    const dream = yield* SessionMemoryDream.Service
    const memoryIndex = yield* MemoryIndex.Service
    const memoryMode = yield* SessionMemoryMode.Service
    const memoryBackend = yield* SessionMemoryBackend.Service

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const read = yield* ReadTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const lsptool = yield* LspTool
    const planEnter = yield* PlanEnterTool
    const plan = yield* PlanExitTool
    const webfetch = yield* WebFetchTool
    const websearch = yield* WebSearchTool
    const shell = yield* ShellTool
    const globtool = yield* GlobTool
    const writetool = yield* WriteTool
    const edit = yield* EditTool
    const greptool = yield* GrepTool
    const patchtool = yield* ApplyPatchTool
    const computer = yield* ComputerTool
    const skilltool = yield* SkillTool
    const agent = yield* Agent.Service
    const codeMode = flags.experimentalCodeMode ? yield* Effect.promise(() => import("./code-mode")) : undefined
    const codeModeTool = codeMode ? yield* codeMode.CodeModeTool : undefined

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        const storageScope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
        const store =
          flags.runtimeProfile === "grok-build"
            ? yield* SchedulerStore.make(ctx.directory).pipe(Effect.provideService(Scope.Scope, storageScope))
            : undefined
        const scheduler = Scheduler.make(background, store, SessionSchedulerOwner.make(database.db, lifecycle))
        const memory = flags.runtimeProfile === "grok-build" ? memoryIndex.get() : undefined
        // Stop workers before releasing their cross-process ownership leases.
        yield* Effect.addFinalizer(() => scheduler.shutdown)
        const custom: Tool.Def[] = []

        function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
          // Plugin tools still expose Zod args publicly; keep that compatibility
          // boxed at the registry boundary and give the LLM the original JSON Schema.
          // Normalize missing args to `{}` once — pre-1.14.49 the code was
          // `z.object(def.args)` and Zod silently tolerated undefined (#27451, #27630).
          const args = def.args ?? {}
          const entries = Object.entries(args)
          const allZod = entries.every((entry) => isZodType(entry[1]))
          const zodParams = allZod ? z.object(args) : undefined
          const jsonSchema = zodParams ? zodJsonSchema(zodParams) : legacyJsonSchema(entries)
          const parameters = zodParams
            ? Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success)
            : Schema.Unknown
          return {
            id,
            parameters,
            jsonSchema,
            description: def.description,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                // Bridge the host's Effect-based `ask` into a Promise-returning
                // function for the plugin to make sure context persists
                const bridge = yield* EffectBridge.make()
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  ask: (req) => bridge.promise(toolCtx.ask(req)),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const attachments = typeof result === "string" ? undefined : result.attachments
                const info = yield* agent.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: typeof result === "string" ? "" : (result.title ?? ""),
                  output: out.truncated ? out.content : output,
                  attachments,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputPath: out.outputPath }),
                  },
                }
              }).pipe(
                Effect.withSpan("Tool.execute", {
                  attributes: {
                    "tool.name": id,
                    "session.id": toolCtx.sessionID,
                    "message.id": toolCtx.messageID,
                    ...(toolCtx.callID ? { "tool.call_id": toolCtx.callID } : {}),
                  },
                }),
              ),
          }
        }

        const dirs = yield* config.directories()
        const matches = dirs.flatMap((dir) =>
          Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
        )
        if (matches.length) yield* config.waitForDependencies()
        for (const match of matches) {
          const namespace = path.basename(match, path.extname(match))
          // `match` is an absolute filesystem path from `Glob.scanSync(..., { absolute: true })`.
          // Import it as `file://` so Node on Windows accepts the dynamic import.
          const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
          for (const [id, def] of Object.entries(mod)) {
            if (!isPluginTool(def)) continue
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }

        yield* config.get()
        const questionEnabled = ["app", "cli", "desktop"].includes(flags.client) || flags.enableQuestionTool

        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          shell: Tool.init(shell),
          read: Tool.init(read),
          glob: Tool.init(globtool),
          grep: Tool.init(greptool),
          edit: Tool.init(edit),
          write: Tool.init(writetool),
          task: Tool.init(task),
          fetch: Tool.init(webfetch),
          todo: Tool.init(todo),
          search: Tool.init(websearch),
          skill: Tool.init(skilltool),
          patch: Tool.init(patchtool),
          computer: Tool.init(computer),
          question: Tool.init(question),
          lsp: Tool.init(lsptool),
          planEnter: Tool.init(planEnter),
          plan: Tool.init(plan),
          ...(codeModeTool ? { execute: Tool.init(codeModeTool) } : {}),
        })

        return {
          memory,
          custom,
          builtin: [
            tool.invalid,
            ...(questionEnabled ? [tool.question] : []),
            tool.shell,
            tool.read,
            tool.glob,
            tool.grep,
            tool.edit,
            tool.write,
            tool.task,
            tool.fetch,
            tool.todo,
            tool.search,
            tool.skill,
            tool.patch,
            tool.computer,
            ...(tool.execute ? [tool.execute] : []),
            ...(flags.experimentalLspTool ? [tool.lsp] : []),
            ...(flags.experimentalPlanMode && (flags.client === "cli" || flags.runtimeProfile === "grok-build")
              ? [tool.planEnter, tool.plan]
              : []),
          ],
          scheduler,
          task: tool.task,
          read: tool.read,
        }
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin, ...s.custom] as Tool.Def[]
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info) {
      const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
      const filtered = items.filter(
        (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
      )
      const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
      const description = list
        .map(
          (item) =>
            `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
        )
        .join("\n")
      return ["Available agent types and the tools they have access to:", description].join("\n")
    })

    const describeCodeMode = Effect.fn("ToolRegistry.describeCodeMode")(function* (input: {
      agent: Agent.Info
      permission?: PermissionV1.Ruleset
    }) {
      if (!codeMode) return
      const ruleset = Permission.merge(input.agent.permission, input.permission ?? [])
      const tools = Permission.visibleTools(yield* mcp.tools(), ruleset)
      if (Object.keys(tools).length === 0) return
      return codeMode.describeCatalog(tools, Object.keys(yield* mcp.clients()).map(McpCatalog.sanitize))
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const filtered = (yield* all()).filter((tool) => {
        if (tool.id === WebSearchTool.id) {
          return webSearchEnabled({ exa: flags.enableExa, parallel: flags.enableParallel })
        }

        const usePatch =
          input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4")
        if (tool.id === ApplyPatchTool.id) return usePatch
        if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch

        return true
      })

      const codeModeDescription = filtered.some((tool) => tool.id === "execute")
        ? yield* describeCodeMode(input)
        : undefined
      const visible = filtered.filter((tool) => tool.id !== "execute" || codeModeDescription)

      const result = yield* Effect.forEach(
        visible,
        Effect.fnUntraced(function* (tool: Tool.Def) {
          const output = {
            description: tool.description,
            parameters: tool.parameters,
            jsonSchema: tool.jsonSchema,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          const jsonSchema =
            output.parameters === tool.parameters || output.jsonSchema !== tool.jsonSchema
              ? output.jsonSchema
              : undefined
          return {
            id: tool.id,
            description: [
              output.description,
              tool.id === TaskTool.id ? yield* describeTask(input.agent) : undefined,
              tool.id === "execute" ? codeModeDescription : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: output.parameters,
            jsonSchema,
            execute: tool.execute,
            formatValidationError: tool.formatValidationError,
          }
        }),
        { concurrency: "unbounded" },
      )

      const cfg = yield* config.get()
      const envS3 =
        cfg.media?.video_output?.type === "s3" &&
        process.env[cfg.media.video_output.read_write.access_key_id_env]?.trim() &&
        process.env[cfg.media.video_output.read_write.secret_access_key_env]?.trim()
          ? {
              bucket: cfg.media.video_output.bucket,
              endpoint: cfg.media.video_output.endpoint,
              region: cfg.media.video_output.region,
              key_prefix: cfg.media.video_output.key_prefix,
              expires_secs: cfg.media.video_output.expires_secs,
              zdr_only: cfg.media.video_output.zdr_only,
              read_write: {
                access_key_id: process.env[cfg.media.video_output.read_write.access_key_id_env]!,
                secret_access_key: process.env[cfg.media.video_output.read_write.secret_access_key_env]!,
              },
              ...(cfg.media.video_output.read_only &&
              process.env[cfg.media.video_output.read_only.access_key_id_env]?.trim() &&
              process.env[cfg.media.video_output.read_only.secret_access_key_env]?.trim()
                ? {
                    read_only: {
                      access_key_id: process.env[cfg.media.video_output.read_only.access_key_id_env]!,
                      secret_access_key: process.env[cfg.media.video_output.read_only.secret_access_key_env]!,
                    },
                  }
                : {}),
            }
          : undefined
      const adapted =
        flags.runtimeProfile === "grok-build"
          ? GrokBuildTools.adaptTools(result, {
              bash: cfg.toolset?.bash,
              goals,
              feedback,
              directory: yield* InstanceState.directory,
              projectID: (yield* InstanceState.context).project.id,
              memory: (yield* InstanceState.get(state)).memory,
              memoryAccess: (ctx, operation) => {
                const revision = ctx.extra?.memoryRevision
                if (typeof revision !== "string") return Effect.die(new Error("Memory requires an active session"))
                return memoryMode.commit(ctx.sessionID, revision, operation).pipe(Effect.orDie)
              },
              dream: (ctx) =>
                Effect.gen(function* () {
                  return yield* dream.run(ctx.sessionID, {
                    signal: ctx.abort,
                    authorize: (paths) =>
                      Effect.forEach(["read", "edit"], (permission) =>
                        ctx.ask({
                          permission,
                          patterns: paths,
                          always: paths,
                          metadata: { operation: "dream" },
                        }),
                      ).pipe(Effect.asVoid),
                  })
                }),
              background,
              maxWaitMs: flags.grokMaxWaitBlockMs,
              profileExtensions: true,
              scheduler: (yield* InstanceState.get(state)).scheduler,
              media: {
                outputS3: cfg.grok_media?.zdr_video_output_s3 ?? envS3,
                imageGenModelOverride:
                  cfg.grok_media?.image_gen_model_override ?? cfg.media?.image_gen_model_override,
                imageEditModelOverride:
                  cfg.grok_media?.image_edit_model_override ?? cfg.media?.image_edit_model_override,
                disableZdrIncompatibleTools:
                  cfg.grok_media?.disable_zdr_incompatible_tools === true ||
                  cfg.media?.disable_zdr_incompatible_tools === true,
                teamBlockedReasons: [
                  ...(cfg.grok_media?.team_blocked_reasons ?? []),
                  ...(cfg.media?.team_blocked_reasons ?? []),
                ],
                transport: Effect.gen(function* () {
                  const env = process.env.XAI_API_KEY ?? process.env.GROK_API_KEY
                  if (env) return { key: env }
                  const xai = yield* provider.getProvider(ProviderV2.ID.make("xai"))
                  const value = yield* auth.get("xai").pipe(Effect.orDie)
                  const key =
                    value?.type === "api"
                      ? value.key
                      : typeof xai?.options.apiKey === "string"
                        ? xai.options.apiKey
                        : xai?.key
                  if (!key) return undefined
                  return {
                    key,
                    ...(typeof xai?.options.fetch === "function" ? { fetch: xai.options.fetch as typeof fetch } : {}),
                    ...(typeof xai?.options.baseURL === "string" ? { baseURL: xai.options.baseURL } : {}),
                  }
                }),
              },
              shell: result.find((tool) => tool.id === "bash"),
              task: result.find((tool) => tool.id === "task"),
            })
          : result
      const enabled =
        (yield* memoryMode.get(input.sessionID)).enabled &&
        (yield* memoryBackend.get(input.sessionID)).backend === "legacy"
      return adapted
        .filter((item) => enabled || !["memory", "memory_search", "memory_get"].includes(item.id))
        .map((item) => {
          if (!["memory", "memory_search", "memory_get"].includes(item.id)) return item
          return {
            ...item,
            execute: (args: unknown, ctx: Tool.Context) =>
              memoryMode
                .run(ctx.sessionID, (revision) =>
                  item.execute(args, { ...ctx, extra: { ...ctx.extra, memoryRevision: revision } }),
                )
                .pipe(Effect.orDie),
          }
        })
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return { task: s.task, read: s.read }
    })

    return Service.of({ ids, all, named, tools, scheduler: () => InstanceState.use(state, (value) => value.scheduler) })
  }),
)

function isZodType(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value
}

function isPluginTool(value: unknown): value is ToolDefinition {
  return typeof value === "object" && value !== null && "args" in value && "description" in value && "execute" in value
}

function isJsonSchemaDefinition(value: unknown): value is JSONSchema7Definition {
  return typeof value === "boolean" || (typeof value === "object" && value !== null && !Array.isArray(value))
}

function legacyJsonSchema(entries: [string, unknown][]): JSONSchema7 {
  const properties = Object.fromEntries(
    entries.filter((entry): entry is [string, JSONSchema7Definition] => isJsonSchemaDefinition(entry[1])),
  )
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
  }
}

function zodJsonSchema(schema: z.ZodType): JSONSchema7 {
  const result = normalizeZodJsonSchema(z.toJSONSchema(schema, { io: "input", metadata: zodMetadataRegistry(schema) }))
  if (!isJsonSchemaObject(result)) throw new Error("plugin tool Zod schema produced a non-object JSON Schema")
  const { $defs, ...rest } = result
  return (
    $defs && isJsonSchemaObject($defs) ? { ...rest, definitions: $defs as JSONSchema7["definitions"] } : rest
  ) as JSONSchema7
}

function zodMetadataRegistry(schema: z.ZodType) {
  const registry = z.registry<Record<string, unknown>>()
  const seen = new WeakSet<object>()
  const collect = (value: unknown) => {
    if (typeof value !== "object" || value === null) return
    if (seen.has(value)) return
    seen.add(value)

    if (isZodType(value)) {
      const metadata = typeof value.meta === "function" ? value.meta() : undefined
      const description = typeof value.description === "string" ? value.description : undefined
      const merged = {
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        ...(description ? { description } : {}),
      }
      if (Object.keys(merged).length) registry.add(value, merged)
      collect(value._zod.def)
      return
    }

    for (const item of Object.values(value)) collect(item)
  }
  collect(schema)
  return registry
}

function normalizeZodJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeZodJsonSchema(item))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) =>
        (entry[0] === "exclusiveMaximum" || entry[0] === "exclusiveMinimum") && typeof entry[1] === "boolean"
          ? false
          : true,
      )
      .map(([key, item]) => [key, normalizeZodJsonSchema(item)]),
  )
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    Auth.node,
    Config.node,
    Plugin.node,
    Question.node,
    Todo.node,
    Agent.node,
    Skill.node,
    Session.node,
    BackgroundJob.node,
    Provider.node,
    LSP.node,
    Instruction.node,
    FSUtil.node,
    EventV2Bridge.node,
    httpClient,
    CrossSpawnSpawner.node,
    Format.node,
    Truncate.node,
    RuntimeFlags.node,
    MCP.node,
    Database.node,
    SessionLifecycle.node,
    Ripgrep.node,
    SessionMemoryDream.node,
    MemoryIndex.node,
    SessionMemoryMode.node,
    SessionMemoryBackend.node,
    locationServiceMapNode,
  ],
})

export * as ToolRegistry from "./registry"
