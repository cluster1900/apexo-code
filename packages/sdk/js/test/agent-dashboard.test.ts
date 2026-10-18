import { describe, expect, test } from "bun:test"
import {
  clampText,
  dashboardChips,
  dashboardKey,
  dashboardPeek,
  dashboardRows,
  formatTimeAgo,
  initialDashboardUI,
  lastResponseType,
  parseDashboardFilter,
  rowGlyph,
  syncDashboardUI,
  type DashboardData,
  type DashboardUI,
} from "../src/v2/agent-dashboard"

const now = 1_000_000_000
const session = (id: string, title: string, updated = now, extra = {}) => ({
  id,
  title,
  directory: "/repo",
  time: { created: 0, updated },
  ...extra,
})

function fixture(): DashboardData {
  return {
    sessions: [
      session("ses_idle", "housekeeping", now - 3_600_000),
      session("ses_busy", "implementer · fix login", now - 120_000),
      session("ses_perm", "reviewer · audit", now - 60_000),
      session("ses_child", "subagent", now, { parentID: "ses_busy" }),
      session("ses_old", "archived", now, { time: { created: 0, updated: now, archived: now } }),
      session("ses_ask", "asker", now - 10_000),
    ],
    status: { ses_busy: { type: "busy" }, ses_perm: { type: "busy" } },
    permission: {
      ses_perm: [{ id: "per_1", sessionID: "ses_perm", permission: "bash", patterns: ["git status"], metadata: {} }],
    },
    question: {
      ses_ask: [
        {
          id: "que_1",
          sessionID: "ses_ask",
          questions: [
            { question: "Which DB?", options: [{ label: "Postgres" }, { label: "SQLite" }] },
            { question: "Which ORM?", options: [{ label: "Drizzle" }], custom: false },
          ],
        },
      ],
    },
    message: {
      ses_idle: [
        {
          id: "m1",
          role: "user",
          time: { created: 1 },
          agent: "build",
          model: { providerID: "xai", modelID: "grok-4" },
        },
        { id: "m2", role: "assistant", time: { created: 2, completed: 3 }, modelID: "grok-4", providerID: "xai" },
      ],
      ses_busy: [
        { id: "b1", role: "user", time: { created: 1 }, agent: "build" },
        { id: "b2", role: "assistant", time: { created: 2 }, modelID: "grok-4" },
      ],
    },
    part: {
      m2: [
        { type: "reasoning", text: "thinking", time: { start: 1, end: 2 } },
        { type: "text", text: "\nAll tidy now.\nSecond line", time: { start: 2, end: 3 } },
      ],
      b2: [{ type: "tool", tool: "bash", state: { status: "running", input: { command: "cargo test --workspace" } } }],
    },
  }
}

describe("dashboard rows", () => {
  test("lists top-level, unarchived sessions sorted Needs input → Working → Idle, newest first", () => {
    const rows = dashboardRows(fixture())
    expect(rows.map((row) => row.id)).toEqual(["ses_ask", "ses_perm", "ses_busy", "ses_idle"])
    expect(rows.map((row) => row.state)).toEqual(["needs-input", "needs-input", "working", "idle"])
  })
  test("activity and subtitles follow grok row_activity", () => {
    const rows = Object.fromEntries(dashboardRows(fixture()).map((row) => [row.id, row]))
    expect(rows.ses_perm!.activity).toBe("Awaiting your input")
    expect(rows.ses_perm!.subtitle).toBe("Pending: Bash git status")
    expect(rows.ses_ask!.subtitle).toBe("Pending: question")
    expect(rows.ses_busy!.activity).toBe("Running: cargo test --workspace")
    expect(rows.ses_busy!.subtitle).toBe("Running: cargo test --workspace")
    expect(rows.ses_idle!.activity).toBeUndefined()
    expect(rows.ses_idle!.subtitle).toBe("All tidy now.")
  })
  test("long running subjects are cut at 40 chars", () => {
    const data = fixture()
    data.part.b2 = [{ type: "tool", tool: "bash", state: { status: "running", title: "x".repeat(50) } }]
    expect(dashboardRows(data).find((row) => row.id === "ses_busy")!.activity).toBe(`Running: ${"x".repeat(40)}…`)
  })
  test("pinned rows float to the top in pin order", () => {
    const rows = dashboardRows({ ...fixture(), pinned: ["ses_idle", "ses_busy"] })
    expect(rows.map((row) => row.id)).toEqual(["ses_idle", "ses_busy", "ses_ask", "ses_perm"])
  })
  test("header chips and glyphs", () => {
    expect(dashboardChips(dashboardRows(fixture())).map((chip) => `${chip.glyph} ${chip.label}`)).toEqual([
      "◆ 2 awaiting",
      "⋮ 1 working",
      "◇ 1 idle",
    ])
    expect(rowGlyph("needs-input")).toBe("●")
    expect(rowGlyph("idle")).toBe("○")
    expect([0, 1, 2, 3, 4].map((frame) => rowGlyph("working", frame))).toEqual(["⋅", ":", "⸬", "⁙", "⋅"])
  })
  test("time ago buckets", () => {
    expect(
      [0, 59, 60, 3599, 3600, 86_399, 86_400, 86_400 * 30, 86_400 * 365].map((s) => formatTimeAgo(s * 1000)),
    ).toEqual(["just now", "just now", "1m", "59m", "1h", "23h", "1d", "1mo", "1y"])
  })
})

describe("dashboard filter", () => {
  test("prefixes", () => {
    expect(parseDashboardFilter("a:Review")).toEqual({ type: "agent", value: "review" })
    expect(parseDashboardFilter("s:busy")).toEqual({ type: "state", value: "working" })
    expect(parseDashboardFilter("s:done")).toEqual({ type: "state", value: "none" })
    expect(parseDashboardFilter("#Tag")).toEqual({ type: "tag", value: "#tag" })
    expect(parseDashboardFilter("  ")).toEqual({ type: "none" })
  })
  test("filters rows", () => {
    expect(dashboardRows(fixture(), "s:idle").map((row) => row.id)).toEqual(["ses_idle"])
    expect(dashboardRows(fixture(), "s:needs-input").map((row) => row.id)).toEqual(["ses_ask", "ses_perm"])
    expect(dashboardRows(fixture(), "s:failed")).toEqual([])
    expect(dashboardRows(fixture(), "login").map((row) => row.id)).toEqual(["ses_busy"])
    expect(dashboardRows(fixture(), "a:build").map((row) => row.id)).toEqual(["ses_busy", "ses_idle"])
  })
})

describe("peek", () => {
  test("idle agent: response type, time, last response, model", () => {
    const peek = dashboardPeek(fixture(), "ses_idle", now)!
    expect(peek.responseType).toBe("Response")
    expect(peek.time).toBe("1h")
    expect(peek.body).toBe("All tidy now.\nSecond line")
    expect(peek.model).toBe("grok-4")
    expect(peek.question).toBeUndefined()
  })
  test("running tool shows its label and what is running", () => {
    const peek = dashboardPeek(fixture(), "ses_busy", now)!
    expect(peek.responseType).toBe("Bash")
    expect(peek.body).toBe("cargo test --workspace")
  })
  test("response types track live activity like extract_last_response_type", () => {
    const data = fixture()
    data.part.b2 = [{ type: "reasoning", text: "hmm", time: { start: 1 } }]
    expect(lastResponseType(data, "ses_busy")).toBe("Thinking")
    data.part.b2 = [{ type: "text", text: "partial", time: { start: 1 } }]
    expect(lastResponseType(data, "ses_busy")).toBe("Response")
    data.part.b2 = []
    expect(lastResponseType(data, "ses_busy")).toBe("Working")
    data.status.ses_busy = { type: "retry", attempt: 2 }
    expect(lastResponseType(data, "ses_busy")).toBe("Retrying")
    data.status.ses_busy = { type: "idle" }
    expect(lastResponseType(data, "ses_busy")).toBe("Idle")
    data.part.m2 = [{ type: "reasoning", text: "done", time: { start: 1, end: 2 } }]
    expect(lastResponseType(data, "ses_idle")).toBe("Thought")
    data.part.m2 = [{ type: "tool", tool: "apply_patch", state: { status: "completed" } }]
    expect(lastResponseType(data, "ses_idle")).toBe("Edit")
  })
  test("pending permission takes the question slot with Apexo's options", () => {
    const question = dashboardPeek(fixture(), "ses_perm", now)!.question!
    expect(question.kind).toBe("permission")
    expect(question.text).toBe("Bash git status")
    expect(question.options.map((option) => option.label)).toEqual(["Allow once", "Allow always", "Reject"])
    expect(question.free).toBe(2)
  })
  test("multi-question asks walk one at a time with an (i/N) marker and Other", () => {
    const first = dashboardPeek(fixture(), "ses_ask", now)!.question!
    expect(first.text).toBe("(1/2) Which DB?")
    expect(first.options.map((option) => option.label)).toEqual(["Postgres", "SQLite", "Other"])
    const second = dashboardPeek(fixture(), "ses_ask", now, 1)!.question!
    expect(second.text).toBe("(2/2) Which ORM?")
    expect(second.options.map((option) => option.label)).toEqual(["Drizzle"])
    expect(second.free).toBeUndefined()
  })
  test("clampText wraps to width and truncates with an ellipsis", () => {
    expect(clampText("one two three four five six", 9, 3)).toEqual(["one two ", "three ", "four fiv…"])
    expect(clampText("short", 20)).toEqual(["short"])
  })
})

describe("dashboard keys", () => {
  const data = fixture()
  const rows = dashboardRows(data)
  const ctx = (ui: DashboardUI) => ({
    rows,
    now,
    peek: ui.selected ? dashboardPeek(data, ui.selected, now, ui.answers.length) : undefined,
  })
  const press = (ui: DashboardUI, ...keys: Parameters<typeof dashboardKey>[1][]) =>
    keys.reduce<{ ui: DashboardUI; effects: unknown[] }>(
      (acc, key) => {
        const result = dashboardKey(acc.ui, key, ctx(acc.ui))
        return { ui: result.ui, effects: result.effect ? [...acc.effects, result.effect] : acc.effects }
      },
      { ui, effects: [] },
    )

  test("opens with list focus and the + New Agent cursor; empty roster focuses dispatch", () => {
    expect(initialDashboardUI(rows).focus).toBe("list")
    expect(initialDashboardUI(rows).selected).toBeUndefined()
    expect(initialDashboardUI([]).focus).toBe("input")
  })
  test("↓ selects rows (peek), ↑ past the first row returns to + New Agent", () => {
    const start = initialDashboardUI(rows)
    expect(press(start, { name: "down" }).ui.selected).toBe("ses_ask")
    expect(press(start, { name: "down" }, { name: "down" }, { name: "down" }).ui.selected).toBe("ses_busy")
    expect(press(start, { name: "down" }, { name: "up" }).ui.selected).toBeUndefined()
  })
  test("typed reply + Enter replies to the selected agent and stays; Ctrl+S replies and opens", () => {
    const busy: DashboardUI = { ...initialDashboardUI(rows), selected: "ses_busy", focus: "input", reply: "keep going" }
    const sent = dashboardKey(busy, { name: "enter" }, ctx(busy))
    expect(sent.effect).toEqual({ type: "reply", id: "ses_busy", text: "keep going", open: false })
    expect(sent.ui.reply).toBe("")
    expect(dashboardKey(busy, { name: "ctrl+s" }, ctx(busy)).effect).toEqual({
      type: "reply",
      id: "ses_busy",
      text: "keep going",
      open: true,
    })
    expect(dashboardKey({ ...busy, reply: "" }, { name: "enter" }, ctx(busy)).effect).toEqual({
      type: "open",
      id: "ses_busy",
    })
  })
  test("↑/↓ move the caret once the reply has content; while empty they switch agents and clear the draft", () => {
    const typed: DashboardUI = { ...initialDashboardUI(rows), selected: "ses_busy", focus: "input", reply: "half" }
    expect(dashboardKey(typed, { name: "down" }, ctx(typed)).handled).toBe(false)
    const listed = dashboardKey({ ...typed, focus: "list" }, { name: "down" }, ctx(typed))
    expect(listed.ui).toMatchObject({ selected: "ses_idle", reply: "" })
  })
  test("Esc steps back: clear reply → deselect → clear filter → unfocus → exit; never clears the dispatch draft", () => {
    const start: DashboardUI = {
      ...initialDashboardUI(rows),
      selected: "ses_busy",
      focus: "input",
      reply: "x",
      query: "login",
      draft: "keep me",
    }
    const steps = [1, 2, 3, 4].reduce<DashboardUI[]>(
      (out) => [...out, dashboardKey(out.at(-1)!, { name: "escape" }, ctx(out.at(-1)!)).ui],
      [start],
    )
    expect(steps.map((ui) => [ui.reply, ui.selected, ui.query, ui.focus])).toEqual([
      ["x", "ses_busy", "login", "input"],
      ["", "ses_busy", "login", "input"],
      ["", undefined, "login", "input"],
      ["", undefined, "", "input"],
      ["", undefined, "", "list"],
    ])
    expect(steps.at(-1)!.draft).toBe("keep me")
    expect(dashboardKey(steps.at(-1)!, { name: "escape" }, ctx(steps.at(-1)!)).effect).toEqual({ type: "exit" })
  })
  test("dispatch: Enter spawns and stays, Ctrl+S spawns and attaches, empty creates a new agent, / runs a command", () => {
    const ui: DashboardUI = { ...initialDashboardUI(rows), focus: "input", draft: "new task" }
    expect(dashboardKey(ui, { name: "enter" }, ctx(ui))).toMatchObject({
      ui: { draft: "" },
      effect: { type: "dispatch", text: "new task", attach: false },
    })
    expect(dashboardKey(ui, { name: "ctrl+s" }, ctx(ui)).effect).toEqual({
      type: "dispatch",
      text: "new task",
      attach: true,
    })
    expect(dashboardKey({ ...ui, draft: "  " }, { name: "enter" }, ctx(ui)).effect).toEqual({ type: "new" })
    expect(dashboardKey({ ...ui, draft: "/usage" }, { name: "enter" }, ctx(ui)).effect).toEqual({
      type: "slash",
      text: "/usage",
    })
    expect(dashboardKey({ ...ui, draft: "x".repeat(70_000) }, { name: "enter" }, ctx(ui)).effect).toEqual({
      type: "toast",
      message: "Prompt is larger than 64 KiB",
    })
  })
  test("permission: ↑/↓ highlight, Enter answers, digits answer directly, typed text rejects with feedback", () => {
    const ui: DashboardUI = { ...initialDashboardUI(rows), selected: "ses_perm", focus: "input" }
    expect(press(ui, { name: "down" }, { name: "enter" }).effects).toEqual([
      { type: "permission", id: "ses_perm", requestID: "per_1", reply: "always" },
    ])
    expect(press(ui, { name: "char", char: "1" }).effects).toEqual([
      { type: "permission", id: "ses_perm", requestID: "per_1", reply: "once" },
    ])
    expect(press({ ...ui, option: 2, reply: "use rg" }, { name: "enter" }).effects).toEqual([
      { type: "permission", id: "ses_perm", requestID: "per_1", reply: "reject", message: "use rg" },
    ])
  })
  test("questions: answers accumulate across a multi-question ask and Other takes typed text", () => {
    const ui: DashboardUI = { ...initialDashboardUI(rows), selected: "ses_ask", focus: "input" }
    const first = press(ui, { name: "char", char: "2" })
    expect(first.effects).toEqual([])
    expect(first.ui.answers).toEqual([["SQLite"]])
    expect(press(first.ui, { name: "enter" }).effects).toEqual([
      { type: "question", id: "ses_ask", requestID: "que_1", answers: [["SQLite"], ["Drizzle"]] },
    ])
    const other = press({ ...ui, option: 2, reply: "MySQL" }, { name: "enter" })
    expect(other.ui.answers).toEqual([["MySQL"]])
    expect(press({ ...ui, option: 2 }, { name: "enter" }).effects).toEqual([
      { type: "toast", message: "Type an answer for Other first" },
    ])
  })
  test("Ctrl+X stops a running turn; on an idle row it needs a second press within 2s to delete", () => {
    const busy: DashboardUI = { ...initialDashboardUI(rows), selected: "ses_busy" }
    expect(dashboardKey(busy, { name: "ctrl+x" }, ctx(busy)).effect).toEqual({ type: "stop", id: "ses_busy" })
    const idle: DashboardUI = { ...initialDashboardUI(rows), selected: "ses_idle" }
    const armed = dashboardKey(idle, { name: "ctrl+x" }, ctx(idle))
    expect(armed.effect).toEqual({ type: "toast", message: "Press Ctrl+X again within 2s to delete" })
    expect(dashboardKey(armed.ui, { name: "ctrl+x" }, ctx(armed.ui)).effect).toEqual({ type: "delete", id: "ses_idle" })
    expect(dashboardKey(armed.ui, { name: "ctrl+x" }, { ...ctx(armed.ui), now: now + 2500 }).effect?.type).toBe("toast")
    const cancelled = dashboardKey(armed.ui, { name: "tab" }, ctx(armed.ui)).ui
    expect(dashboardKey(cancelled, { name: "ctrl+x" }, ctx(cancelled)).effect?.type).toBe("toast")
  })
  test("Ctrl+/ search mode edits the query, Enter keeps the filter, Esc cancels it", () => {
    const searching = press(initialDashboardUI(rows), { name: "ctrl+/" }).ui
    expect(searching).toMatchObject({ search: true, focus: "input" })
    const kept = press({ ...searching, query: "login" }, { name: "enter" }).ui
    expect(kept).toMatchObject({ search: false, query: "login" })
    expect(press({ ...searching, query: "login" }, { name: "escape" }).ui).toMatchObject({ search: false, query: "" })
  })
  test("Ctrl+\\ inside the dashboard exits from any state", () => {
    const busy: DashboardUI = { ...initialDashboardUI(rows), selected: "ses_busy", reply: "draft", search: true }
    expect(press(busy, { name: "ctrl+\\" }).effects).toEqual([{ type: "exit" }])
  })
  test("a printable key on the focused list re-focuses the input and types into it", () => {
    const ui: DashboardUI = { ...initialDashboardUI(rows), selected: "ses_busy" }
    expect(press(ui, { name: "char", char: "h" }).ui).toMatchObject({ focus: "input", reply: "h" })
  })
  test("a vanished selection falls back to + New Agent", () => {
    expect(syncDashboardUI({ ...initialDashboardUI(rows), selected: "gone", reply: "x" }, rows)).toMatchObject({
      selected: undefined,
      reply: "",
    })
  })
})
