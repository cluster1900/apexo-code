import { RuntimeFlags } from "@/effect/runtime-flags"
import { LayerNode } from "@apexo/core/effect/layer-node"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance-context"
import { Effect, Layer, Context, Schema } from "effect"
import { Config } from "@/config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import { LegacyEvent } from "@apexo/schema/legacy-event"

type State = {
  commands: Record<string, Info>
}

export const Event = {
  Executed: LegacyEvent.CommandExecuted,
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill"])),
  // Some command templates are lazy promises from MCP prompt resolution.
  template: Schema.Unknown,
  subtask: Schema.optional(Schema.Boolean),
  hints: Schema.Array(Schema.String),
}).annotate({ identifier: "Command" })

export type Info = Omit<Schema.Schema.Type<typeof Info>, "template"> & { template: Promise<string> | string }

export function hints(template: string) {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) result.push(match)
  }
  if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
  return result
}

export const Default = {
  INIT: "init",
  REVIEW: "review",
} as const

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/Command") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const flags = yield* RuntimeFlags.Service
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service

    const init = Effect.fn("Command.state")(function* (ctx: InstanceContext) {
      const cfg = yield* config.get()
      const bridge = yield* EffectBridge.make()
      const commands: Record<string, Info> = {}

      commands[Default.INIT] = {
        name: Default.INIT,
        description: "guided AGENTS.md setup",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      }
      commands[Default.REVIEW] = {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "command",
        get template() {
          return PROMPT_REVIEW.replace("${path}", ctx.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      }

      if (flags.runtimeProfile === "grok-build") {
        for (const [name, template] of Object.entries({
          imagine:
            "Generate an image with image_gen for this description: $ARGUMENTS. If the description is empty, show usage: /imagine <description>. For an edit to an existing image, use image_edit instead. Return the saved image and preview.",
          "imagine-video":
            "Generate a video for this description: $ARGUMENTS. If the description is empty, show usage: /imagine-video <description>. Use reference_to_video when references or pinned frames are supplied. Otherwise generate a starting image with image_gen, then animate it with image_to_video. Return the saved video and preview.",
        })) {
          commands[name] = {
            name,
            description:
              name === "imagine" ? "Generate an image from a description" : "Generate a video from a description",
            source: "command",
            template,
            hints: hints(template),
          }
        }
        const loop =
          "Create a recurring schedule with scheduler_create for: $ARGUMENTS. Parse the interval and the self-contained prompt; accept forms such as 5m, 1 hour, or every 2 days. Clamp intervals below 60 seconds to 60 seconds. If the interval or prompt is missing, ask the user before creating a schedule. Set fire_immediately=true. Explain that each fire runs in a detached subagent, repeats for up to 7 days, and can be stopped with scheduler_delete. Do not run a shell polling loop."
        commands.loop = {
          name: "loop",
          description: "Run a prompt on a recurring interval",
          source: "command",
          template: loop,
          hints: hints(loop),
        }

        for (const [name, operation] of Object.entries({
          memory: "read",
          remember: "remember",
          flush: "flush",
          dream: "dream",
        })) {
          if (flags.grokMemory === false) continue
          const template =
            operation === "read"
              ? "Use the memory tool with operation=read for both scope=global and scope=workspace and show the saved notes grouped by scope. Optional search: $ARGUMENTS"
              : operation === "dream"
                ? "Use the memory tool with operation=dream to consolidate this workspace's notes. Report the result."
                : `Use the memory tool with operation=${operation}. Choose scope=global for cross-project preferences or scope=workspace for repository knowledge. ${operation === "flush" ? "Summarize durable facts and decisions from this conversation into content; omit secrets and temporary progress." : "Save the following user-provided note as content:"} $ARGUMENTS`
          commands[name] = {
            name,
            description: `Global and repository memory: ${operation}`,
            source: "command",
            template,
            hints: hints(template),
          }
        }
      }

      for (const [name, command] of Object.entries(cfg.command ?? {})) {
        commands[name] = {
          name,
          agent: command.agent,
          model: command.model,
          description: command.description,
          source: "command",
          get template() {
            return command.template
          },
          subtask: command.subtask,
          hints: hints(command.template),
        }
      }

      for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
        commands[name] = {
          name,
          source: "mcp",
          description: prompt.description,
          get template() {
            return bridge.promise(
              mcp
                .getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                )
                .pipe(
                  Effect.map(
                    (template) =>
                      template?.messages
                        .map((message) => (message.content.type === "text" ? message.content.text : ""))
                        .join("\n") || "",
                  ),
                ),
            )
          },
          hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
        }
      }

      return {
        commands,
      }
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      if (s.commands[name]) return s.commands[name]
      const item = yield* skill.get(name)
      return item ? skillCommand(item) : undefined
    })

    const list = Effect.fn("Command.list")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.commands).concat(
        (yield* skill.all()).flatMap((item) => (s.commands[item.name] ? [] : [skillCommand(item)])),
      )
    })

    return Service.of({ get, list })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, MCP.node, Skill.node, RuntimeFlags.node],
})

export * as Command from "."

function skillCommand(item: Skill.Info): Info {
  const dir = item.location === "<built-in>" ? undefined : path.dirname(item.location)
  return {
    name: item.name,
    description: item.description,
    source: "skill",
    get template() {
      if (!dir) return item.content
      return [
        item.content,
        "",
        `Base directory for this skill: ${dir}`,
        "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
      ].join("\n")
    },
    hints: [],
  }
}
