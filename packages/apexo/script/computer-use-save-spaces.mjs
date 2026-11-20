import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { deadline, poll } from "./grok-shell-fixture.mjs"

export async function prepareSaveSpaces(output) {
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

  const identify = (window) => {
    const windowNumber = Number(/^w-(\d+)$/.exec(window.id)?.[1])
    assert.ok(Number.isSafeInteger(windowNumber) && windowNumber > 0)
    assert.ok(Number.isSafeInteger(window.pid) && window.pid > 0)
    return windowNumber
  }
  const observe = (window) => {
    const windowNumber = identify(window)
    const state = Bun.spawnSync([executable, "--probe", String(window.pid)], { timeout: 3000 })
    assert.equal(state.exitCode, 0, state.stderr.toString())
    const observed = JSON.parse(state.stdout.toString())
    assert.equal(observed.displays.length, 1, "Space recovery requires one Space-bearing display")
    return {
      space: observed.displays[0].current,
      spaces: observed.displays[0].spaces,
      windowExists: observed.windows.includes(windowNumber),
      onscreen: observed.onscreen.includes(windowNumber),
      foregroundApp: observed.foregroundApp,
    }
  }
  const restore = (window) => {
    const state = Bun.spawnSync([executable, "--restore", String(window.pid), String(identify(window))], {
      timeout: 3000,
    })
    assert.equal(state.exitCode, 0, state.stderr.toString() || "TextEdit window restoration helper failed")
    return state.stdout.toString().trim()
  }
  const switchSpace = async (window) => {
    const original = observe(window)
    assert.ok(original.onscreen, "The exact TextEdit window must be on the initial Space")
    const target = Bun.spawn([executable], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    const closeTarget = async () => {
      if (target.exitCode !== null || target.signalCode !== null) return
      target.kill("SIGTERM")
      await deadline(target.exited, 5000, "owned full-screen Space app exit").catch(async () => {
        target.kill("SIGKILL")
        await target.exited
      })
    }
    try {
      const away = await poll(
        () => {
          assert.equal(target.exitCode, null, "The owned full-screen Space app exited early")
          const state = observe(window)
          return state.windowExists && !state.onscreen && !original.spaces.includes(state.space) && state.space
        },
        "a new full-screen Space hides the original TextEdit window",
        15_000,
      )
      // Closing the fixture's full-screen app lets macOS dismiss its Space before we restore the document.
      await closeTarget()
      let nextActivation = 0
      await poll(
        () => {
          const state = observe(window)
          if (state.onscreen && state.space === original.space) return true
          if (performance.now() >= nextActivation) {
            restore(window)
            nextActivation = performance.now() + 2000
          }
          return false
        },
        "the original Space and TextEdit window return",
        15_000,
      )
      return {
        initialSpace: original.space,
        awaySpace: away,
        restoredSpace: original.space,
        windowID: window.id,
        pid: window.pid,
      }
    } finally {
      await closeTarget()
    }
  }
  return { observe, restore, switchSpace }
}
