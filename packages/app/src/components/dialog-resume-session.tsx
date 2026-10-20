import type { Session } from "@apexo/sdk/v2/client"
import { sessionMatches } from "@apexo/sdk/v2/grok-commands"
import { useDialog } from "@apexo/ui/context/dialog"
import { Dialog } from "@apexo/ui/dialog"
import { List } from "@apexo/ui/list"
import { useLanguage } from "@/context/language"

/**
 * Grok Build `/resume` picker. A session matches when its title contains every typed word in any order, or when the
 * text is a prefix of its ID; `query` pre-fills the search with the text typed after `/resume`.
 */
export function DialogResumeSession(props: { sessions: Session[]; query?: string; onSelect: (session: Session) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  return (
    <Dialog title={language.t("grok.resume")}>
      <List
        class="flex-1 px-3 pb-2 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("grok.empty")}
        ref={(list) => {
          if (props.query) queueMicrotask(() => list.setFilter(props.query!))
        }}
        key={(session) => session.id}
        items={(filter: string): Session[] => props.sessions.filter((session) => sessionMatches(filter, session))}
        // `sessionMatches` already filtered; the list's fuzzy pass would reorder and drop word-order matches.
        skipFilter={() => true}
        onSelect={(session) => {
          if (!session) return
          dialog.close()
          props.onSelect(session)
        }}
      >
        {(session) => (
          <div class="w-full flex items-center justify-between gap-3 py-0.5" data-resume-session={session.id}>
            <span class="truncate flex-1 min-w-0 text-left font-normal text-text-strong">{session.title || session.id}</span>
            <span class="text-text-weak shrink-0 text-11-regular font-mono">{session.id.slice(0, 14)}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
