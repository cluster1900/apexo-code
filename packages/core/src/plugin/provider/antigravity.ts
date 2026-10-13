import { Effect, Stream } from "effect"
import { Antigravity } from "../../antigravity"
import { Integration } from "../../integration"
import { Catalog } from "../../catalog"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { EventV2 } from "../../event"
import { define } from "../internal"

export const AntigravityPlugin = define({
  id: "antigravity",
  effect: Effect.fn(function* () {
    const native = yield* Antigravity.Service
    const integrations = yield* Integration.Service
    const catalog = yield* Catalog.Service
    const events = yield* EventV2.Service
    const integrationID = Integration.ID.make(Antigravity.providerID)
    const methodID = Integration.MethodID.make(Antigravity.methodID)
    const providerID = ProviderV2.ID.make(Antigravity.providerID)
    const command = yield* native.command

    yield* integrations.transform((draft) =>
      Effect.sync(() => {
        draft.update(integrationID, (integration) => {
          integration.name = "Antigravity"
        })
        draft.method.update({
          integrationID,
          method: { id: methodID, type: "external", label: "Antigravity (agy)", command: [command] },
          available: native.connect,
          resolve: native.session.pipe(
            Effect.map((session) => ({
              type: "key" as const,
              key: session.access,
              metadata: { projectID: session.projectID },
            })),
          ),
        })
      }),
    )

    yield* integrations.connection.external({ integrationID, methodID }).pipe(Effect.ignore)

    yield* catalog.transform((draft) =>
      Effect.gen(function* () {
        draft.provider.update(providerID, (provider) => {
          provider.name = "Antigravity"
          provider.integrationID = integrationID
          provider.api = { type: "native", url: Antigravity.endpoint, settings: {} }
        })
        if (!(yield* native.available.pipe(Effect.catch(() => Effect.succeed(false))))) return
        const models = yield* native.models.pipe(
          Effect.tapError((error) => Effect.logWarning(error.message)),
          Effect.catch(() => Effect.succeed([])),
        )
        models.forEach((item) =>
          draft.model.update(providerID, ModelV2.ID.make(item.id), (model) => {
            model.name = item.name
            model.limit = { context: item.maxTokens ?? 200_000, output: item.maxOutputTokens ?? 8192 }
            model.capabilities = {
              tools: true,
              input: item.supportsImages ? ["text", "image"] : ["text"],
              output: ["text"],
            }
            model.request.body = {}
            if (item.supportsThinking && item.id.endsWith("-tiered")) {
              model.variants = ["low", "medium", "high"].map((id) => ({
                id: ModelV2.VariantID.make(id),
                headers: {},
                body: { thinkingConfig: { thinkingLevel: id, includeThoughts: true } },
              }))
            }
          }),
        )
      }),
    )

    yield* events.subscribe(Integration.Event.ConnectionUpdated).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(() => catalog.reload()),
      Effect.forkScoped,
    )
  }),
})
