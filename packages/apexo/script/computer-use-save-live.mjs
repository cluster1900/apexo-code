import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { toolName } from "../../../plugins/computer-use/script/build.mjs"
import { desktopExecutable } from "./computer-use-fixture.mjs"
import { prepareTextEditSave } from "./computer-use-save-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"

const desktopActions = new Map(
  [
    "status",
    "permissions",
    "version",
    "skills_get",
    "list_apps",
    "list_windows",
    "list_surfaces",
    "snapshot",
    "find",
    "get",
    "is",
    "click",
    "scroll",
    "set_value",
  ].map((action) => [toolName(`desktop_${action}`), action]),
)
const clean = (value) => String(value ?? "").replace(/\p{Cf}/gu, "")

export async function runLiveTextEditSave(fixture, run) {
  const { client, runtime } = fixture
  const session = await fixture.session()
  assert.equal((await client.permissions.getReview({ sessionID: session.id })).mode, "manual")
  const executable = await desktopExecutable(fixture.bundle)
  const document = await prepareTextEditSave()
  const events = []
  const reviewed = new Set()
  const completed = new Set()
  const refs = new Map()
  const windows = () => {
    const child = Bun.spawnSync([executable, "list-windows", "--app", "TextEdit"], {
      env: {
        ...runtime.env,
        AGENT_DESKTOP_HOME: join(runtime.output, "save-window-readiness"),
        AGENT_DESKTOP_MACOS_HELPER_PATH: `${executable}-macos-helper`,
      },
      timeout: 4_000,
    })
    if (child.exitCode !== 0) return []
    const result = JSON.parse(child.stdout.toString())
    return result.ok ? result.data.filter((window) => window.visible && window.accessible) : []
  }
  const start = performance.now()
  const record = (event) => events.push({ ...event, elapsedMs: Math.round(performance.now() - start) })
  function waitForWindow(select, label) {
    let nextPresentation = 0
    return poll(
      () => {
        const window = select(windows())
        if (window) return window
        if (performance.now() >= nextPresentation) {
          document.present()
          nextPresentation = performance.now() + 2500
        }
      },
      label,
      15_000,
    )
  }
  let selectedDirectory = false
  let saveApproved = false
  let saveReceipt = false
  let savedWindow = false
  let skillLoaded = false
  let windowRestorations = 0
  let observedActive = false
  let submitted = false
  let settled = false

  try {
    const initial = await waitForWindow((windows) => {
      const matches = windows.filter((window) => window.title === document.title)
      assert.ok(matches.length <= 1, "The fixture document must have a unique accessible window")
      return matches[0]
    }, "owned TextEdit window is visible and accessible")
    const sameWindow = (window) => window.id === initial.id && window.pid === initial.pid
    assert.equal(await Bun.file(document.file).exists(), false)
    record({ stage: "window-ready", windowID: initial.id })
    const filename = `${document.name}.rtf`
    const exactName = (value) => value === document.name || value === filename
    submitted = true
    await fixture.prompt(
      session.id,
      `Load the computer-use:computer-use Skill. Save the unsaved TextEdit document titled "${document.title}", containing "${document.marker}", as ${filename} inside the Downloads subfolder "${document.folder}". Keep the existing Rich Text contents. Use app-scoped TextEdit window discovery and verify the saved window name using the installed Skill.`,
      false,
    )

    const last = await poll(
      async () => {
        const requests = await client.permissions.list({ sessionID: session.id }, requestOptions())
        const active = Boolean((await client.sessions.active(requestOptions()))[session.id])
        observedActive ||= active
        const assistants = (
          await client.messages.list({ sessionID: session.id, order: "asc", limit: 150 }, requestOptions())
        ).data.filter((message) => message.type === "assistant")
        const calls = new Map()
        for (const message of assistants) {
          assert.equal(message.model.providerID, "xai")
          assert.equal(message.model.id, "grok-4.7")
          for (const part of message.content) {
            if (part.type !== "tool") continue
            if (part.name === "skill" && part.state.status === "completed") {
              if (part.state.input.name === "computer-use:computer-use") skillLoaded = true
              continue
            }
            calls.set(`${message.id}/${part.id}`, part)
            const action = desktopActions.get(part.name)
            if (!action || completed.has(part.id) || !["completed", "error"].includes(part.state.status)) continue
            assert.ok(reviewed.has(part.id), `Desktop action ${action} did not enter the released approval flow`)
            completed.add(part.id)
            const result = toolReceipt(part)
            record({ stage: "tool", action, status: part.state.status, code: result?.error?.code })
            if (part.state.status !== "completed" || !result?.ok) continue
            const input = part.state.input
            if (
              action === "list_windows" &&
              saveReceipt &&
              !savedWindow &&
              result.data.some(
                (window) =>
                  window.id === initial.id &&
                  window.pid === initial.pid &&
                  window.visible &&
                  window.accessible &&
                  exactName(window.title),
              )
            ) {
              savedWindow = true
              record({ stage: "saved-window-observed" })
            }
            if (action === "snapshot" || action === "find") {
              const parent = refs.get(input.root)
              const surface = input.root ? parent?.surface : (input.surface ?? "window")
              const nodes = observedNodes(result.data, parent?.fileMenu)
              const location = nodes.find((ref) => ref.node.name === "Where:")?.node.value
              const name = nodes.find((ref) => ref.node.name === "Save As:")?.node.value
              if (!selectedDirectory && surface === "sheet" && clean(location) === document.folder) {
                selectedDirectory = true
                record({ stage: "destination-confirmed" })
              }
              for (const ref of nodes)
                refs.set(ref.node.ref_id ?? ref.node.ref, { ...ref, surface, location: clean(location), name })
            }
            if (action === "click") {
              const target = refs.get(input.ref_id)
              if (target?.surface === "sheet" && target.node.role === "button" && target.node.name === "Save") {
                assert.ok(["delivered_unverified", "delivered_verified"].includes(result.data.disposition?.delivery))
                saveReceipt = true
                record({ stage: "save-click", delivery: result.data.disposition.delivery })
              }
            }
          }
        }

        let checkedWindow = false
        for (const request of requests) {
          const call = calls.get(`${request.source?.messageID}/${request.source?.callID}`)
          if (!call || call.state.status === "pending" || reviewed.has(call.id)) continue
          const action = desktopActions.get(request.action)
          assert.equal(request.action, call.name, "Permission request must belong to the observed call")
          const input = call.state.input
          const ref = refs.get(input.root ?? input.ref_id)
          assert.ok(
            isFixtureAction(action, input, ref, initial.id, document.folder, exactName) &&
              !(saveApproved && ["click", "set_value", "scroll"].includes(action)),
            `Model requested an action outside the save fixture: ${action ?? request.action} (${ref?.surface ?? "unscoped"}/${ref?.node.role ?? "no ref"})`,
          )
          if (!checkedWindow && !["status", "permissions", "version", "skills_get", "list_apps"].includes(action)) {
            checkedWindow = true
            if (!windows().some(sameWindow)) {
              // The operator can restore the fixture's visibility after a Space change.
              await waitForWindow((windows) => windows.find(sameWindow), "original TextEdit window is visible again")
              windowRestorations++
              record({ stage: "window-restored-by-operator" })
            }
          }
          await client.permissions.reply(
            { sessionID: session.id, requestID: request.id, reply: "once" },
            requestOptions(),
          )
          reviewed.add(call.id)
          if (action === "click" && ref?.surface === "sheet" && ref.node.name === "Save") saveApproved = true
          record({ stage: "approved-once", action })
        }

        if (!active && (observedActive || assistants.length > 0) && requests.length === 0) {
          await client.sessions.wait({ sessionID: session.id }, requestOptions())
          return { assistant: assistants.at(-1) }
        }
        await Bun.sleep(250)
      },
      "live model selects, saves and settles",
      360_000,
    )
    settled = true
    assert.equal(last.assistant?.finish, "stop", "The real model must finish the Save task normally")
    assert.ok(skillLoaded && reviewed.size > 0, "The model must load the released Skill and use the ask profile")
    assert.ok(
      selectedDirectory && saveReceipt && savedWindow,
      "Missing proof of directory selection, Save, or the saved window name",
    )
    await document.verify()
    record({ stage: "independent-readback" })
    const result = {
      run,
      model: "xai/grok-4.7",
      approvals: reviewed.size,
      selectedDirectory,
      savedWindow,
      exactReadback: true,
      windowRestorations,
      elapsedMs: events.at(-1).elapsedMs,
    }
    console.log(JSON.stringify(result))
    return result
  } catch (error) {
    record({ stage: "failure", message: error.message })
    throw error
  } finally {
    if (submitted && !settled) {
      await client.sessions.interrupt({ sessionID: session.id }, requestOptions()).catch(() => {})
      await client.sessions.wait({ sessionID: session.id }, requestOptions()).catch(() => {})
    }
    await Promise.all([
      writeFile(
        join(runtime.output, `live-save-${run}.json`),
        JSON.stringify({ sessionID: session.id, events }, null, 2),
      ),
      document.close(),
    ])
  }
}

function isFixtureAction(action, input, ref, windowID, folder, exactName) {
  if (["status", "permissions", "version", "skills_get"].includes(action)) return true
  const app = input.app === "TextEdit" || input.app === "com.apple.TextEdit"
  if (input.app && !app) return false
  if (input.window_id && input.window_id !== windowID) return false
  if (["list_apps", "list_windows"].includes(action)) return app
  if (action === "list_surfaces") return app || input.window_id === windowID
  if (["snapshot", "find"].includes(action)) {
    if (input.root) return Boolean(ref)
    if (input.window_id) return true
    return app && ["menubar", "menu"].includes(input.surface)
  }
  if (!ref) return false
  if (["get", "is"].includes(action)) return true
  if (action === "scroll") return ref.surface === "sheet" && ref.node.role === "scrollarea"
  const name = clean(ref.node.name)
  if (action === "set_value")
    return ref.surface === "sheet" && ref.node.role === "textfield" && name === "Save As:" && exactName(input.value)
  if (action !== "click") return false
  if (ref.node.role === "menuitem") {
    if (ref.surface === "menubar" && name === "File") return true
    return (ref.fileMenu || ref.surface === "menu") && /^Save[.…]*$/.test(name)
  }
  if (ref.surface !== "sheet") return false
  if (name === "Cancel") return ref.node.role === "button"
  if (name === "Save") return ref.node.role === "button" && ref.location === folder && exactName(ref.name)
  return (
    ["Downloads", "show more options", "show less options", folder].includes(name) || clean(ref.node.value) === folder
  )
}

function observedNodes(value, insideFileMenu = false) {
  if (!value || typeof value !== "object") return []
  const fileMenu = insideFileMenu || (value.name === "File" && ["menu", "menuitem"].includes(value.role))
  return [
    ...(value.ref_id || value.ref ? [{ node: value, fileMenu }] : []),
    ...Object.values(value).flatMap((child) => observedNodes(child, fileMenu)),
  ]
}

function toolReceipt(part) {
  const text = part.state.content?.find((item) => item.type === "text")?.text ?? part.state.error?.message
  if (text?.startsWith("{")) return JSON.parse(text)
}

function requestOptions() {
  return { signal: AbortSignal.timeout(10_000) }
}
