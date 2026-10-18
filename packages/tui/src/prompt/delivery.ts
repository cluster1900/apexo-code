import type { ApexoClient } from "@apexo/sdk/v2"
import type { EditorSelection } from "../context/editor"
import type { PromptInfo } from "./history"

export type PromptDraft = {
  sessionID: string
  agentName: string
  model: { providerID: string; modelID: string }
  variant?: string
  contextWindow?: number
  mode: "normal" | "shell"
  inputText: string
  nonTextParts: PromptInfo["parts"]
  editorSelection?: EditorSelection
  editorParts: Array<{
    type: "text"
    text: string
    synthetic: true
    metadata: {
      kind: "editor_context"
      source: string
      filePath: string
      ranges: EditorSelection["ranges"]
    }
  }>
  historyPrompt: PromptInfo
}

export function deliverPrompt(
  session: ApexoClient["session"],
  commands: readonly { name: string }[],
  draft: PromptDraft,
) {
  if (draft.mode === "shell") {
    return session.shell(
      { sessionID: draft.sessionID, agent: draft.agentName, model: draft.model, command: draft.inputText },
      { throwOnError: true },
    )
  }
  if (
    draft.inputText.startsWith("/") &&
    commands.some((item) => item.name === draft.inputText.split("\n")[0]!.split(" ")[0]?.slice(1))
  ) {
    const firstLineEnd = draft.inputText.indexOf("\n")
    const firstLine = firstLineEnd === -1 ? draft.inputText : draft.inputText.slice(0, firstLineEnd)
    const [command, ...firstLineArgs] = firstLine.split(" ")
    const rest = firstLineEnd === -1 ? "" : draft.inputText.slice(firstLineEnd + 1)
    return session.command(
      {
        sessionID: draft.sessionID,
        command: command.slice(1),
        arguments: firstLineArgs.join(" ") + (rest ? "\n" + rest : ""),
        agent: draft.agentName,
        model: `${draft.model.providerID}/${draft.model.modelID}`,
        variant: draft.variant,
        parts: draft.nonTextParts.filter((part) => part.type === "file"),
      },
      { throwOnError: true },
    )
  }
  return session.prompt(
    {
      sessionID: draft.sessionID,
      agent: draft.agentName,
      model: draft.model,
      variant: draft.variant,
      ...(draft.contextWindow ? { contextWindow: draft.contextWindow } : {}),
      parts: [...draft.editorParts, { type: "text", text: draft.inputText }, ...draft.nonTextParts],
    },
    { throwOnError: true },
  )
}

export function shouldQueuePrompt(input: {
  delivery: "steer" | "queue"
  busy: boolean
  pending: boolean
  mode: "normal" | "shell"
}) {
  if (input.delivery !== "queue" || input.mode !== "normal") return false
  return input.busy || input.pending
}
