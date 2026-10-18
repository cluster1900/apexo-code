export * as AutoReview from "./auto-review"

// Grok Build Auto-review: a model classifier decides whether a tool call may run without a prompt. The local rule list
// is a fast pre-filter (routine calls pass, known-dangerous patterns escalate) and the fallback when no model answers.
import { autoReview, type AutoReviewVerdict } from "@apexo/sdk/v2/grok-commands"
import { streamText } from "ai"
import { Effect, Schema } from "effect"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"

export const Verdict = Schema.Struct({
  allow: Schema.Boolean,
  reason: Schema.String,
  source: Schema.Literals(["rules", "model", "rules-fallback"]),
})
export type Verdict = typeof Verdict.Type

export type Request = {
  sessionID: string
  permission: string
  patterns: readonly string[]
  metadata: Record<string, unknown>
}

export const SYSTEM = [
  "You are the Auto-review safety classifier for a coding agent.",
  "Decide whether one tool call may run without asking the user.",
  "Allow routine, local, reversible work inside the project (reading, searching, editing project files, builds, tests, read-only git).",
  "Escalate anything destructive, irreversible, outside the project, touching credentials, publishing, pushing, deploying, spending money, or contacting external services with side effects.",
  'Reply with only a JSON object: {"decision":"allow"|"ask","reason":"<short reason>"}.',
].join("\n")

export function prompt(request: Request) {
  return JSON.stringify({ tool: request.permission, patterns: request.patterns, metadata: request.metadata })
}

/** Parse the classifier reply; anything unclear is an escalation, never an approval. */
export function parse(text: string): { allow: boolean; reason: string } | undefined {
  const match = text.replace(/<think>[\s\S]*?<\/think>/g, "").match(/\{[\s\S]*\}/)
  if (!match) return undefined
  try {
    const value = JSON.parse(match[0]) as { decision?: unknown; reason?: unknown }
    if (value.decision !== "allow" && value.decision !== "ask") return undefined
    return { allow: value.decision === "allow", reason: typeof value.reason === "string" ? value.reason : "" }
  } catch {
    return undefined
  }
}

/** Pure decision flow so tests can inject the classifier. */
export async function decide(request: Request, classify?: (request: Request) => Promise<string | undefined>) {
  const rules: AutoReviewVerdict = autoReview(request)
  if (rules.allow) return { allow: true, reason: "routine call (rule pre-filter)", source: "rules" } satisfies Verdict
  if (rules.certain || !classify) return { allow: false, reason: rules.reason, source: "rules" } satisfies Verdict
  const text = await classify(request).catch(() => undefined)
  const parsed = text === undefined ? undefined : parse(text)
  if (!parsed) return { allow: false, reason: rules.reason, source: "rules-fallback" } satisfies Verdict
  return { allow: parsed.allow, reason: parsed.reason || rules.reason, source: "model" } satisfies Verdict
}

/** Uses the session's model (last user message), else the configured default model. */
export const review = Effect.fn("AutoReview.review")(function* (request: Request) {
  const provider = yield* Provider.Service
  const sessions = yield* Session.Service
  const messages = yield* sessions
    .messages({ sessionID: request.sessionID as SessionID })
    .pipe(Effect.orElseSucceed(() => []))
  const last = messages.findLast((item) => item.info.role === "user")?.info
  const ref =
    last && last.role === "user"
      ? { providerID: last.model.providerID, modelID: last.model.modelID }
      : yield* provider.defaultModel().pipe(Effect.orElseSucceed(() => undefined))
  const language = ref
    ? yield* provider.getModel(ref.providerID, ref.modelID).pipe(
        Effect.flatMap((model) => provider.getLanguage(model)),
        Effect.orElseSucceed(() => undefined),
      )
    : undefined
  return yield* Effect.promise(() =>
    decide(
      request,
      language
        ? (input) =>
            // Streaming, like every other apexo model call (some gateways only serve SSE).
            streamText({
              model: language,
              temperature: 0,
              maxRetries: 0,
              messages: [
                { role: "system", content: SYSTEM },
                { role: "user", content: prompt(input) },
              ],
              abortSignal: AbortSignal.timeout(20_000),
              onError: () => {},
            }).text as Promise<string>
        : undefined,
    ),
  )
})
