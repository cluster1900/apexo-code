import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { toolName } from "../../../plugins/computer-use/script/build.mjs"
import { startComputerUseFixture } from "./computer-use-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"

assert.equal(process.platform, "darwin")
const worker = process.argv[2] === "--worker"
const resume = process.argv[2] === "--resume"
const output = worker || resume ? process.argv[3] : await mkdtemp(join(tmpdir(), "apexo-computer-permissions-"))
const control = join(output, "control.json")
const result = join(output, "result.json")

if (!worker) {
  const app = join(output, "Apexo CLI Permission Test.app")
  const id = resume
    ? (await Bun.file(join(output, "host.json")).json()).id
    : `com.apexolab.computer-use.cli-permissions.${randomUUID().replaceAll("-", "")}`
  if (!resume) {
    await mkdir(join(app, "Contents/MacOS"), { recursive: true })
    await mkdir(join(app, "Contents/Resources"))
    const host = join(output, "host.swift")
    await writeFile(
      host,
      `import AppKit
struct Launch: Decodable { let executable: String; let arguments: [String]; let directory: String }
final class Delegate: NSObject, NSApplicationDelegate {
  let child = Process()
  func applicationDidFinishLaunching(_ notification: Notification) {
    do {
      let config = try JSONDecoder().decode(Launch.self, from: Data(contentsOf: Bundle.main.url(forResource: "launch", withExtension: "json")!))
      child.executableURL = URL(fileURLWithPath: config.executable)
      child.arguments = config.arguments
      child.currentDirectoryURL = URL(fileURLWithPath: config.directory)
      child.standardOutput = FileHandle.standardOutput
      child.standardError = FileHandle.standardError
      child.terminationHandler = { _ in DispatchQueue.main.async { NSApp.terminate(nil) } }
      try child.run()
    } catch { fputs("Permission test host failed: \\(error)\\n", stderr); NSApp.terminate(nil) }
  }
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if child.isRunning { child.terminate() }
    return .terminateNow
  }
}
let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
`,
    )
    await writeFile(
      join(app, "Contents/Resources/launch.json"),
      JSON.stringify({
        executable: process.execPath,
        arguments: [fileURLToPath(import.meta.url), "--worker", output],
        directory: process.cwd(),
      }),
    )
    await writeFile(
      join(app, "Contents/Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleExecutable</key><string>PermissionHost</string><key>CFBundleName</key><string>Apexo CLI Permission Test</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`,
    )
    const compile = Bun.spawn(["/usr/bin/xcrun", "swiftc", host, "-o", join(app, "Contents/MacOS/PermissionHost")], {
      stdout: "inherit",
      stderr: "inherit",
    })
    assert.equal(await compile.exited, 0)
    const signed = Bun.spawnSync(["/usr/bin/codesign", "--force", "--sign", "-", "--identifier", id, app])
    assert.equal(signed.exitCode, 0, signed.stderr.toString())
    await writeJson(join(output, "host.json"), { app, id })
    const opened = Bun.spawnSync([
      "/usr/bin/open",
      "-n",
      "-a",
      app,
      "--stdout",
      join(output, "worker.stdout"),
      "--stderr",
      join(output, "worker.stderr"),
    ])
    assert.equal(opened.exitCode, 0, opened.stderr.toString())
  }
  await poll(() => Bun.file(result).exists(), "independent CLI permission host", 45_000)
  console.log(JSON.stringify({ app, id, output, state: await Bun.file(result).json() }))
  console.log("Enter denied, guide, ax-only, granted, or finish. Change only this test host's OS grants manually.")
  for await (const line of createInterface({ input: process.stdin })) {
    const action = line.trim()
    if (!["denied", "guide", "ax-only", "granted", "finish"].includes(action)) continue
    const command = { id: randomUUID(), action }
    await writeJson(control, command)
    const completed = await poll(
      async () => {
        const value = await Bun.file(result).json()
        return value.command === command.id && value
      },
      `permission phase ${action}`,
      90_000,
    )
    console.log(JSON.stringify({ ...completed, records: undefined }))
    if (action === "finish") break
  }
  process.stdin.destroy()
  process.exit(0)
}

const fixture = await startComputerUseFixture("cli")
const records = (await Bun.file(result).exists()) ? ((await Bun.file(result).json()).records ?? []) : []
const filename = `Permission fixture ${randomUUID().slice(0, 8)}.txt`
const file = join(fixture.runtime.directory, filename)
await writeFile(file, "Apexo isolated permission fixture.\n")
const call = async (name, args = {}) => {
  const session = await fixture.session()
  fixture.state.steps.push({ tool: toolName(name), args })
  await fixture.prompt(session.id, `Run ${name} against the owned permission fixture.`)
  const messages = (await fixture.client.messages.list({ sessionID: session.id, order: "asc" })).data
  const part = messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .find((part) => part.type === "tool" && part.name === toolName(name))
  assert.ok(part)
  const content = part.state.content ?? []
  const text = content.find((item) => item.type === "text")?.text ?? part.state.error?.message
  const envelope = text?.startsWith("{") ? JSON.parse(text) : undefined
  const data = envelope?.data
  const images = content
    .filter((item) => item.type === "file" && item.mime === "image/png")
    .map((item) => Buffer.from(item.uri.slice(item.uri.indexOf(",") + 1), "base64"))
  assert.ok(images.every((image) => image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))))
  const record = {
    name,
    status: part.state.status,
    ok: envelope?.ok,
    permissions: name === "desktop_permissions" ? data : undefined,
    error: envelope?.error,
    hasFixture: name === "desktop_snapshot" && text?.includes("Apexo isolated permission fixture."),
    imageBytes: images.map((image) => image.length),
  }
  records.push(record)
  return { record, data }
}
const save = async (value) => {
  const state = { ...value, workerPID: process.pid, records }
  if (value.command) await writeJson(join(output, `phase-${value.command}.json`), state)
  await writeJson(result, state)
}
const closed = { value: false }
const close = async () => {
  if (closed.value) return
  closed.value = true
  await fixture.runtime.close()
}
process.on("SIGTERM", () => void close().finally(() => process.exit(0)))
process.on("SIGINT", () => void close().finally(() => process.exit(0)))
try {
  await fixture.install()
  const initial = await call("desktop_permissions")
  await save({ ready: true, permissions: initial.data })
  // A restarted host requires a new explicit command; it never replays the previous phase.
  const last = { id: (await Bun.file(control).exists()) ? (await Bun.file(control).json()).id : "" }
  while (!closed.value) {
    const command = await poll(
      async () => {
        if (!(await Bun.file(control).exists())) return
        const command = await Bun.file(control).json()
        return command.id !== last.id && command
      },
      "manual permission phase",
      30 * 60_000,
    )
    last.id = command.id
    if (command.action === "finish") {
      await save({ command: command.id, phase: command.action, passed: true })
      break
    }
    const phase = records.length
    const outcome = await (async () => {
      if (command.action === "guide") {
        await call("desktop_permissions", { guide: true })
        return
      }
      assert.equal(Bun.spawnSync(["/usr/bin/open", "-a", "TextEdit", file]).exitCode, 0)
      const permissions = await call("desktop_permissions")
      assert.equal(permissions.data.accessibility.state, command.action === "denied" ? "denied" : "granted")
      assert.equal(permissions.data.screen_recording.state, command.action === "granted" ? "granted" : "denied")
      const windows = await call("desktop_list_windows", { app: "TextEdit" })
      const window = windows.data?.find((window) => window.title === filename)
      const snapshot = await call("desktop_snapshot", {
        app: "TextEdit",
        ...(window ? { window_id: window.id } : {}),
        compact: true,
      })
      const screenshot = await call("desktop_screenshot", {
        app: "TextEdit",
        ...(window ? { window_id: window.id } : {}),
      })
      if (command.action === "denied") {
        assert.equal(snapshot.record.error?.code, "PERM_DENIED")
        assert.equal(screenshot.record.error?.code, "PERM_DENIED")
        return
      }
      assert.equal(snapshot.record.hasFixture, true)
      if (command.action === "ax-only") {
        assert.equal(screenshot.record.error?.code, "PERM_DENIED")
        assert.match(screenshot.record.error.message, /Screen Recording/)
        return
      }
      assert.equal(screenshot.record.status, "completed")
      assert.ok(screenshot.record.imageBytes[0] > 0)
    })().then(
      () => ({ passed: true }),
      (error) => ({ passed: false, failure: String(error) }),
    )
    await save({ command: command.id, phase: command.action, ...outcome, phaseRecords: records.slice(phase) })
  }
} finally {
  await close()
}

async function writeJson(path, value) {
  const pending = `${path}.${randomUUID()}.pending`
  await writeFile(pending, JSON.stringify(value, null, 2))
  await rename(pending, path)
}
