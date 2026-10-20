import { createMemo, createSignal, For, Show } from "solid-js"
import type { PermissionRequest } from "@apexo/sdk/v2"
import { Button } from "@apexo/ui/button"
import { DockPrompt } from "@apexo/session-ui/dock-prompt"
import { Icon } from "@apexo/ui/icon"
import { useLanguage } from "@/context/language"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject", save?: readonly string[]) => void
}) {
  const language = useLanguage()
  // Grok Build "Always allow" scope picker (same choices as the CLI: ← narrower, wider →).
  const choices = createMemo(() => {
    const value = props.request.metadata?.alwaysChoices
    if (!Array.isArray(value)) return []
    return value.filter(
      (item): item is { label: string; save: string[] } => typeof item?.label === "string" && Array.isArray(item?.save),
    )
  })
  const [picked, setPicked] = createSignal<number>()
  const scope = createMemo(() => {
    const list = choices()
    if (!list.length) return undefined
    const fallback = Number(props.request.metadata?.alwaysDefault ?? 0)
    return Math.min(list.length - 1, Math.max(0, picked() ?? fallback))
  })
  const alwaysPatterns = createMemo(() => {
    const index = scope()
    return index === undefined ? props.request.always : choices()[index]!.save
  })
  const move = (delta: number) => {
    const index = scope()
    if (index === undefined) return
    setPicked(Math.min(choices().length - 1, Math.max(0, index + delta)))
  }
  const always = () => props.onDecide("always", scope() === undefined ? undefined : alwaysPatterns())

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  const formatPattern = (pattern: string) => {
    const filepath = props.request.metadata?.filepath
    if (typeof filepath === "string" && filepath.startsWith("/") && pattern === filepath.replace(/^\/+/, "")) {
      return filepath
    }
    return pattern
  }

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
              {language.t("ui.permission.deny")}
            </Button>
            <Button variant="secondary" size="normal" onClick={always} disabled={props.responding}>
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={props.request.patterns.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.patterns}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{formatPattern(pattern)}</code>}
            </For>
          </div>
        </div>
      </Show>
      <Show when={alwaysPatterns().length > 0 && !(alwaysPatterns().length === 1 && alwaysPatterns()[0] === "*")}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div
            data-slot="permission-always"
            data-component="permission-always"
            tabIndex={choices().length > 1 ? 0 : undefined}
            onKeyDown={(event) => {
              if (choices().length < 2) return
              if (event.key === "ArrowLeft") move(-1)
              else if (event.key === "ArrowRight") move(1)
              else return
              event.preventDefault()
            }}
          >
            <div data-slot="permission-hint">{language.t("ui.permission.alwaysScope")}</div>
            <Show when={choices().length > 1}>
              <div data-slot="permission-scope" class="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="small"
                  data-action="scope-narrower"
                  disabled={props.responding || scope() === 0}
                  onClick={() => move(-1)}
                >
                  {language.t("ui.permission.scopeNarrower")}
                </Button>
                <span data-slot="permission-scope-position" class="text-12-regular text-text-weak">
                  {`${(scope() ?? 0) + 1}/${choices().length}`}
                </span>
                <Button
                  variant="ghost"
                  size="small"
                  data-action="scope-wider"
                  disabled={props.responding || scope() === choices().length - 1}
                  onClick={() => move(1)}
                >
                  {language.t("ui.permission.scopeWider")}
                </Button>
              </div>
            </Show>
            <For each={alwaysPatterns()}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{formatPattern(pattern)}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
