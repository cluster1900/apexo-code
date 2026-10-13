import type { Hooks } from "@apexo/plugin"
import { Effect, Schema } from "effect"
import { Antigravity } from "@apexo/core/antigravity"
import { Auth } from "@/auth"
import { EffectBridge } from "@/effect/bridge"

const Body = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
const Frame = Schema.fromJsonString(Schema.Struct({ response: Schema.Record(Schema.String, Schema.Unknown) }))

/** Adapt the Gemini SDK transport; token ownership and refresh stay with agy. */
export function createAntigravityFetch(
  session: () => Promise<{ access: string; projectID: string }>,
  transport: typeof fetch = fetch,
): (url: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const request = new Request(url, init)
    const model = /\/models\/([^/:]+):(streamGenerateContent|generateContent)/.exec(request.url)
    if (!model) throw new Error("Unsupported Antigravity operation")
    const current = await session()
    const headers = new Headers({ "content-type": "application/json", "user-agent": "apexo-antigravity" })
    headers.set("authorization", `Bearer ${current.access}`)
    const response = await transport(
      `${Antigravity.endpoint}/v1internal:${model[2]}${model[2] === "streamGenerateContent" ? "?alt=sse" : ""}`,
      {
        method: "POST",
        headers,
        signal: request.signal,
        body: JSON.stringify({
          project: current.projectID,
          model: decodeURIComponent(model[1]),
          userAgent: "antigravity",
          requestType: "agent",
          requestId: crypto.randomUUID(),
          request: Schema.decodeUnknownSync(Body)(await request.text()),
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
            models.map((model) => [
              model.id,
              {
                name: model.name,
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
        fetch: createAntigravityFetch(() => bridge.promise(native.session)),
      }),
    },
  }
  return hooks
})
