import assert from "node:assert/strict"
import { mkdtemp, realpath, rm, rmdir } from "node:fs/promises"
import { basename, join } from "node:path"
import { poll } from "./grok-shell-fixture.mjs"

export async function prepareTextEditSave() {
  const downloads = await realpath(runScript("POSIX path of (path to downloads folder)"))
  const directory = await mkdtemp(join(downloads, "000-Apexo-save-fixture-"))
  const name = `ApexoSave-${crypto.randomUUID().slice(0, 8)}`
  const file = join(directory, `${name}.rtf`)
  const marker = `Apexo new document ${name}.`
  const expected = `${marker}\n中文保存测试！\n`
  let title
  try {
    title = runScript(`tell application "TextEdit"
set fixture to make new document with properties {text:${JSON.stringify(marker)} & linefeed & "中文保存测试！" & linefeed}
activate
return name of fixture
end tell`)
  } catch (error) {
    await rmdir(directory)
    throw error
  }
  return {
    title,
    marker,
    name,
    file,
    folder: basename(directory),
    present() {
      // Activating the running app avoids a reopen event while its Save sheet is up.
      runScript(
        `ObjC.import("AppKit")
const app = $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.apple.TextEdit").firstObject
if (app.isNil()) throw Error("TextEdit is not running")
app.unhide
app.activateWithOptions($.NSApplicationActivateIgnoringOtherApps)`,
        "JavaScript",
      )
    },
    async verify() {
      await poll(
        async () => {
          if (!(await Bun.file(file).exists())) return
          const read = Bun.spawnSync(["/usr/bin/textutil", "-convert", "txt", "-stdout", file], { timeout: 3000 })
          return read.exitCode === 0 && read.stdout.toString() === expected
        },
        "TextEdit saved an RTF at the selected destination with the exact fixture text",
        15_000,
      )
    },
    async close() {
      try {
        runScript(`tell application "TextEdit"
repeat with candidate in (documents whose name is ${JSON.stringify(title)} or name starts with ${JSON.stringify(name)})
if text of candidate starts with ${JSON.stringify(marker)} then
close candidate saving no
exit repeat
end if
end repeat
end tell`)
      } finally {
        await rm(file, { force: true })
        await rmdir(directory)
      }
    },
  }
}

function runScript(source, language = "AppleScript") {
  // A packaged Electron test may redirect Foundation's home without moving the system TextEdit app.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "CFFIXED_USER_HOME"))
  const child = Bun.spawnSync(["/usr/bin/osascript", "-l", language, "-e", source], { env, timeout: 15_000 })
  assert.equal(child.exitCode, 0, child.stderr.toString())
  return child.stdout.toString().trim()
}
