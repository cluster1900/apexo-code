import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { deadline, poll } from "./grok-shell-fixture.mjs"

export async function prepareSaveSpaceSwitch(output) {
  const contents = join(output, "Apexo Save Space.app/Contents")
  const executable = join(contents, "MacOS/space-target")
  await mkdir(join(contents, "MacOS"), { recursive: true })
  await Bun.write(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>space-target</string>
<key>CFBundleIdentifier</key><string>com.apexolab.qa.save-space</string>
<key>CFBundleName</key><string>Apexo Save Space</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`,
  )
  const build = Bun.spawnSync(
    ["/usr/bin/xcrun", "swiftc", join(import.meta.dir, "computer-use-save-space.swift"), "-o", executable],
    { timeout: 45_000 },
  )
  assert.equal(build.exitCode, 0, build.stderr.toString())

  return async (window, present) => {
    const windowNumber = Number(/^w-(\d+)$/.exec(window.id)?.[1])
    assert.ok(Number.isSafeInteger(windowNumber) && windowNumber > 0)
    assert.ok(Number.isSafeInteger(window.pid) && window.pid > 0)
    const read = () => {
      const state = Bun.spawnSync([executable, "--probe", String(window.pid)], { timeout: 3000 })
      assert.equal(state.exitCode, 0, state.stderr.toString())
      const observed = JSON.parse(state.stdout.toString())
      assert.equal(observed.displays.length, 1, "Space recovery requires one Space-bearing display")
      return { display: observed.displays[0], visible: observed.onscreen.includes(windowNumber) }
    }
    const original = read()
    assert.ok(original.visible, "The exact TextEdit window must be on the initial Space")
    const target = Bun.spawn([executable], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    try {
      const away = await poll(
        () => {
          assert.equal(target.exitCode, null, "The owned full-screen Space app exited early")
          const state = read()
          return !state.visible && !original.display.spaces.includes(state.display.current) && state.display.current
        },
        "a new full-screen Space hides the original TextEdit window",
        15_000,
      )
      let nextActivation = 0
      await poll(
        () => {
          const state = read()
          if (state.visible && state.display.current === original.display.current) return true
          if (performance.now() >= nextActivation) {
            present()
            nextActivation = performance.now() + 2000
          }
          return false
        },
        "the original Space and TextEdit window return",
        15_000,
      )
      return {
        initialSpace: original.display.current,
        awaySpace: away,
        restoredSpace: original.display.current,
        windowID: window.id,
        pid: window.pid,
      }
    } finally {
      if (target.exitCode === null && target.signalCode === null) target.kill("SIGTERM")
      await deadline(target.exited, 5000, "owned full-screen Space app exit").catch(async () => {
        target.kill("SIGKILL")
        await target.exited
      })
    }
  }
}
