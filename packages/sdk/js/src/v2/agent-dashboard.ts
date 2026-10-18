/**
 * Shared behavior of the Grok Build agent dashboard (`/dashboard`, aliases `/agents-dashboard`, `/sessions`): the roster
 * of top-level sessions grouped by state, the peek panel with a live reply box, and the dashboard key handling.
 * The TUI and Desktop render their own widgets but drive this module, so both surfaces classify rows, describe the
 * peeked agent and react to keys identically. Mirrors grok-build `docs/user-guide/23-dashboard.md` and
 * `xai-grok-pager/src/views/dashboard/{row,row_activity,peek,state}.rs`.
 */

// Structural subsets of the SDK types so both clients (and tests) can pass their stores as-is.
export type DashboardSession = {
  id: string
  title: string
  directory: string
  parentID?: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  time: { created: number; updated: number; archived?: number }
}
export type DashboardStatus = { type: "idle" } | { type: "busy" } | { type: "retry"; attempt: number }
export type DashboardPermission = {
  id: string
  sessionID: string
  permission: string
  patterns: readonly string[]
  metadata?: Record<string, unknown>
}
export type DashboardQuestion = {
  id: string
  sessionID: string
  questions: readonly {
    question: string
    header?: string
    options: readonly { label: string }[]
    multiple?: boolean
    custom?: boolean
  }[]
}
export type DashboardMessage =
  | {
      id: string
      role: "user"
      time: { created: number }
      agent?: string
      model?: { providerID: string; modelID: string; variant?: string }
    }
  | {
      id: string
      role: "assistant"
      time: { created: number; completed?: number }
      modelID?: string
      providerID?: string
      agent?: string
    }
export type DashboardPart =
  | { type: "text"; text: string; synthetic?: boolean; ignored?: boolean; time?: { start: number; end?: number } }
  | { type: "reasoning"; text: string; time?: { start: number; end?: number } }
  | {
      type: "tool"
      tool: string
      state: { status: "pending" | "running" | "completed" | "error"; title?: string; input?: Record<string, unknown> }
    }
  | { type: string }

export type DashboardData = {
  sessions: readonly DashboardSession[]
  status: Readonly<Record<string, DashboardStatus | undefined>>
  permission: Readonly<Record<string, readonly DashboardPermission[] | undefined>>
  question: Readonly<Record<string, readonly DashboardQuestion[] | undefined>>
  message: Readonly<Record<string, readonly DashboardMessage[] | undefined>>
  part: Readonly<Record<string, readonly DashboardPart[] | undefined>>
  pinned?: readonly string[]
}

/** Local agents only classify as these three (grok `classify_top_level`); Completed/Failed/Inactive are roster-only. */
export type RowState = "needs-input" | "working" | "idle"

export type DashboardRow = {
  id: string
  title: string
  directory: string
  state: RowState
  /** Live activity, e.g. `Awaiting your input`, `Running: git status`, `Thinking`. Undefined when idle. */
  activity?: string
  /** Secondary line: `Pending: …` while awaiting input, the activity while working, else the last response line. */
  subtitle?: string
  updated: number
  pinned: boolean
}

export const stateLabel: Record<RowState, string> = {
  "needs-input": "Awaiting",
  working: "Working",
  idle: "Idle",
}

/** Working rows animate through these frames; the others use a fixed dot (grok `animation.rs` / doc "State icons"). */
export const workingFrames = ["⋅", ":", "⸬", "⁙"] as const
export function rowGlyph(state: RowState, frame = 0) {
  if (state === "working") return workingFrames[frame % workingFrames.length]!
  if (state === "needs-input") return "●"
  return "○"
}

const priority: Record<RowState, number> = { "needs-input": 6, working: 5, idle: 3 }
const maxActivitySubject = 40
/** Dispatch prompts above 64 KiB are rejected with a toast (doc "Dispatch input"). */
export const maxDispatchBytes = 64 * 1024
/** Second Ctrl+X within this window permanently deletes a settled row. */
export const deleteConfirmMs = 2000

export const dashboardHints = {
  list: "↑/↓ select (peek) · Enter open · Ctrl+S send+open · Ctrl+T pin · Ctrl+X stop · Ctrl+/ search · Tab focus · Esc back",
  dispatch: "Enter dispatch · Ctrl+S dispatch+open · Shift+Enter newline · Esc back",
  search: "Enter keep filter · Esc/Ctrl+/ cancel · ↑/↓ navigate",
}

export function dashboardRows(data: DashboardData, filter = ""): DashboardRow[] {
  const pinned = data.pinned ?? []
  const parsed = parseDashboardFilter(filter)
  return data.sessions
    .filter((session) => !session.parentID && !session.time.archived)
    .map((session) => buildRow(data, session, pinned.includes(session.id)))
    .filter((row) => matchesFilter(row, parsed, data))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (a.pinned) return pinned.indexOf(a.id) - pinned.indexOf(b.id)
      if (a.state !== b.state) return priority[b.state] - priority[a.state]
      if (a.updated !== b.updated) return b.updated - a.updated
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

export function classifyRow(data: DashboardData, sessionID: string): RowState {
  if (data.permission[sessionID]?.length || data.question[sessionID]?.length) return "needs-input"
  const status = data.status[sessionID]?.type ?? "idle"
  if (status !== "idle") return "working"
  return "idle"
}

/** Header chips, same glyph as the rows plus a label; zero counts are omitted (grok `chrome.rs`). */
export function dashboardChips(rows: readonly DashboardRow[]) {
  const count = (state: RowState) => rows.filter((row) => row.state === state).length
  return [
    {
      state: "needs-input" as const,
      glyph: "◆",
      label: `${count("needs-input")} awaiting`,
      count: count("needs-input"),
    },
    { state: "working" as const, glyph: "⋮", label: `${count("working")} working`, count: count("working") },
    { state: "idle" as const, glyph: "◇", label: `${count("idle")} idle`, count: count("idle") },
  ].filter((chip) => chip.count > 0)
}

/** Grok `format_time_ago`: `just now`, `Nm`, `Nh`, `Nd`, `Nmo`, `Ny`. */
export function formatTimeAgo(ms: number) {
  const secs = Math.max(0, Math.floor(ms / 1000))
  if (secs < 60) return "just now"
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  const days = Math.floor(secs / 86400)
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

function buildRow(data: DashboardData, session: DashboardSession, pinned: boolean): DashboardRow {
  const state = classifyRow(data, session.id)
  const activity = rowActivity(data, session.id, state)
  return {
    id: session.id,
    title: session.title,
    directory: session.directory,
    state,
    activity,
    subtitle: rowSubtitle(data, session.id, state, activity),
    updated: session.time.updated,
    pinned,
  }
}

function rowActivity(data: DashboardData, sessionID: string, state: RowState) {
  if (state === "needs-input") return "Awaiting your input"
  if (state !== "working") return
  const status = data.status[sessionID]
  if (status?.type === "retry") return `Retrying (attempt ${status.attempt})`
  const part = lastAssistantParts(data, sessionID).at(-1)
  if (part && isTool(part) && (part.state.status === "running" || part.state.status === "pending")) {
    const subject = (part.state.title ?? toolSubject(part) ?? "").split("\n")[0]!.trim()
    if (!subject) return "Running tool"
    return `Running: ${[...subject].length > maxActivitySubject ? [...subject].slice(0, maxActivitySubject).join("") + "…" : subject}`
  }
  if (part?.type === "reasoning") return "Thinking"
  if (part?.type === "text") return "Responding"
  return "Working"
}

function rowSubtitle(data: DashboardData, sessionID: string, state: RowState, activity: string | undefined) {
  if (state === "needs-input") {
    const permission = data.permission[sessionID]?.[0]
    if (permission) return `Pending: ${permissionTitle(permission)}`
    return "Pending: question"
  }
  if (state === "working") return activity
  return firstLine(lastResponseText(data, sessionID))
}

export function permissionTitle(permission: DashboardPermission) {
  const command = permission.metadata?.command
  const subject =
    typeof command === "string" && command.trim() ? command.trim() : permission.patterns.filter(Boolean).join(", ")
  return `${titlecase(permission.permission)}${subject ? ` ${subject}` : ""}`
}

// ---------------------------------------------------------------------------------------------------------------
// Peek panel

export type PeekOption = { label: string; value: string }
export type PeekQuestion = {
  kind: "permission" | "question"
  requestID: string
  text: string
  options: PeekOption[]
  /** Index of the option that takes free text from the reply row: permission `Reject`, ask-tool `Other`. */
  free?: number
  /** Multi-select asks cannot be answered from the peek (doc: "multi-select forms need the agent's own view"). */
  multiple?: boolean
  index: number
  total: number
}
export type Peek = {
  id: string
  title: string
  /** `Thinking` / `Thought` / `Response` / `Edit` / `Read` / `Bash` / … or `Working` / `Idle` (grok `extract_last_response_type`). */
  responseType: string
  time: string
  /** The most recent response text; the surfaces wrap it to about 3 rows with `…` when truncated. */
  body: string
  model?: string
  agent?: string
  question?: PeekQuestion
}

export const permissionOptions: PeekOption[] = [
  { label: "Allow once", value: "once" },
  { label: "Allow always", value: "always" },
  { label: "Reject", value: "reject" },
]
export const otherOption = "__other__"

/** `answered` is how many questions of a multi-question ask the peek already walked through. */
export function dashboardPeek(data: DashboardData, sessionID: string, now: number, answered = 0): Peek | undefined {
  const session = data.sessions.find((item) => item.id === sessionID)
  if (!session) return
  const lastUser = findLast(data.message[sessionID] ?? [], (message) => message.role === "user")
  const lastAssistant = findLast(data.message[sessionID] ?? [], (message) => message.role === "assistant")
  const model =
    (lastAssistant?.role === "assistant" ? lastAssistant.modelID : undefined) ??
    (lastUser?.role === "user" ? lastUser.model?.modelID : undefined) ??
    session.model?.id
  return {
    id: session.id,
    title: session.title,
    responseType: lastResponseType(data, sessionID),
    time: formatTimeAgo(now - session.time.updated),
    body: lastResponseText(data, sessionID),
    model,
    agent: lastUser?.agent ?? session.agent,
    question: peekQuestion(data, sessionID, answered),
  }
}

function peekQuestion(data: DashboardData, sessionID: string, answered: number): PeekQuestion | undefined {
  const permission = data.permission[sessionID]?.[0]
  if (permission)
    return {
      kind: "permission",
      requestID: permission.id,
      text: permissionTitle(permission),
      options: permissionOptions,
      free: 2,
      index: 0,
      total: 1,
    }
  const ask = data.question[sessionID]?.[0]
  const current = ask?.questions[Math.min(answered, ask.questions.length - 1)]
  if (!ask || !current) return
  const options = current.options.map((option) => ({ label: option.label, value: option.label }))
  const free = current.custom === false ? undefined : options.push({ label: "Other", value: otherOption }) - 1
  const total = ask.questions.length
  return {
    kind: "question",
    requestID: ask.id,
    text: total > 1 ? `(${answered + 1}/${total}) ${current.question}` : current.question,
    options: current.multiple ? [] : options,
    free: current.multiple ? undefined : free,
    multiple: current.multiple === true,
    index: answered,
    total,
  }
}

/** Grok `extract_last_response_type`, mapped onto Apexo parts and tool ids. */
export function lastResponseType(data: DashboardData, sessionID: string) {
  const status = data.status[sessionID]
  const running = (status?.type ?? "idle") !== "idle"
  if (status?.type === "retry") return "Retrying"
  const parts = turnParts(data, sessionID)
  const live = parts.at(-1)
  if (running && live && "time" in live && !live.time?.end) {
    if (live.type === "reasoning") return "Thinking"
    if (live.type === "text") return "Response"
  }
  const scanned = [...parts].reverse().flatMap((part) => {
    if (part.type === "text" && isVisibleText(part)) return [running ? "" : "Response"]
    if (part.type === "reasoning") return [running ? "Thinking" : "Thought"]
    if (isTool(part)) return [toolLabel(part.tool)]
    return []
  })[0]
  if (scanned) return scanned
  return running ? "Working" : "Idle"
}

export function toolLabel(tool: string) {
  if (["bash", "shell", "run_terminal_cmd"].includes(tool)) return "Bash"
  if (tool === "read") return "Read"
  if (["edit", "write", "apply_patch", "multiedit"].includes(tool)) return "Edit"
  if (["list", "ls"].includes(tool)) return "List"
  if (["glob", "grep", "codesearch"].includes(tool)) return "Search"
  if (tool === "webfetch") return "Fetch"
  if (tool === "websearch") return "Web search"
  if (tool === "search_tool") return "Tool search"
  if (tool.startsWith("memory")) return "Memory"
  if (tool === "skill") return "Skill"
  if (tool === "task") return "Subagent"
  return "Tool"
}

/** Text of the most recent agent response (text, then reasoning, then a tool title), current turn first. */
export function lastResponseText(data: DashboardData, sessionID: string) {
  const parts = (data.message[sessionID] ?? [])
    .filter((message) => message.role === "assistant")
    .flatMap((message) => data.part[message.id] ?? [])
  const text = findLast(parts, (part) => part.type === "text" && isVisibleText(part))
  const reasoning = findLast(parts, (part) => part.type === "reasoning" && "text" in part && !!part.text.trim())
  const tool = [...parts].reverse().find(isTool)
  const turn = turnParts(data, sessionID)
  // While the current turn has produced nothing but tools, show what is running instead of the previous answer.
  if (turn.length && !turn.some((part) => part.type === "text" && isVisibleText(part)) && tool && isTool(turn.at(-1)!))
    return (tool.state.title ?? toolSubject(tool) ?? toolLabel(tool.tool)).trim()
  if (text && "text" in text) return text.text.trim()
  if (reasoning && "text" in reasoning) return reasoning.text.trim()
  return ""
}

/** Word-wraps `text` to `width` columns and keeps at most `rows` rows, ending with `…` when truncated. */
export function clampText(text: string, width: number, rows = 3) {
  const lines = text
    .split("\n")
    .flatMap((line) => wrap(line.trimEnd(), Math.max(1, width)))
    .filter((line) => line.trim())
  if (lines.length <= rows) return lines
  const kept = lines.slice(0, rows)
  const last = kept[rows - 1]!
  kept[rows - 1] = ([...last].length >= width ? [...last].slice(0, Math.max(0, width - 1)).join("") : last) + "…"
  return kept
}

function wrap(line: string, width: number) {
  if (!line) return [""]
  return line.split(/(\s+)/u).reduce<string[]>(
    (out, word) => {
      const current = out.at(-1)!
      if ([...current].length + [...word].length <= width) {
        out[out.length - 1] = current + word
        return out
      }
      if (!word.trim()) {
        out.push("")
        return out
      }
      const chars = [...word]
      const chunks = Array.from({ length: Math.ceil(chars.length / width) }, (_, i) =>
        chars.slice(i * width, (i + 1) * width).join(""),
      )
      if (current) out.push(...chunks)
      if (!current) out.splice(out.length - 1, 1, ...chunks)
      return out
    },
    [""],
  )
}

function turnParts(data: DashboardData, sessionID: string) {
  const messages = data.message[sessionID] ?? []
  const fromEnd = [...messages].reverse().findIndex((message) => message.role === "user")
  return messages
    .slice(fromEnd === -1 ? 0 : messages.length - fromEnd)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => data.part[message.id] ?? [])
}

function lastAssistantParts(data: DashboardData, sessionID: string) {
  const message = findLast(data.message[sessionID] ?? [], (item) => item.role === "assistant")
  return message ? (data.part[message.id] ?? []) : []
}

function isTool(part: DashboardPart): part is Extract<DashboardPart, { type: "tool"; tool: string }> {
  return part.type === "tool" && "tool" in part
}

function isVisibleText(part: DashboardPart) {
  return part.type === "text" && "text" in part && !("synthetic" in part && part.synthetic) && !!part.text.trim()
}

function toolSubject(part: Extract<DashboardPart, { type: "tool"; tool: string }>) {
  const input = part.state.input ?? {}
  const value = input.command ?? input.description ?? input.filePath ?? input.pattern ?? input.url ?? input.query
  return typeof value === "string" ? value : undefined
}

// The SDK targets ES2022, which has no Array#findLast.
function findLast<T>(list: readonly T[], match: (item: T) => boolean) {
  return [...list].reverse().find(match)
}

function firstLine(text: string) {
  return (
    text
      .split("\n")
      .find((line) => line.trim())
      ?.trim() || undefined
  )
}

function titlecase(value: string) {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value
}

// ---------------------------------------------------------------------------------------------------------------
// Search filter (Ctrl+/)

export type DashboardFilter =
  | { type: "none" }
  | { type: "agent"; value: string }
  | { type: "state"; value: RowState | "none" }
  | { type: "tag"; value: string }
  | { type: "text"; value: string }

const stateTokens: Record<string, RowState | "none"> = {
  working: "working",
  busy: "working",
  running: "working",
  active: "working",
  idle: "idle",
  "needs-input": "needs-input",
  needs_input: "needs-input",
  needsinput: "needs-input",
  input: "needs-input",
  awaiting: "needs-input",
  waiting: "needs-input",
  pending: "needs-input",
  // Grok states a local Apexo session never reaches; accepted so the filter matches nothing instead of everything.
  completed: "none",
  done: "none",
  finished: "none",
  failed: "none",
  error: "none",
  cancelled: "none",
  blocked: "none",
  inactive: "none",
}

/** `a:<name>` agent, `s:<state>` state, `#<text>` literal tag, anything else substring over label + directory. */
export function parseDashboardFilter(query: string): DashboardFilter {
  const text = query.trim()
  if (!text) return { type: "none" }
  if (/^a:/iu.test(text)) return { type: "agent", value: text.slice(2).trim().toLowerCase() }
  if (/^s:/iu.test(text)) return { type: "state", value: stateTokens[text.slice(2).trim().toLowerCase()] ?? "none" }
  if (text.startsWith("#")) return { type: "tag", value: text.toLowerCase() }
  return { type: "text", value: text.toLowerCase() }
}

function matchesFilter(row: DashboardRow, filter: DashboardFilter, data: DashboardData) {
  if (filter.type === "none") return true
  if (filter.type === "state") return row.state === filter.value
  if (filter.type === "tag") return row.title.toLowerCase().includes(filter.value)
  if (filter.type === "agent") {
    const session = data.sessions.find((item) => item.id === row.id)
    const user = findLast(data.message[row.id] ?? [], (message) => message.role === "user")
    return [session?.agent, user?.role === "user" ? user.agent : undefined, row.title].some((label) =>
      label?.toLowerCase().includes(filter.value),
    )
  }
  return `${row.title}\n${row.directory}`.toLowerCase().includes(filter.value)
}

// ---------------------------------------------------------------------------------------------------------------
// Keys

export type DashboardUI = {
  /** Selected row (peeked agent); undefined means the `+ New Agent` cursor and the dispatch box. */
  selected?: string
  focus: "input" | "list"
  /** Dispatch draft: always spawns a new session. Never cleared by Esc. */
  draft: string
  /** Peek reply draft for the selected agent; cleared when the selection changes. */
  reply: string
  search: boolean
  query: string
  /** Highlighted option while the peek shows a pending permission / question. */
  option: number
  /** Answers already given while walking a multi-question ask. */
  answers: string[][]
  armed?: { id: string; at: number }
}

export type DashboardKey =
  | { name: "up" | "down" | "enter" | "escape" | "tab" | "ctrl+s" | "ctrl+/" | "ctrl+x" | "ctrl+t" | "ctrl+\\" }
  | { name: "char"; char: string }

export type DashboardEffect =
  | { type: "exit" }
  | { type: "open"; id: string }
  | { type: "new" }
  | { type: "dispatch"; text: string; attach: boolean }
  | { type: "slash"; text: string }
  | { type: "reply"; id: string; text: string; open: boolean }
  | { type: "permission"; id: string; requestID: string; reply: "once" | "always" | "reject"; message?: string }
  | { type: "question"; id: string; requestID: string; answers: string[][] }
  | { type: "stop"; id: string }
  | { type: "delete"; id: string }
  | { type: "pin"; id: string }
  | { type: "toast"; message: string }

export type DashboardContext = { rows: readonly DashboardRow[]; peek?: Peek; now: number }
export type DashboardResult = { ui: DashboardUI; effect?: DashboardEffect; handled: boolean }

/** On open, focus is the list when agents exist, else the dispatch box; the cursor starts on `+ New Agent`. */
export function initialDashboardUI(rows: readonly DashboardRow[]): DashboardUI {
  return {
    focus: rows.length ? "list" : "input",
    draft: "",
    reply: "",
    search: false,
    query: "",
    option: 0,
    answers: [],
  }
}

/** The text the input box currently edits: the search query, the peek reply, or the dispatch draft. */
export function activeText(ui: DashboardUI) {
  if (ui.search) return ui.query
  if (ui.selected) return ui.reply
  return ui.draft
}

export function setActiveText(ui: DashboardUI, text: string): DashboardUI {
  if (ui.search) return { ...ui, query: text }
  if (ui.selected) return { ...ui, reply: text }
  return { ...ui, draft: text }
}

/** Drops a selection whose row vanished (deleted, filtered out, archived). */
export function syncDashboardUI(ui: DashboardUI, rows: readonly DashboardRow[]): DashboardUI {
  if (!ui.selected || rows.some((row) => row.id === ui.selected)) return ui
  return { ...ui, selected: undefined, reply: "", option: 0, answers: [] }
}

export function dashboardKey(input: DashboardUI, key: DashboardKey, ctx: DashboardContext): DashboardResult {
  // Any key other than a second Ctrl+X cancels a pending delete confirmation.
  const ui = key.name === "ctrl+x" ? input : { ...input, armed: undefined }
  const question = ui.selected ? ctx.peek?.question : undefined
  const row = ctx.rows.find((item) => item.id === ui.selected)
  const done = (next: DashboardUI, effect?: DashboardEffect): DashboardResult => ({ ui: next, effect, handled: true })

  if (key.name === "char") {
    const digit = /^[1-9]$/u.test(key.char) ? Number(key.char) : 0
    if (question && digit && !ui.reply && !ui.search && question.options[digit - 1])
      return answer({ ...ui, option: digit - 1 }, question, digit - 1)
    if (ui.focus === "list") return done(setActiveText({ ...ui, focus: "input" }, activeText(ui) + key.char))
    return { ui, handled: false }
  }
  // Ctrl+\ toggles the dashboard: pressed inside it, it exits straight away (Grok: "exit dashboard").
  if (key.name === "ctrl+\\") return { ui, handled: true, effect: { type: "exit" } }
  if (key.name === "tab") return done({ ...ui, focus: ui.focus === "input" ? "list" : "input" })
  if (key.name === "ctrl+/") {
    if (ui.search) return done({ ...ui, search: false, query: "" })
    return done({ ...ui, search: true, focus: "input" })
  }
  if (key.name === "up" || key.name === "down") {
    const step = key.name === "up" ? -1 : 1
    if (question && question.options.length && ui.focus === "input" && !ui.search)
      return done({ ...ui, option: Math.min(question.options.length - 1, Math.max(0, ui.option + step)) })
    if (!ui.search && ui.focus === "input" && activeText(ui)) return { ui, handled: false }
    return done(moveSelection(ui, ctx.rows, step))
  }
  if (key.name === "enter") {
    if (ui.search) return done({ ...ui, search: false })
    if (ui.selected && row) {
      if (ui.focus === "list") return done(ui, { type: "open", id: row.id })
      if (question && question.options.length) return answer(ui, question, ui.option)
      if (ui.reply.trim()) return done({ ...ui, reply: "" }, { type: "reply", id: row.id, text: ui.reply, open: false })
      return done(ui, { type: "open", id: row.id })
    }
    return dispatch(ui, false)
  }
  if (key.name === "ctrl+s") {
    if (ui.selected && row) {
      if (ui.reply.trim()) return done({ ...ui, reply: "" }, { type: "reply", id: row.id, text: ui.reply, open: true })
      return done(ui, { type: "open", id: row.id })
    }
    return dispatch(ui, true)
  }
  if (key.name === "escape") {
    if (ui.search) return done({ ...ui, search: false, query: "" })
    if (ui.selected && ui.reply) return done({ ...ui, reply: "" })
    if (ui.selected) return done({ ...ui, selected: undefined, option: 0, answers: [] })
    if (ui.query) return done({ ...ui, query: "" })
    if (ui.focus === "input" && ctx.rows.length) return done({ ...ui, focus: "list" })
    return done(ui, { type: "exit" })
  }
  if (key.name === "ctrl+t") {
    if (!row) return { ui, handled: false }
    return done(ui, { type: "pin", id: row.id })
  }
  // ctrl+x: cancel a running turn; on a settled row press twice within 2s to permanently delete.
  if (!row) return { ui, handled: false }
  if (row.state !== "idle") return done({ ...ui, armed: undefined }, { type: "stop", id: row.id })
  if (ui.armed?.id === row.id && ctx.now - ui.armed.at <= deleteConfirmMs)
    return done(
      { ...ui, armed: undefined, selected: undefined, reply: "", option: 0, answers: [] },
      { type: "delete", id: row.id },
    )
  return done(
    { ...ui, armed: { id: row.id, at: ctx.now } },
    { type: "toast", message: "Press Ctrl+X again within 2s to delete" },
  )
}

function moveSelection(ui: DashboardUI, rows: readonly DashboardRow[], step: number): DashboardUI {
  // Index -1 is the `+ New Agent` cursor above the first row.
  const index = ui.selected ? rows.findIndex((row) => row.id === ui.selected) : -1
  const next = Math.min(rows.length - 1, Math.max(-1, index + step))
  const selected = next === -1 ? undefined : rows[next]!.id
  if (selected === ui.selected) return ui
  // A half-typed reply is dropped so it cannot land on the wrong agent.
  return { ...ui, selected, reply: "", option: 0, answers: [] }
}

function dispatch(ui: DashboardUI, attach: boolean): DashboardResult {
  const text = ui.draft
  if (!text.trim()) return { ui, effect: { type: "new" }, handled: true }
  if (new TextEncoder().encode(text).length > maxDispatchBytes)
    return { ui, effect: { type: "toast", message: "Prompt is larger than 64 KiB" }, handled: true }
  if (text.trimStart().startsWith("/"))
    return { ui: { ...ui, draft: "" }, effect: { type: "slash", text: text.trim() }, handled: true }
  return { ui: { ...ui, draft: "" }, effect: { type: "dispatch", text, attach }, handled: true }
}

function answer(ui: DashboardUI, question: PeekQuestion, index: number): DashboardResult {
  const option = question.options[index]
  const id = ui.selected!
  if (!option) return { ui, handled: true }
  if (question.kind === "permission") {
    const reply = option.value as "once" | "always" | "reject"
    const message = reply === "reject" && ui.reply.trim() ? ui.reply.trim() : undefined
    return {
      ui: { ...ui, reply: "", option: 0 },
      effect: { type: "permission", id, requestID: question.requestID, reply, ...(message ? { message } : {}) },
      handled: true,
    }
  }
  if (option.value === otherOption && !ui.reply.trim())
    return { ui, effect: { type: "toast", message: "Type an answer for Other first" }, handled: true }
  const answers = [...ui.answers, [option.value === otherOption ? ui.reply.trim() : option.value]]
  if (answers.length < question.total) return { ui: { ...ui, answers, reply: "", option: 0 }, handled: true }
  return {
    ui: { ...ui, answers: [], reply: "", option: 0 },
    effect: { type: "question", id, requestID: question.requestID, answers },
    handled: true,
  }
}
