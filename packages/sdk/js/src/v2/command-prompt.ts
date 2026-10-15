import type { ApexoClient } from "./client.js"

export class CommandPromptError extends Error {
  constructor(readonly code: "missing" | "unsupported" | "unavailable") {
    super("The native prompt command is unavailable")
  }
}

// Only prompt-only /loop is supported here. This is a browser-safe protocol
// adapter: the server owns wording, and normal Session admission owns execution.
export async function loopPrompt(
  client: ApexoClient,
  input: { arguments: string; directory?: string; signal?: AbortSignal },
) {
  const result = await client.v2.command.list(
    { location: { directory: input.directory } },
    { signal: input.signal, throwOnError: false },
  )
  if (input.signal?.aborted) throw input.signal.reason
  if (!result.response.ok || !result.data) throw new CommandPromptError("unavailable")
  const command = result.data.data.find((item) => item.name === "loop")
  if (!command) throw new CommandPromptError("missing")
  if (command.subtask || command.agent || command.model) throw new CommandPromptError("unsupported")
  return command.template.replaceAll("$ARGUMENTS", () => input.arguments)
}
