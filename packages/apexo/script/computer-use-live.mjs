import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { randomInt } from "node:crypto"
import { join } from "node:path"
import { startComputerUseFixture } from "./computer-use-fixture.mjs"
import { runLiveTextEditSave } from "./computer-use-save-live.mjs"

const kind = process.argv[2] ?? "cli"
const scenario = process.argv[3] ?? "all"
assert.ok(["all", "textedit", "calculator", "vision", "scroll", "save-dialog", "smoke"].includes(scenario))
const runs = Number(process.argv[4] ?? 1)
assert.ok(
  Number.isSafeInteger(runs) && runs > 0 && (runs === 1 || scenario === "save-dialog"),
  "Invalid Save run count",
)
const fixture = await startComputerUseFixture(kind, { live: true, releasePermissions: scenario === "save-dialog" })
const checks = []
const { client, runtime } = fixture
const saves = []
try {
  await fixture.install()
  const model = (await client.models.list({ location: fixture.location })).data.find(
    (item) => item.id === "grok-4.7" && item.providerID === "xai",
  )
  assert.ok(model)
  if (scenario !== "save-dialog") {
    const session = await fixture.session()
    await fixture.prompt(
      session.id,
      "Load the computer-use:computer-use Skill. Call the installed desktop_version and desktop_permissions tools, then report their actual results. Do not use shell or write files.",
    )
    const history = (await client.messages.list({ sessionID: session.id, order: "asc" })).data
    const parts = history.flatMap((item) => (item.type === "assistant" ? item.content : []))
    assert.ok(
      parts.some(
        (part) => part.type === "tool" && part.name.includes("desktop_version") && part.state.status === "completed",
      ),
      "live xAI called the real plugin",
    )
    checks.push("live-xai-authentication-skill-and-native-tool-use")
    console.log(JSON.stringify({ stage: checks.at(-1) }))
  }
  if (scenario === "smoke") {
    const final = await client.sessions.create({
      location: fixture.location,
      agent: "response-check",
      model: { providerID: "xai", id: "grok-4.7", variant: "low" },
    })
    await fixture.prompt(final.id, "Reply with TOOLLESS_XAI_DONE. No tools are available.")
    const history = (await client.messages.list({ sessionID: final.id, order: "asc" })).data
    assert.ok(
      history.some(
        (message) =>
          message.type === "assistant" &&
          message.content.some((part) => part.type === "text" && part.text.includes("TOOLLESS_XAI_DONE")),
      ),
    )
    checks.push("live-xai-no-tool-final-turn-succeeds")
    console.log(JSON.stringify({ stage: checks.at(-1) }))
  }
  if (scenario === "scroll") {
    const filename = `Scroll fixture ${crypto.randomUUID().slice(0, 8)}.txt`
    const file = join(runtime.directory, filename)
    await writeFile(
      file,
      Array.from({ length: 180 }, (_, i) => `Fixture line ${i + 1}: scroll through this document.`).join("\n") +
        "\nSCROLL_FIXTURE_END\n",
    )
    assert.equal(Bun.spawnSync(["/usr/bin/open", "-a", "TextEdit", file]).exitCode, 0)
    const scroll = await fixture.session()
    await fixture.prompt(
      scroll.id,
      `Load the computer-use:computer-use Skill. In TextEdit, operate only the running document "${filename}". Find its scroll area from a current snapshot, use desktop_scroll to scroll down, then take a fresh observation and report the last visible fixture line. Do not edit or save the document, and do not use shell or filesystem tools.`,
    )
    const history = (await client.messages.list({ sessionID: scroll.id, order: "asc" })).data
    assert.ok(
      history
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .some(
          (part) => part.type === "tool" && part.name.includes("desktop_scroll") && part.state.status === "completed",
        ),
      "real scroll action completed",
    )
    checks.push("live-xai-scrolls-long-native-document")
    console.log(JSON.stringify({ stage: checks.at(-1) }))
  }
  if (scenario === "save-dialog") {
    for (let run = 1; run <= runs; run++) saves.push(await runLiveTextEditSave(fixture, run))
    checks.push("live-xai-native-save-dialog-new-document-text-match")
    console.log(JSON.stringify({ stage: checks.at(-1) }))
  }
  if (["all", "textedit"].includes(scenario)) {
    const filename = `Computer Use ${crypto.randomUUID().slice(0, 8)}.txt`
    const file = join(runtime.directory, filename)
    const initial = "Computer Use fixture. Replace this entire document.\n"
    const expected = `Apexo desktop test ${crypto.randomUUID().slice(0, 8)}\n中文输入，标点测试！\nSaved through the native UI.\n`
    await writeFile(file, initial)
    const open = Bun.spawnSync(["/usr/bin/open", "-a", "TextEdit", file])
    assert.equal(open.exitCode, 0, open.stderr.toString())
    const edit = await fixture.session()
    await fixture.prompt(
      edit.id,
      `Load the computer-use:computer-use Skill. In TextEdit, operate ONLY the uniquely named document "${filename}". Replace its complete content with the exact following text, including the final newline. Save using the native File menu if the document is marked edited; if autosave has already saved it and Save is disabled, verify the content and finish. desktop_press is intentionally denied. Use fresh refs and a narrow menubar snapshot; avoid broad find traversals of the whole menubar. Do not use shell or direct filesystem tools. Exact content:\n${expected}`,
    )
    assert.equal(await readFile(file, "utf8"), expected, "independent saved-file bytes")
    checks.push("live-xai-textedit-edit-unicode-newline-and-native-save")
    console.log(JSON.stringify({ stage: checks.at(-1) }))
  }
  if (["all", "calculator"].includes(scenario)) {
    const left = randomInt(101, 200)
    const right = randomInt(11, 90)
    assert.equal(Bun.spawnSync(["/usr/bin/open", "-a", "Calculator"]).exitCode, 0)
    const calculation = await fixture.session()
    await fixture.prompt(
      calculation.id,
      `Load the computer-use:computer-use Skill. Use only the installed desktop tools to calculate ${left} times ${right} in Calculator. Clear any previous calculation, observe before acting, click the native controls, verify the displayed result, and report it. Do not use shell. Use Calculator's Basic mode if necessary.`,
    )
    const calcMessages = (await client.messages.list({ sessionID: calculation.id, order: "asc" })).data
    const calcParts = calcMessages.flatMap((item) => (item.type === "assistant" ? item.content : []))
    assert.ok(
      calcParts.some(
        (part) =>
          part.type === "tool" &&
          part.state.status === "completed" &&
          JSON.stringify(part.state.content)
            .replaceAll(",", "")
            .includes(String(left * right)),
      ),
      "the randomized product appears in an actual completed observation",
    )
    checks.push("live-xai-calculator-observed-result")
    console.log(JSON.stringify({ stage: checks.at(-1) }))
  }
  if (["all", "vision"].includes(scenario)) {
    const colors = ["red", "green", "blue"].toSorted(() => randomInt(3) - 1)
    const imageName = `visual-${crypto.randomUUID().slice(0, 8)}.png`
    const image = join(runtime.directory, imageName)
    const draw = Bun.spawnSync([
      "/usr/bin/python3",
      "-c",
      "import sys,struct,zlib,binascii,json\nc={'red':(230,30,30),'green':(30,190,30),'blue':(30,50,230)}\na=json.loads(sys.argv[2]);w,h=600,200\ndef chunk(k,v):return struct.pack('!I',len(v))+k+v+struct.pack('!I',binascii.crc32(k+v)&0xffffffff)\nraw=b''.join(b'\\x00'+b''.join(bytes(c[a[x//200]]) for x in range(w)) for y in range(h))\nopen(sys.argv[1],'wb').write(b'\\x89PNG\\r\\n\\x1a\\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))",
      image,
      JSON.stringify(colors),
    ])
    assert.equal(draw.exitCode, 0, draw.stderr.toString())
    assert.equal(Bun.spawnSync(["/usr/bin/open", "-a", "Preview", image]).exitCode, 0)
    const vision = await fixture.session()
    await fixture.prompt(
      vision.id,
      `Load the computer-use:computer-use Skill. Locate Preview's ${imageName} window. Read its accessibility snapshot, then take an inline desktop_screenshot of that window without output_path. From the actual screenshot pixels, identify the three large vertical color blocks from left to right. Reply with a JSON array of the three lowercase English color names. Do not use shell, files, OCR tools, or any other source for the colors.`,
    )
    const visionHistory = (await client.messages.list({ sessionID: vision.id, order: "asc" })).data
    const visionParts = visionHistory.flatMap((item) => (item.type === "assistant" ? item.content : []))
    const answer = (visionHistory.filter((message) => message.type === "assistant").at(-1)?.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
    assert.ok(
      visionParts.some(
        (part) =>
          part.type === "tool" &&
          part.name.includes("desktop_screenshot") &&
          part.state.status === "completed" &&
          JSON.stringify(part.state).includes("image/png"),
      ),
      "actual screenshot image attachment",
    )
    assert.deepEqual(JSON.parse(answer.match(/\[\s*"(?:red|green|blue)"[\s\S]*?\]/)?.[0] ?? "null"), colors)
    checks.push("live-xai-vision-identifies-pixel-only-randomized-marker")
    console.log(JSON.stringify({ stage: checks.at(-1) }))
  }
  console.log(JSON.stringify({ kind, passed: checks.length, checks, saves, output: runtime.output }))
} finally {
  await writeFile(
    join(runtime.output, "live-result.json"),
    JSON.stringify({ kind, checks, scenario, model: "xai/grok-4.7", saves }, null, 2),
  )
  await runtime.close()
}
