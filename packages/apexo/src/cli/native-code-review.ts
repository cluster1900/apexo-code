import path from "node:path"
import { CodeReview } from "@apexo/schema/code-review"
import { Model } from "@apexo/schema/model"
import { Provider } from "@apexo/schema/provider"
import { SessionID } from "@apexo/schema/session-id"
import { Schema } from "effect"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { nativeSessionTransport } from "@apexo/tui/transport/native-session"
import type { ReviewPromptInput } from "./cmd/review"
import { parseRunGuardrails, writeLastMessage } from "./run-output-options"
import { formatCodeReview, codeReviewExitCode } from "./code-review-output"

export interface Options {
  attach?: string
  dir?: string
  username?: string
  password?: string
  model?: string
  variant?: string
  agent?: string
  format: "default" | "json" | "streaming-json"
  "session-protocol": "auto" | "native" | "compatibility"
  "output-schema"?: string
  "output-last-message"?: string
  ephemeral?: boolean
  "max-turns"?: number
  "max-tokens"?: number
  "max-budget-usd"?: number
  "fallback-model"?: string
  "fail-on"?: CodeReview.Priority
  "wait-for-background": boolean
  "background-wait-timeout": number
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
export function reviewApiSupports(document: unknown, fields: readonly string[] = []) {
  const doc = record(document)
  const operation = record(record(record(doc.paths)["/api/session/{sessionID}/review"]).post)
  if (!Object.keys(operation).length) return false
  const schema = record(record(record(record(operation.requestBody).content)["application/json"]).schema)
  const body =
    typeof schema.$ref === "string"
      ? record(record(record(doc.components).schemas)[schema.$ref.split("/").at(-1)!])
      : schema
  return fields.every((field) => field in record(body.properties))
}

/** False selects the existing generic path, always before any review is admitted. */
export async function runNativeCodeReview(args: Options, input: ReviewPromptInput) {
  if (args["output-schema"] || args["session-protocol"] === "compatibility") {
    if (args["fail-on"])
      throw new Error(
        args["output-schema"]
          ? "--fail-on requires native structured review and cannot be combined with --output-schema"
          : "--fail-on requires native structured review and cannot be used with --session-protocol compatibility",
      )
    return false
  }
  const limits = parseRunGuardrails({
    model: args.model,
    maxTurns: args["max-turns"],
    maxTokens: args["max-tokens"],
    maxBudgetUsd: args["max-budget-usd"],
    fallbackModel: args["fallback-model"],
  })
  const parts = args.model?.trim().split("/")
  if (parts && (!parts[0] || !parts.slice(1).join("/"))) throw new Error("--model requires provider/model syntax")
  const { ServerAuth } = await import("../server/auth")
  const headers = ServerAuth.headers({ username: args.username, password: args.password })
  const root = process.cwd()
  const local = args.attach
    ? undefined
    : await (async () => {
        const { nativeLocalDirectory } = await import("./native-local")
        const { createNativeLocalHost } = await import("./native-local-host")
        return { directory: await nativeLocalDirectory(args.dir ?? root), host: createNativeLocalHost(undefined, true) }
      })()
  const directory = args.attach ? args.dir : local?.directory
  const host = local?.host
  const baseUrl = args.attach ?? "http://apexo.local"
  const fetcher = host?.fetch ?? globalThis.fetch
  const sdk = createApexoClient({ baseUrl, fetch: fetcher, directory, headers })
  const requests = new AbortController()
  const state: {
    signal?: "SIGINT" | "SIGTERM"
    sessionID?: string
    attempted: boolean
    complete: boolean
    cleanupConfirmed: boolean
    cleanupFailed: boolean
  } = { attempted: false, complete: false, cleanupConfirmed: false, cleanupFailed: false }
  const reviewID = CodeReview.ID.create()
  const interrupt = () => {
    state.signal ??= "SIGINT"
    requests.abort()
  }
  const terminate = () => {
    state.signal ??= "SIGTERM"
    requests.abort()
  }
  process.on("SIGINT", interrupt)
  process.on("SIGTERM", terminate)
  try {
    if (args.attach) {
      const fields = [
        ...(args.model || args.variant ? ["model"] : []),
        ...(args.agent ? ["agent"] : []),
        ...(Object.keys(limits).length ? ["limits"] : []),
      ]
      const response = await fetcher(new URL("/openapi.json", baseUrl), { headers, signal: AbortSignal.timeout(10000) })
      const doc =
        response.status === 404
          ? await fetcher(new URL("/doc", baseUrl), { headers, signal: AbortSignal.timeout(10000) })
          : response
      if (doc.status === 401 || doc.status === 403) throw new Error("Review server authentication failed")
      const supported = doc.ok && reviewApiSupports(await doc.json(), fields)
      if (!supported) {
        if (args["session-protocol"] === "native" || args["fail-on"] || Object.keys(limits).length)
          throw new Error("Attached server does not support the requested native review API/options")
        process.stderr.write("Native code review is unavailable; using the generic review path.\n")
        return false
      }
    }
    if (!args["wait-for-background"] || args["background-wait-timeout"] !== 600)
      throw new Error("Background wait overrides are unavailable for native read-only reviews")
    const transport = nativeSessionTransport(sdk, directory)
    const catalog = await transport.catalog(AbortSignal.timeout(10000))
    const agent = args.agent ?? catalog.agents.find((agent) => !agent.hidden && agent.mode !== "subagent")?.id
    const configured = catalog.agents.find((item) => item.id === agent)?.model
    const fallback = catalog.models.find(
      (item) =>
        item.enabled && catalog.providers.some((provider) => provider.id === item.providerID && !provider.disabled),
    )
    const selected = configured ?? fallback
    const model = parts
      ? {
          providerID: Provider.ID.make(parts[0]),
          id: Model.ID.make(parts.slice(1).join("/")),
          ...(args.variant ? { variant: args.variant } : {}),
        }
      : selected
        ? {
            providerID: Provider.ID.make(selected.providerID),
            id: Model.ID.make(selected.id),
            ...(args.variant ? { variant: args.variant } : {}),
          }
        : undefined
    for (const requested of [model, limits.fallbackModel].filter((value) => value !== undefined)) {
      if (
        !catalog.models.some(
          (item) =>
            item.enabled &&
            item.providerID === requested.providerID &&
            item.id === requested.id &&
            catalog.providers.some((provider) => provider.id === item.providerID && !provider.disabled),
        )
      )
        throw new Error(`Model unavailable: ${requested.providerID}/${requested.id}`)
    }
    if (state.signal) {
      state.cleanupConfirmed = true
      return true
    }
    state.sessionID = SessionID.create()
    const session = await transport.create(
      { id: state.sessionID, agent, model, location: { directory: catalog.location.directory } },
      AbortSignal.timeout(10000),
    )
    state.sessionID = session.id
    if (state.signal) {
      state.cleanupConfirmed = true
      return true
    }
    const target: CodeReview.Target = input.base
      ? { type: "base", ref: input.base.trim() }
      : input.commit
        ? { type: "commit", ref: input.commit.trim() }
        : input.pr
          ? { type: "pr", ref: input.pr.trim() }
          : { type: "uncommitted" }
    state.attempted = true
    const admitted = await sdk.v2.codeReview.start(
      {
        sessionID: session.id,
        codeReviewInput: {
          id: reviewID,
          target,
          ...(input.prompt ? { focus: input.prompt } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(model ? { model } : {}),
          ...(agent ? { agent } : {}),
          limits: { mode: "headless", permissions: "reject", ...limits },
        },
      },
      { throwOnError: true, signal: AbortSignal.timeout(10000) },
    )
    const current = { run: Schema.decodeUnknownSync(CodeReview.Run)(admitted.data), revision: -1 }
    while (!state.signal) {
      if (args.format === "streaming-json" && current.revision !== current.run.revision) {
        process.stdout.write(
          JSON.stringify({
            type: CodeReview.terminal(current.run)
              ? "code_review.finished"
              : current.run.status === "admitted"
                ? "code_review.started"
                : "code_review.updated",
            reviewID,
            sessionID: session.id,
            revision: current.run.revision,
            status: current.run.status,
            ...(CodeReview.terminal(current.run) ? { run: current.run } : {}),
          }) + "\n",
        )
        current.revision = current.run.revision
      }
      if (CodeReview.terminal(current.run)) break
      await Bun.sleep(200)
      const result = await sdk.v2.codeReview.get(
        { sessionID: session.id, reviewID },
        { throwOnError: true, signal: AbortSignal.any([requests.signal, AbortSignal.timeout(10000)]) },
      )
      current.run = Schema.decodeUnknownSync(CodeReview.Run)(result.data)
    }
    if (state.signal) return true
    state.complete = CodeReview.terminal(current.run)
    state.cleanupConfirmed = state.complete
    if (args.format === "json") process.stdout.write(JSON.stringify(current.run) + "\n")
    if (args.format === "default") process.stdout.write(formatCodeReview(current.run))
    process.exitCode = codeReviewExitCode(current.run, args["fail-on"])
    if (args["output-last-message"] && current.run.status === "completed")
      await writeLastMessage(path.resolve(root, args["output-last-message"]), JSON.stringify(current.run) + "\n")
    return true
  } catch (error) {
    if (!state.signal) throw error
    return true
  } finally {
    if (state.sessionID && state.attempted && !state.complete) {
      const cancelled = await sdk.v2.codeReview
        .cancel({ sessionID: state.sessionID, reviewID }, { throwOnError: true, signal: AbortSignal.timeout(10000) })
        .then((result) => CodeReview.terminal(Schema.decodeUnknownSync(CodeReview.Run)(result.data)))
        .catch(() => false)
      state.cleanupConfirmed = cancelled
      if (!cancelled) {
        state.cleanupFailed = true
        process.stderr.write(`Review cleanup unconfirmed: Session ${state.sessionID}, review ${reviewID}\n`)
        process.exitCode = 1
      }
    }
    if (args.ephemeral && state.sessionID) {
      const removed = await sdk.v2.session
        .remove({ sessionID: state.sessionID }, { throwOnError: true, signal: AbortSignal.timeout(10000) })
        .then(() => true)
        .catch(() => false)
      if (!removed) {
        process.stderr.write(`Temporary review cleanup failed: ${state.sessionID}\n`)
        state.cleanupConfirmed = false
        state.cleanupFailed = true
        process.exitCode = 1
      }
    }
    if (state.signal)
      process.exitCode =
        !state.cleanupFailed && (state.cleanupConfirmed || !state.attempted)
          ? state.signal === "SIGINT"
            ? 130
            : 143
          : 1
    process.off("SIGINT", interrupt)
    process.off("SIGTERM", terminate)
    await host?.close()
  }
}
