import type { ApexoClient } from "@apexo/sdk/v2"
import { nativeSessionTransport, restorationNotice } from "@apexo/tui/transport/native-session"
import type { RunInput } from "./cmd/run/types"

export async function runNativeInteractive(input: {
  sdk: ApexoClient
  signal?: AbortSignal
  directory?: string
  session?: string
  continue?: boolean
  agent?: string
  model?: RunInput["model"]
  variant?: string
  files: RunInput["files"]
  initialInput?: string
  thinking: boolean
  backgroundSubagents: boolean
  replay?: boolean
  replayLimit?: number
}) {
  const owner = new AbortController()
  const abort = () => owner.abort()
  input.signal?.addEventListener("abort", abort, { once: true })
  if (input.signal?.aborted) abort()
  try {
    const scoped = nativeSessionTransport(input.sdk, input.directory, owner.signal)
    const existing = input.session
      ? await scoped.get(input.session)
      : input.continue
        ? (await scoped.list()).data.find((item) => !item.parentID)
        : undefined
    const catalog = await scoped.catalog()
    const agent =
      input.agent ?? existing?.agent ?? catalog.agents.find((item) => item.mode !== "subagent" && !item.hidden)?.id
    const configured = catalog.agents.find((item) => item.id === agent)?.model
    const fallback = catalog.models.find(
      (item) =>
        item.enabled && catalog.providers.some((provider) => provider.id === item.providerID && !provider.disabled),
    )
    const stored = existing?.model ?? configured ?? fallback
    const selected = input.model ?? (stored ? { providerID: stored.providerID, modelID: stored.id } : undefined)
    const next =
      existing ??
      (await scoped.create({
        agent,
        model: selected
          ? {
              providerID: selected.providerID,
              id: selected.modelID,
              variant: input.variant ?? configured?.variant ?? undefined,
            }
          : undefined,
      }))
    const { runInteractiveMode } = await import("./cmd/run/runtime")
    const located = nativeSessionTransport(input.sdk, next.location.directory, owner.signal)
    const startupNotice = existing
      ? await located
          .restore(next.id)
          .then(restorationNotice)
          .catch(() => "Schedules could not be restored. Open Tasks to inspect them or retry restoration.")
      : undefined
    return await runInteractiveMode({
      sdk: input.sdk,
      signal: input.signal,
      native: located,
      directory: next.location.directory,
      sessionID: next.id,
      sessionTitle: next.title,
      startupNotice,
      resume: Boolean(existing),
      replay: input.replay,
      replayLimit: input.replayLimit,
      agent: agent ?? next.agent ?? undefined,
      model: selected ?? (next.model ? { providerID: next.model.providerID, modelID: next.model.id } : undefined),
      variant: input.variant ?? next.model?.variant ?? undefined,
      files: input.files,
      initialInput: input.initialInput,
      thinking: input.thinking,
      backgroundSubagents: input.backgroundSubagents,
      createSession: async (_sdk, selection) =>
        located.create({
          location: next.location,
          agent: selection.agent,
          model: selection.model
            ? { providerID: selection.model.providerID, id: selection.model.modelID, variant: selection.variant }
            : undefined,
        }),
    })
  } finally {
    input.signal?.removeEventListener("abort", abort)
    owner.abort()
  }
}
