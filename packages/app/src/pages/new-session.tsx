import { createPromptProjectController } from "@/components/prompt-project-selector"
import { useTitlebarRightMount } from "@/components/titlebar"
import { useSettings } from "@/context/settings"
import { Show, createEffect, createMemo, createResource } from "solid-js"
import { createNewSessionDraftController } from "./new-session/new-session-draft-controller"
import { NewSessionStatus, NewSessionView } from "./new-session/new-session-view"
import { createNewSessionWorkspaceController } from "./new-session/new-session-workspace-controller"
import { useNewSessionCommands } from "./new-session/use-new-session-commands"
import { useSessionLayout } from "./session/session-layout"
import { TerminalPanelV2 } from "./session/terminal-panel-v2"

/** The draft-only V2 session page. Submitting promotes the draft into a real session. */
export default function NewSessionPage() {
  const settings = useSettings()
  const { view } = useSessionLayout()
  const rightMount = useTitlebarRightMount()
  const workspace = createNewSessionWorkspaceController()
  const draft = createNewSessionDraftController({
    worktree: workspace.selection.value,
    resetWorktree: workspace.selection.reset,
  })
  const project = createPromptProjectController({
    controls: draft.project.controls,
    onDone: draft.input.restoreFocus,
  })
  const terminalOpen = createMemo(() => view().terminal.opened())
  useNewSessionCommands({
    restoreFocus: draft.input.restoreFocus,
    project: {
      empty: project.empty,
      open: () => project.setOpen(true),
    },
  })
  createEffect(() => {
    if (!draft.prompt.ready()) return
    draft.input.restoreFocus()
  })
  const ready = Promise.resolve()
  const [suspendUntilPromptReady] = createResource(
    () => draft.prompt.readyPromise() ?? ready,
    (promise) => promise.then(() => true),
  )

  return (
    <div class="relative size-full overflow-hidden flex flex-col">
      {suspendUntilPromptReady()}
      <NewSessionStatus mount={rightMount} visible={settings.visibility.status} />
      <div class="flex-1 min-h-0 flex flex-col md:flex-row gap-2 p-2">
        <NewSessionView input={draft.input} project={project} workspace={workspace} />
        <Show when={terminalOpen()}>
          <div class="min-w-0 h-full flex flex-1 flex-col">
            <TerminalPanelV2 />
          </div>
        </Show>
      </div>
    </div>
  )
}
