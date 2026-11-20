import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { toolName } from "../../../plugins/computer-use/script/build.mjs"
import { desktopExecutable } from "./computer-use-fixture.mjs"
import { prepareTextEditSave, waitForTextEditWindow } from "./computer-use-save-fixture.mjs"
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
    "screenshot",
    "set_value",
  ].map((action) => [toolName(`desktop_${action}`), action]),
)
const clean = (value) => String(value ?? "").replace(/\p{Cf}/gu, "")
const mutations = new Set(["click", "scroll", "set_value"])

export async function runLiveTextEditSave(fixture, run, options = {}) {
  const { client, runtime } = fixture
  const session = await fixture.session()
  if (client.permissions.getReview)
    assert.equal((await client.permissions.getReview({ sessionID: session.id }, requestOptions())).mode, "manual")
  const executable = await desktopExecutable(fixture.bundle)
  const events = []
  const reviewed = new Map()
  const completed = new Set()
  const refs = new Map()
  const readWindows = () => {
    const child = Bun.spawnSync([executable, "list-windows", "--app", "TextEdit"], {
      env: {
        ...runtime.env,
        AGENT_DESKTOP_HOME: join(runtime.output, "save-window-readiness"),
        AGENT_DESKTOP_MACOS_HELPER_PATH: `${executable}-macos-helper`,
      },
      timeout: 4_000,
    })
    const result = child.stdout.length ? JSON.parse(child.stdout.toString()) : undefined
    return {
      windows: result?.ok ? result.data.filter((window) => window.visible && window.accessible) : [],
      code: result?.error?.code,
      exitCode: child.exitCode,
      signal: child.signalCode,
    }
  }
  const start = performance.now()
  const record = (event) => events.push({ ...event, elapsedMs: Math.round(performance.now() - start) })
  let selectedDirectory = false
  let saveApproved
  let saveReceipt
  let savedWindow = false
  let readback = false
  let skillLoaded = false
  let windowRestorations = 0
  let lastReportedRestoration = 0
  let recovery
  let rediscoveredAt
  let inputSurface
  let document
  let submitted = false
  let settled = false

  try {
    inputSurface = await options.openInput?.(session.id)
    document = await prepareTextEditSave()
    const initial = await waitForTextEditWindow(() => {
      const matches = readWindows().windows.filter((window) => window.title === document.title)
      assert.ok(matches.length <= 1, "The fixture document must have a unique accessible window")
      return matches[0]
    }, "owned TextEdit window is visible and accessible")
    const sameWindow = (window) => window.id === initial.id && window.pid === initial.pid
    const observeWindow = () => {
      const { windows, ...probe } = readWindows()
      const physical = options.windows?.observe(initial)
      return { ...probe, ...physical, accessible: windows.some(sameWindow) }
    }
    const restoreWindow = () => {
      if (!options.windows) return document.present()
      const receipt = options.windows.restore(initial)
      record({ stage: "window-restore-requested", windowID: initial.id, receipt })
      return undefined
    }
    const ready = (state) => state.accessible && state.onscreen !== false
    const ensureWindow = async (action, needsForeground) => {
      let state = observeWindow()
      const wasUnavailable = !ready(state)
      if (wasUnavailable) record({ stage: "window-unavailable", windowID: initial.id, action, ...state })
      if (!wasUnavailable && (!needsForeground || state.foregroundApp === "com.apple.TextEdit")) return
      if (!options.windows && !wasUnavailable) {
        document.present()
        return
      }
      await waitForTextEditWindow(
        () => {
          state = observeWindow()
          return ready(state) && (!needsForeground || !options.windows || state.foregroundApp === "com.apple.TextEdit")
        },
        `original TextEdit window ${initial.id} is visible and accessible again`,
        restoreWindow,
      ).catch((error) => {
        record({ stage: "window-restoration-failed", windowID: initial.id, action, ...state })
        throw error
      })
      if (wasUnavailable) {
        windowRestorations++
        record({ stage: "window-restored-by-operator", windowID: initial.id, action, ...state })
      }
    }
    await document.assertUnsaved()
    record({ stage: "window-ready", windowID: initial.id, pid: initial.pid })
    const filename = `${document.name}.rtf`
    const exactName = (value) => value === document.name || value === filename
    const task = `Load the computer-use:computer-use Skill. Save the unsaved TextEdit document titled "${document.title}", containing "${document.marker}", as ${filename} in the Downloads subfolder "${document.folder}". Preserve its Rich Text contents. Use only the installed desktop MCP tools, with search_tool and use_tool if needed. List windows scoped to TextEdit. Snapshot its menubar at depth 1, then snapshot the File ref using only root and max_depth: 2. Click the Save menu item directly from that File subtree. Use surface "sheet" and the exact window ID when observing Save controls, or use a root obtained from that sheet. Follow the Skill for directory selection. Set Save As with desktop_set_value and verify the filename and Where together in a shallow sheet snapshot. Take one action at a time and verify the saved name in the window list.`
    submitted = true
    if (inputSurface) await inputSurface.submit(task)
    if (!inputSurface) await fixture.prompt(session.id, task, false)

    const last = await poll(
      async () => {
        const requests = await client.permissions.list({ sessionID: session.id }, requestOptions())
        const active = Boolean((await client.sessions.active(requestOptions()))[session.id])
        const { data: history } = await client.messages.list(
          { sessionID: session.id, order: "asc", limit: 150 },
          requestOptions(),
        )
        const assistants = history.filter((message) => message.type === "assistant")
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
            const key = `${message.id}/${part.id}`
            calls.set(key, part)
            const action = desktopActions.get(part.name)
            if (!action || completed.has(key) || !["completed", "error"].includes(part.state.status)) continue
            const review = reviewed.get(key)
            assert.ok(review, `Desktop action ${action} did not enter the released approval flow`)
            if (review.reply === "reject") assert.equal(part.state.status, "error")
            completed.add(key)
            const result = toolReceipt(part)
            record({ stage: "tool", action, callID: part.id, status: part.state.status, code: result?.error?.code })
            if (recovery?.staleCall === key) {
              assert.equal(review.reply, "reject")
              assert.match(part.state.error.message, /permission.*(?:denied|rejected)|rejected.*permission/i)
              assert.equal(result, undefined, "A rejected Save must not have a desktop dispatch receipt")
              await document.assertUnsaved()
              recovery.rejected = true
              record({ stage: "stale-save-rejection-confirmed", callID: part.id, destinationEmpty: true })
            }
            if (part.state.status !== "completed" || !result?.ok) continue
            const input = part.state.input
            if (action === "list_windows") {
              const observed = result.data.find((window) => sameWindow(window) && window.visible && window.accessible)
              if (
                observed &&
                recovery?.rejected &&
                !saveApproved &&
                review.epoch === windowRestorations &&
                rediscoveredAt !== review.epoch
              ) {
                rediscoveredAt = review.epoch
                record({
                  stage: "restored-window-observed-by-model",
                  callID: part.id,
                  windowID: observed.id,
                  pid: observed.pid,
                })
              }
              if (saveReceipt && !savedWindow && exactName(observed?.title)) {
                savedWindow = true
                record({ stage: "saved-window-observed", callID: part.id, windowID: observed.id, pid: observed.pid })
              }
            }
            if (action === "snapshot" || action === "find") {
              const parent = refs.get(input.root)
              const surface = input.root ? parent?.surface : (input.surface ?? "window")
              const windowID = parent?.windowID ?? input.window_id
              const nodes = observedNodes(result.data, parent?.menu)
              const location = clean(nodes.find((ref) => ref.node.name === "Where:")?.node.value)
              const name = nodes.find((ref) => ref.node.name === "Save As:")?.node.value
              const correctDirectory = surface === "sheet" && windowID === initial.id && location === document.folder
              if (!selectedDirectory && correctDirectory) {
                selectedDirectory = true
                record({ stage: "destination-confirmed", callID: part.id })
              }
              const freshSheet =
                action === "snapshot" && correctDirectory && exactName(name) && rediscoveredAt === review.epoch
              const freshSave = freshSheet && nodes.find((ref) => isSaveButton(surface, ref.node))
              if (freshSave)
                record({
                  stage: "restored-sheet-observed-by-model",
                  callID: part.id,
                  windowID,
                  refID: freshSave.node.ref_id ?? freshSave.node.ref,
                })
              for (const ref of nodes)
                refs.set(ref.node.ref_id ?? ref.node.ref, {
                  ...ref,
                  surface,
                  windowID,
                  location,
                  name,
                  epoch: review.epoch,
                  freshSheet,
                })
            }
            if (review.finalSave) {
              assert.equal(key, saveApproved)
              assert.equal(saveReceipt, undefined, "Only one Save click may be delivered")
              saveReceipt = result.data.disposition?.delivery
              assert.ok(["delivered_unverified", "delivered_verified"].includes(saveReceipt))
              record({ stage: "save-click", callID: part.id, delivery: saveReceipt })
            }
          }
        }

        for (const request of requests) {
          const key = `${request.source?.messageID}/${request.source?.callID}`
          const call = calls.get(key)
          if (!call || call.state.status === "pending" || reviewed.has(key)) continue
          const action = desktopActions.get(request.action)
          assert.equal(request.action, call.name, "Permission request must belong to the observed call")
          const input = call.state.input
          const ref = refs.get(input.root ?? input.ref_id)
          const finalSave = action === "click" && isSaveButton(ref?.surface, ref?.node)
          assert.ok(
            isFixtureAction(action, input, ref, initial.id, document, exactName) &&
              !(saveApproved && mutations.has(action)),
            `Model requested an action outside the save fixture: ${action ?? request.action} (${ref?.surface ?? "unscoped"}/${ref?.node.role ?? "no ref"})`,
          )
          if (!["status", "permissions", "version", "skills_get", "list_apps"].includes(action))
            await ensureWindow(action, action === "click" && ["menubar", "menu"].includes(ref?.surface))
          if (options.switchSpace && !recovery && finalSave && ref.epoch === windowRestorations) {
            assert.ok(selectedDirectory && !saveApproved)
            assert.equal(requests.length, 1, "The pre-switch Save must be the sole pending permission request")
            await document.assertUnsaved()
            const spaces = await options.switchSpace(initial)
            await waitForTextEditWindow(
              () => ready(observeWindow()),
              "same TextEdit window is accessible after the Space switch",
              restoreWindow,
            )
            const pending = await client.permissions.list({ sessionID: session.id }, requestOptions())
            assert.deepEqual(
              pending.map((item) => item.id),
              [request.id],
              "The exact Save is still pending after restoration",
            )
            windowRestorations++
            recovery = { ...spaces, staleCall: key, staleRef: input.ref_id }
            record({ stage: "actual-space-switch", ...spaces, callID: call.id, refID: input.ref_id })
            await document.assertUnsaved()
          }
          const stale = ref && ref.epoch !== windowRestorations
          const reply = stale ? "reject" : "once"
          if (recovery && mutations.has(action) && !stale) {
            assert.ok(recovery.rejected, "The held Save must reach its rejected terminal state before another mutation")
            assert.equal(rediscoveredAt, windowRestorations, "The model must list the restored TextEdit window")
          }
          if (finalSave && !stale) {
            await document.assertUnsaved()
            if (recovery) {
              assert.ok(ref.freshSheet, "The model must observe the exact Save sheet after listing the restored window")
              assert.notEqual(key, recovery.staleCall)
              assert.notEqual(input.ref_id, recovery.staleRef, "Save must use a newly issued ref")
            }
          }
          if (stale && lastReportedRestoration !== windowRestorations) {
            // A denied tool receipt does not tell the model why the operator declined it.
            await fixture.prompt(
              session.id,
              "I brought the same TextEdit window back into view. Discard the earlier refs. Continue the original Save task by listing TextEdit windows and observing the same document's current surface again before taking another action.",
              false,
            )
            lastReportedRestoration = windowRestorations
            record({ stage: "operator-reported-restoration" })
          }
          await client.permissions.reply(
            {
              sessionID: session.id,
              requestID: request.id,
              reply,
              ...(stale && {
                message: "TextEdit changed visibility. Observe the same window again to get a fresh ref.",
              }),
            },
            requestOptions(),
          )
          reviewed.set(key, { reply, epoch: windowRestorations, finalSave: finalSave && !stale })
          record({
            stage: stale ? "rejected-stale-ref" : "approved-once",
            action,
            callID: call.id,
            requestID: request.id,
            refID: input.ref_id,
          })
          if (finalSave && !stale) {
            saveApproved = key
            if (recovery) record({ stage: "fresh-save-approved-after-recovery", callID: call.id, refID: input.ref_id })
          }
        }

        if (savedWindow && !readback) {
          await document.verify()
          readback = true
          record({ stage: "independent-readback" })
        }
        const assistant = assistants.at(-1)
        if (!active && assistant?.time.completed && requests.length === 0) {
          await client.sessions.wait({ sessionID: session.id }, requestOptions())
          assert.equal(
            history.filter((message) => message.type === "user" && message.text?.trimEnd() === task).length,
            1,
            "The original prompt must be admitted exactly once",
          )
          return assistant
        }
        await Bun.sleep(250)
        return undefined
      },
      "live model selects, saves and settles",
      480_000,
    )
    settled = true
    const approvals = [...reviewed.values()].filter((review) => review.reply === "once").length
    assert.equal(last.error, undefined, "The real model must finish without a provider error")
    assert.equal(last.finish, "stop", "The real model must finish the Save task normally")
    if (options.switchSpace)
      assert.ok(recovery?.rejected, "The controlled Space switch and stale Save rejection must be exercised")
    assert.ok(skillLoaded && approvals > 0, "The model must load the released Skill and use the ask profile")
    assert.ok(
      selectedDirectory && saveReceipt && savedWindow && readback,
      "Missing proof of directory selection, Save, the saved window name, or independent readback",
    )
    record({ stage: "model-settled" })
    const result = {
      run,
      model: "xai/grok-4.7",
      approvals,
      selectedDirectory,
      savedWindow,
      exactReadback: true,
      windowRestorations,
      ...(recovery && { spaceRecovery: recovery }),
      elapsedMs: events.at(-1).elapsedMs,
    }
    console.log(JSON.stringify(result))
    return result
  } catch (error) {
    record({ stage: "failure", message: error.message })
    const transcript = await client.messages
      .list({ sessionID: session.id, order: "asc", limit: 150 }, requestOptions())
      .catch(() => undefined)
    if (transcript)
      await writeFile(join(runtime.output, `live-save-${run}-failure.json`), JSON.stringify(transcript.data, null, 2), {
        mode: 0o600,
      })
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
      document?.close(),
      inputSurface?.close(),
    ])
  }
}

function isSaveButton(surface, node) {
  return surface === "sheet" && node?.role === "button" && clean(node.name) === "Save"
}

function isFixtureAction(action, input, ref, windowID, document, exactName) {
  if (["status", "permissions", "version", "skills_get"].includes(action)) return true
  const app = input.app === "TextEdit" || input.app === "com.apple.TextEdit"
  if (input.app && !app) return false
  if (input.window_id && input.window_id !== windowID) return false
  if (action === "screenshot") return app && input.window_id === windowID && !input.output_path
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
  if (ref.surface === "window")
    return (
      ref.node.role === "textfield" && typeof ref.node.value === "string" && ref.node.value.startsWith(document.marker)
    )
  if (ref.node.role === "menuitem") {
    if (ref.surface === "menubar" && name === "File") return true
    if (ref.menu === "Window" && name === document.title) return true
    return (ref.menu === "File" || ref.surface === "menu") && /^Save[.…]*$/.test(name)
  }
  if (ref.surface !== "sheet" || ref.windowID !== windowID) return false
  if (name === "Save As:") return ref.node.role === "textfield"
  if (name === "Cancel") return ref.node.role === "button"
  if (name === "Save") return ref.node.role === "button" && ref.location === document.folder && exactName(ref.name)
  return ["Downloads", "show more options", document.folder].includes(name) || clean(ref.node.value) === document.folder
}

function observedNodes(value, parentMenu) {
  if (!value || typeof value !== "object") return []
  const menu =
    ["File", "Window"].includes(value.name) && ["menu", "menuitem"].includes(value.role) ? value.name : parentMenu
  return [
    ...(value.ref_id || value.ref ? [{ node: value, menu }] : []),
    ...Object.values(value).flatMap((child) => observedNodes(child, menu)),
  ]
}

function toolReceipt(part) {
  const text = part.state.content?.find((item) => item.type === "text")?.text ?? part.state.error?.message
  if (!text?.startsWith("{")) return undefined
  // Legacy tool output may be truncated. Only complete JSON proves delivery or observation.
  try {
    return JSON.parse(text)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

function requestOptions() {
  return { signal: AbortSignal.timeout(10_000) }
}
