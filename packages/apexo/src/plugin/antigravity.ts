import type { Hooks } from "@apexo/plugin"
import { Effect, Schema } from "effect"
import { Antigravity } from "@apexo/core/antigravity"
import { Auth } from "@/auth"
import { EffectBridge } from "@/effect/bridge"
import { isRecord } from "@/util/record"

const Body = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
const Frame = Schema.fromJsonString(Schema.Struct({ response: Schema.Record(Schema.String, Schema.Unknown) }))

/** Adapt the Gemini SDK transport; token ownership and refresh stay with agy. */
export function createAntigravityFetch(
  session: () => Promise<{ access: string; projectID: string }>,
  transport: typeof fetch = fetch,
  models: ReturnType<typeof Antigravity.modelGroups> = [],
): (url: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const request = new Request(url, init)
    const model = /\/models\/([^/:]+):(streamGenerateContent|generateContent)/.exec(request.url)
    if (!model) throw new Error("Unsupported Antigravity operation")
    const id = decodeURIComponent(model[1])
    const configured = models.find((item) => item.id === id)
    const body = Schema.decodeUnknownSync(Body)(await request.text())
    const generation = isRecord(body.generationConfig) ? body.generationConfig : undefined
    const thinking = generation && isRecord(generation.thinkingConfig) ? generation.thinkingConfig : undefined
    const effort = thinking?.thinkingLevel
    const variant = configured?.variants.find((item) => item.id === effort)
    if (configured && effort !== undefined && !variant)
      throw new Error(`Unsupported Antigravity reasoning level: ${effort}`)
    if (configured && thinking) {
      // Fixed-tier native IDs own their reasoning settings; do not send a conflicting Gemini override.
      delete thinking.thinkingLevel
      delete thinking.thinkingBudget
      if (variant?.thinkingLevel) thinking.thinkingLevel = variant.thinkingLevel
    }
    const current = await session()
    const headers = new Headers({ "content-type": "application/json", "user-agent": Antigravity.userAgent })
    headers.set("authorization", `Bearer ${current.access}`)
    const response = await transport(
      `${Antigravity.endpoint}/v1internal:${model[2]}${model[2] === "streamGenerateContent" ? "?alt=sse" : ""}`,
      {
        method: "POST",
        headers,
        signal: request.signal,
        body: JSON.stringify({
          project: current.projectID,
          model: variant?.modelID ?? configured?.nativeID ?? id,
          userAgent: "antigravity",
          requestType: "agent",
          requestId: crypto.randomUUID(),
          request: body,
        }),
      },
    )
    if (!response.ok) {
      await response.body?.cancel()
      // Do not propagate upstream bodies that may contain account or request details.
      return Response.json(
        {
          error: {
            code: response.status,
            message: `Antigravity request failed (HTTP ${response.status}). Open agy to check your account.`,
            status: "ANTIGRAVITY_ERROR",
          },
        },
        { status: response.status },
      )
    }
    if (model[2] === "generateContent")
      return Response.json(Schema.decodeUnknownSync(Frame)(await response.text()).response)
    if (!response.body) throw new Error("Antigravity returned an empty stream")
    const buffer = { value: "" }
    return new Response(
      response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(
          new TransformStream<string, string>({
            transform(chunk, controller) {
              buffer.value += chunk
              const lines = buffer.value.split(/\r?\n/)
              buffer.value = lines.pop() ?? ""
              lines.forEach((line) => {
                if (!line.startsWith("data:")) {
                  controller.enqueue(`${line}\n`)
                  return
                }
                const value = line.slice(5).trim()
                if (!value || value === "[DONE]") {
                  controller.enqueue(`${line}\n`)
                  return
                }
                controller.enqueue(`data: ${JSON.stringify(Schema.decodeUnknownSync(Frame)(value).response)}\n`)
              })
            },
            flush(controller) {
              if (!buffer.value.trim()) return
              if (!buffer.value.startsWith("data:")) throw new Error("Incomplete Antigravity stream")
              controller.enqueue(
                `data: ${JSON.stringify(Schema.decodeUnknownSync(Frame)(buffer.value.slice(5).trim()).response)}\n\n`,
              )
            },
          }),
        )
        .pipeThrough(new TextEncoderStream()),
      { headers: { "content-type": "text/event-stream" } },
    )
  }
}

export const AntigravityPlugin = Effect.gen(function* () {
  const native = yield* Antigravity.Service
  const auth = yield* Auth.Service
  const bridge = yield* EffectBridge.make()
  const command = yield* native.command
  const available = yield* native.connect.pipe(Effect.catch(() => Effect.succeed(false)))
  if (available && !(yield* auth.get(Antigravity.providerID)))
    yield* auth.set(Antigravity.providerID, { type: "external", method: 0 })
  const models = available
    ? yield* native.models.pipe(
        Effect.tapError((error) => Effect.logWarning(error.message)),
        Effect.catch(() => Effect.succeed([])),
      )
    : []
  const grouped = Antigravity.modelGroups(models)
  const hooks: Hooks = {
    config: async (config) => {
      if (models.length === 0) return
      config.provider ??= {}
      config.provider.antigravity = {
        name: "Antigravity",
        npm: "@ai-sdk/google",
        api: `${Antigravity.endpoint}/v1beta`,
        ...config.provider.antigravity,
        models: {
          ...Object.fromEntries(
            grouped.map((model) => [
              model.id,
              {
                name: model.name,
                status: model.status,
                variants: Object.fromEntries(
                  model.variants.map((variant) => [
                    variant.id,
                    { thinkingConfig: { includeThoughts: true, thinkingLevel: variant.id } },
                  ]),
                ),
                tool_call: true,
                reasoning: model.supportsThinking,
                attachment: model.supportsImages,
                modalities: { input: model.supportsImages ? ["text", "image"] : ["text"], output: ["text"] },
                limit: { context: model.maxTokens ?? 200_000, output: model.maxOutputTokens ?? 8192 },
              },
            ]),
          ),
          ...config.provider.antigravity?.models,
        },
      }
    },
    auth: {
      provider: Antigravity.providerID,
      methods: [
        {
          type: "external",
          label: "Antigravity (agy)",
          command: [command],
          connect: () => bridge.promise(native.connect),
        },
      ],
      loader: async () => ({
        apiKey: "native-agy-session",
        fetch: createAntigravityFetch(() => bridge.promise(native.session), fetch, grouped),
      }),
    },
  }
  return hooks
})
