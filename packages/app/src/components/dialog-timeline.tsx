import { createMemo } from "solid-js"
import type { TextPart } from "@apexo/sdk/v2/client"
import { useDialog } from "@apexo/ui/context/dialog"
import { Dialog } from "@apexo/ui/dialog"
import { List } from "@apexo/ui/list"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"

// Desktop counterpart of the CLI `/timeline` jump-to-message dialog.
export function DialogTimeline(props: { sessionID: string; onSelect: (messageID: string) => void }) {
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const messages = createMemo(() =>
    (sync().data.message[props.sessionID] ?? [])
      .flatMap((message) => {
        if (message.role !== "user") return []
        const part = (sync().data.part[message.id] ?? []).find(
          (item): item is TextPart => item.type === "text" && !item.synthetic && !item.ignored,
        )
        if (!part) return []
        return [
          {
            id: message.id,
            text: part.text.replace(/\n/g, " ").slice(0, 200),
            time: new Date(message.time.created).toLocaleTimeString(undefined, { timeStyle: "short" }),
          },
        ]
      })
      .reverse(),
  )
  return (
    <Dialog title={language.t("command.session.timeline")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.timeline.empty")}
        key={(item) => item.id}
        items={messages}
        filterKeys={["text"]}
        onSelect={(item) => {
          if (!item) return
          dialog.close()
          props.onSelect(item.id)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <span class="truncate flex-1 min-w-0 text-left font-normal">{item.text}</span>
            <span class="text-text-weak shrink-0 font-normal">{item.time}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
