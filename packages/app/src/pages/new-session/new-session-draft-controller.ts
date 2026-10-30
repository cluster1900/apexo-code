import { useNavigate, useSearchParams } from "@solidjs/router"
import { base64Encode } from "@apexo/core/util/encode"
import { createEffect, untrack } from "solid-js"
import { usePromptInputV2Controller } from "@/components/prompt-input-v2"
import { useCommand } from "@/context/command"
import { useComments } from "@/context/comments"
import { useLocal } from "@/context/local"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { createPromptInputController, createPromptProjectControls } from "@/pages/session/composer"
import { createPromptModelSelection } from "@/pages/session/composer/prompt-model-selection"
import { useSessionKey } from "@/pages/session/session-layout"
import { useComposerCommands } from "@/pages/session/use-composer-commands"

export function createNewSessionDraftController(workspace: { worktree: () => string; resetWorktree: () => void }) {
  const prompt = usePrompt()
  const serverSync = useServerSync()
  const comments = useComments()
  const local = useLocal()
  const sdk = useSDK()
  const command = useCommand()
  const navigate = useNavigate()
  const route = useSessionKey()
  const [searchParams, setSearchParams] = useSearchParams<{ draftId?: string; prompt?: string }>()
  const model = createPromptModelSelection({ agent: () => local.agent.current() })

  useComposerCommands({ model })

  const controls = createPromptInputController({
    sessionKey: route.sessionKey,
    sessionID: () => route.params.id,
    queryOptions: serverSync().queryOptions,
    model,
  })
  const projectControls = createPromptProjectControls()
  const runBrowserTask = async (task: string) => {
    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    if (!currentModel || !currentAgent) throw new Error("Select a model and agent before using /browser")
    const location = { directory: sdk().directory }
    const parent = (
      await sdk().client.v2.session.create(
        {
          agent: currentAgent.name,
          model: {
            id: currentModel.id,
            providerID: currentModel.provider.id,
            variant: local.model.variant.current(),
          },
          location,
        },
        { throwOnError: true },
      )
    ).data.data
    const child = (
      await sdk().client.v2.session.create(
        { parentID: parent.id, agent: "browser", location },
        { throwOnError: true },
      )
    ).data.data
    navigate(`/${base64Encode(sdk().directory)}/session/${child.id}`)
    await sdk().client.v2.session.prompt(
      { sessionID: child.id, prompt: { text: task.trim() }, delivery: "steer" },
      { throwOnError: true },
    )
  }
  command.register("new-session-browser", () => [
    {
      id: "session.browser",
      title: "Control browser through Chrome CDP",
      description: "Run a browser task in a dedicated CDP subagent",
      slash: "browser",
      onSlash: (args) => {
        if (args.trim() === "") return
        void runBrowserTask(args).catch((error: unknown) =>
          showToast({ title: "Browser", description: error instanceof Error ? error.message : String(error), variant: "error" }),
        )
      },
      onSelect: () => showToast({ title: "Browser", description: "Usage: /browser <task>" }),
    },
  ])
  const input = usePromptInputV2Controller({
    get controls() {
      return controls()
    },
    get newSessionWorktree() {
      return workspace.worktree()
    },
    onNewSessionWorktreeReset: workspace.resetWorktree,
    onSubmit: comments.clear,
  })

  createEffect(() => {
    if (!prompt.ready()) return
    untrack(() => {
      const text = searchParams.prompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      setSearchParams({ ...searchParams, prompt: undefined })
    })
  })

  return {
    input,
    prompt: {
      ready: prompt.ready,
      readyPromise: () => prompt.ready.promise,
    },
    project: {
      controls: projectControls,
    },
  }
}

export type NewSessionDraftController = ReturnType<typeof createNewSessionDraftController>
