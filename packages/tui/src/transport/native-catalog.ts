import type { Agent, Model, Provider, Session } from "@apexo/sdk/v2"
import type { NativeSessionTransport } from "./native-session"

type Catalog = Awaited<ReturnType<NativeSessionTransport["catalog"]>>

// Terminal display compatibility only, following the existing App normalization.
// Missing legacy integration fields never become execution or permission authority.
export function terminalCatalog(catalog: Catalog) {
  const providers = catalog.providers
    .filter((item) => !item.disabled)
    .map(
      (provider): Provider => ({
        id: provider.id,
        name: provider.name,
        source: "custom",
        env: [],
        options: provider.request.body,
        models: Object.fromEntries(
          catalog.models
            .filter((model) => model.enabled && model.providerID === provider.id)
            .map((model) => {
              const cost = model.cost.find((value) => !value.tier) ?? model.cost[0]
              const display: Model = {
                id: model.id,
                providerID: model.providerID,
                name: model.name,
                family: model.family ?? undefined,
                api: {
                  id: model.api.id,
                  url: model.api.url ?? "",
                  npm: model.api.type === "aisdk" ? model.api.package : "",
                },
                capabilities: {
                  temperature: false,
                  reasoning: false,
                  interleaved: false,
                  toolcall: model.capabilities.tools,
                  attachment: model.capabilities.input.some((item) => item !== "text"),
                  input: {
                    text: model.capabilities.input.includes("text"),
                    image: model.capabilities.input.includes("image"),
                    audio: model.capabilities.input.includes("audio"),
                    video: model.capabilities.input.includes("video"),
                    pdf: model.capabilities.input.includes("pdf"),
                  },
                  output: {
                    text: model.capabilities.output.includes("text"),
                    image: model.capabilities.output.includes("image"),
                    audio: model.capabilities.output.includes("audio"),
                    video: model.capabilities.output.includes("video"),
                    pdf: model.capabilities.output.includes("pdf"),
                  },
                },
                cost: {
                  input: cost?.input ?? 0,
                  output: cost?.output ?? 0,
                  cache: cost?.cache ?? { read: 0, write: 0 },
                },
                limit: { ...model.limit, input: model.limit.input ?? undefined },
                status: model.status,
                options: model.request.body,
                headers: model.request.headers,
                release_date: new Date(model.time.released).toISOString().slice(0, 10),
                variants: Object.fromEntries(model.variants.map((variant) => [variant.id, variant.body])),
              }
              return [model.id, display]
            }),
        ),
      }),
    )
  const agents = catalog.agents.map(
    (agent): Agent => ({
      name: agent.id,
      description: agent.description ?? undefined,
      mode: agent.mode,
      hidden: agent.hidden,
      color: agent.color ?? undefined,
      steps: agent.steps ?? undefined,
      options: agent.request.body,
      model: agent.model ? { modelID: agent.model.id, providerID: agent.model.providerID } : undefined,
      variant: agent.model?.variant ?? undefined,
      permission: agent.permissions.map((rule) => ({
        permission: rule.action,
        pattern: rule.resource,
        action: rule.effect,
      })),
    }),
  )
  return {
    commands: catalog.commands.map((command) => ({
      name: command.name,
      description: command.description ?? undefined,
      template: command.template,
      hints: ["[interval] <prompt>"],
    })),
    providers,
    agents,
    defaults: Object.fromEntries(
      providers.flatMap((provider) => {
        const first = Object.keys(provider.models)[0]
        return first ? [[provider.id, first]] : []
      }),
    ),
  }
}

export function terminalSession(input: Awaited<ReturnType<NativeSessionTransport["get"]>>): Session {
  return {
    id: input.id,
    slug: input.id,
    projectID: input.projectID,
    directory: input.location.directory,
    workspaceID: input.location.workspaceID ?? undefined,
    path: input.subpath ?? undefined,
    parentID: input.parentID ?? undefined,
    title: input.title,
    agent: input.agent ?? undefined,
    model: input.model ? { ...input.model, variant: input.model.variant ?? undefined } : undefined,
    cost: input.cost,
    tokens: input.tokens,
    version: "",
    time: { ...input.time, archived: input.time.archived ?? undefined },
  }
}
