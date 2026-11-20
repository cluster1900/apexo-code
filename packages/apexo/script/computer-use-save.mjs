import assert from "node:assert/strict"
import { toolName } from "../../../plugins/computer-use/script/build.mjs"
import { startComputerUseFixture } from "./computer-use-fixture.mjs"
import { prepareTextEditSave } from "./computer-use-save-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
assert.ok(["cli", "desktop"].includes(kind), "Expected cli or desktop")
assert.equal(process.platform, "darwin", "The Save dialog regression requires macOS with Accessibility granted")

const fixture = await startComputerUseFixture(kind, { releasePermissions: true })
const { client, state } = fixture
const clean = (value) => String(value ?? "").replace(/\p{Cf}/gu, "")
const nodes = (node) =>
  node && typeof node === "object" ? [...(node.ref_id ? [node] : []), ...Object.values(node).flatMap(nodes)] : []
const named = (data, name) => nodes(data).find((node) => node.name === name)
let document
let approvals = 0
let representedWindow = false
try {
  await fixture.install()
  const session = await fixture.session()
  await client.permissions.setReview({ sessionID: session.id, mode: "manual" })
  const history = async () => (await client.messages.list({ sessionID: session.id, order: "desc", limit: 10 })).data

  async function invoke(name, args, observation = false) {
    const action = name === "skill" ? name : toolName(name)
    const before = new Set((await history()).map((message) => message.id))
    state.steps.push({ tool: action, args }, { content: "Save dialog step complete." })
    await fixture.prompt(session.id, `Run the fixture's ${name} step.`, false)
    if (name !== "skill") {
      const request = await fixture.pending(session.id)
      assert.equal(request.action, action, "Each desktop call must reach the released profile's approval flow")
      await client.permissions.reply({ sessionID: session.id, requestID: request.id, reply: "once" })
      approvals++
    }
    await client.sessions.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(30_000) })
    const tool = (await history())
      .flatMap((message) => (!before.has(message.id) && message.type === "assistant" ? message.content : []))
      .find((part) => part.type === "tool" && part.name === action)
    assert.ok(tool, `Missing session receipt for ${name}`)
    if (observation && tool.state.status === "error") {
      if (!representedWindow && tool.state.error?.message?.includes('"code":"WINDOW_NOT_FOUND"')) {
        document.present()
        representedWindow = true
      }
      return
    }
    assert.equal(tool.state.status, "completed", JSON.stringify(tool.state))
    const receipt = tool.state.content.find((part) => part.type === "text")?.text
    assert.ok(receipt, `Missing tool result for ${name}`)
    if (name === "skill") return receipt
    const result = JSON.parse(receipt)
    if (observation && !result.ok) return
    assert.ok(result.ok, JSON.stringify(result.error))
    return result.data
  }

  function observe(args, select, label) {
    return poll(async () => select(await invoke("desktop_snapshot", args, true)), label, 20_000)
  }

  function click(node) {
    assert.ok(node?.ref_id)
    return invoke("desktop_click", { ref_id: node.ref_id })
  }

  const skill = await invoke("skill", { name: "computer-use:computer-use" })
  assert.match(skill, /Save a new macOS document/)
  document = await prepareTextEditSave()
  document.present()
  assert.equal(await Bun.file(document.file).exists(), false)
  const window = await poll(
    async () => {
      const windows = await invoke("desktop_list_windows", { app: "TextEdit" })
      const matches = windows.filter((window) => window.title === document.title && window.visible && window.accessible)
      assert.ok(matches.length <= 1, "The fixture document title must identify exactly one window")
      return matches[0]
    },
    "owned TextEdit window",
    15_000,
  )
  const target = { app: "TextEdit", window_id: window.id }
  const initial = await invoke("desktop_snapshot", { ...target, max_depth: 4 })
  assert.ok(
    nodes(initial).some((node) => typeof node.value === "string" && node.value.startsWith(document.marker)),
    "The selected window contains the unsaved fixture",
  )

  const file = await observe(
    { app: target.app, surface: "menubar", max_depth: 2 },
    (data) => named(data, "File"),
    "File menu",
  )
  const save = await observe(
    { root: file.ref_id, max_depth: 2 },
    (data) => nodes(data).find((node) => node.role === "menuitem" && /^Save[.…]*$/.test(node.name ?? "")),
    "File > Save in the menubar subtree",
  )
  await click(save)
  const sheet = { ...target, surface: "sheet", max_depth: 2 }
  const where = (data) => clean(named(data, "Where:")?.value)
  const saveSheet = await observe(sheet, (data) => named(data, "Save As:") && data, "owned Save sheet")
  assert.equal(named(saveSheet, "File Format:")?.value, "Rich Text Document")
  const disclosure = named(saveSheet, "show more options")
  if (disclosure) await click(disclosure)
  const expanded = { ...sheet, max_depth: 4, include_bounds: true }
  const sidebar = await observe(
    expanded,
    (data) => nodes(data).find((node) => node.role === "treeitem" && node.name === "Downloads"),
    "Downloads in the Save sidebar",
  )
  if (where(saveSheet) !== "Downloads") await click(sidebar)
  await observe(sheet, (data) => where(data) === "Downloads", "selected Downloads location")

  const browser = await observe(
    expanded,
    (data) => nodes(data).find((node) => node.role === "browser" && node.bounds),
    "visible Save file browser",
  )
  const columns = await invoke("desktop_snapshot", { root: browser.ref_id, max_depth: 1, include_bounds: true })
  const column = nodes(columns).find(
    (node) =>
      node.role === "scrollarea" &&
      node.bounds &&
      node.bounds.x + 20 >= browser.bounds.x &&
      node.bounds.x + 20 <= browser.bounds.x + browser.bounds.width,
  )
  assert.ok(column, "The selected sidebar location has a visible directory column")
  const folder = await observe(
    { root: column.ref_id, max_depth: 3, timeout_ms: 6000 },
    (data) => nodes(data).find((node) => [node.name, node.value].some((label) => clean(label) === document.folder)),
    "the exact nested fixture folder in the visible column",
  )
  await click(folder)
  const selected = await observe(
    sheet,
    (data) => where(data) === document.folder && data,
    "selected nested fixture directory",
  )
  await click(named(selected, "show less options"))

  const compact = await observe(
    sheet,
    (data) => where(data) === document.folder && named(data, "show more options") && data,
    "the selected location survives collapsing the dialog",
  )
  await invoke("desktop_set_value", { ref_id: named(compact, "Save As:").ref_id, value: document.name })
  const ready = await observe(
    sheet,
    (data) =>
      where(data) === document.folder && named(data, "Save As:")?.value === document.name && named(data, "Save"),
    "exact destination and filename",
  )
  await click(ready)
  await document.verify()
  const saved = await invoke("desktop_list_windows", { app: "TextEdit" })
  assert.ok(saved.some((window) => window.id === target.window_id && window.title.includes(document.name)))
  const advertised = new Set(
    state.requests.flatMap((request) => (request.tools ?? []).map((tool) => tool.function?.name ?? tool.name)),
  )
  assert.ok(advertised.has(toolName("desktop_click")))
  assert.equal(advertised.has(toolName("desktop_press")), false)
  assert.equal(advertised.has(toolName("desktop_focus_window")), false)
  assert.ok(approvals > 0)
  console.log(
    JSON.stringify({
      kind,
      releaseProfile: "ask",
      approvals,
      savedAtSelectedDirectory: true,
      exactText: true,
      representedWindow,
    }),
  )
} finally {
  await Promise.all([document?.close(), fixture.runtime.close()])
}
