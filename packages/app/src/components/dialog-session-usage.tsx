import { For } from "solid-js"
import { Dialog } from "@apexo/ui/dialog"
import { useLanguage } from "@/context/language"
import type { SessionUsageSummary } from "@/utils/session-export"

// Desktop counterpart of `apexo usage <sessionID>`: all-turn, per-model totals for one Session.
export function DialogSessionUsage(props: { usage: SessionUsageSummary }) {
  const language = useLanguage()
  const number = (value: number) => value.toLocaleString()
  const cost = (value: number) => `$${value.toFixed(4)}`
  return (
    <Dialog title={language.t("command.session.usage")}>
      <div class="px-4 pb-4 flex flex-col gap-3 text-14-regular" data-component="session-usage">
        <div>
          {language.t("session.usage.totals", {
            turns: String(props.usage.turns),
            calls: String(props.usage.calls),
            input: number(props.usage.inputTokens),
            output: number(props.usage.outputTokens),
            cost: cost(props.usage.costUsd),
          })}
        </div>
        <table class="w-full text-left">
          <thead class="text-text-weak">
            <tr>
              <th>{language.t("session.usage.model")}</th>
              <th>{language.t("session.usage.calls")}</th>
              <th>{language.t("session.usage.input")}</th>
              <th>{language.t("session.usage.output")}</th>
              <th>{language.t("session.usage.cost")}</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.usage.models}>
              {(model) => (
                <tr>
                  <td>{`${model.providerID}/${model.modelID}`}</td>
                  <td>{model.calls}</td>
                  <td>{number(model.inputTokens)}</td>
                  <td>{number(model.outputTokens)}</td>
                  <td>{cost(model.costUsd)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Dialog>
  )
}
