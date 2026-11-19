import assert from "node:assert/strict"
import { mkdtemp, realpath, rm, rmdir } from "node:fs/promises"
import { basename, join } from "node:path"

export async function prepareTextEditSave() {
  const downloads = await realpath(appleScript("POSIX path of (path to downloads folder)"))
  const directory = await mkdtemp(join(downloads, "000-Apexo-save-fixture-"))
  const name = `ApexoSave-${crypto.randomUUID().slice(0, 8)}`
  const file = join(directory, `${name}.rtf`)
  const marker = `Apexo new document ${name}.`
  const expected = `${marker}\n中文保存测试！\n`
  let title
  try {
    title = appleScript(`tell application "TextEdit"
activate
set fixture to make new document with properties {text:${JSON.stringify(marker)} & linefeed & "中文保存测试！" & linefeed}
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
    verify() {
      const read = Bun.spawnSync(["/usr/bin/textutil", "-convert", "txt", "-stdout", file])
      assert.equal(read.exitCode, 0, read.stderr.toString())
      assert.equal(read.stdout.toString(), expected, "TextEdit's saved file must contain the exact fixture text")
    },
    async close() {
      appleScript(`tell application "TextEdit"
repeat with candidate in (documents whose name is ${JSON.stringify(title)} or name starts with ${JSON.stringify(name)})
if text of candidate starts with ${JSON.stringify(marker)} then
close candidate saving no
exit repeat
end if
end repeat
end tell`)
      await rm(file, { force: true })
      await rmdir(directory)
    },
  }
}

function appleScript(source) {
  const child = Bun.spawnSync(["/usr/bin/osascript", "-e", source], { timeout: 15_000 })
  assert.equal(child.exitCode, 0, child.stderr.toString())
  return child.stdout.toString().trim()
}
