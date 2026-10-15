import assert from "node:assert/strict"
import { join, resolve } from "node:path"
import { startShellFixture, deadline } from "./grok-shell-fixture.mjs"

const fixture = await startShellFixture("cli", {
  deferBackend: true,
  next: ({ text }) => {
    if (text.includes("LOCAL_TEXT_BYTES")) {
      assert.ok(text.includes("document.txt"))
      assert.ok(!text.includes("data:text/plain"))
      return { content: "LOCAL_TEXT_VISIBLE" }
    }
    assert.ok(text.includes("data:image/png;base64,"), "canonical local attachment must reach provider")
    return { content: "LOCAL_IMAGE_VISIBLE" }
  },
})
const results = []
try {
  fixture.env.APEXO_DB = join(fixture.output, "headless-files.db")
  await Bun.write(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const fifo = join(fixture.directory, "special.pipe")
  const make = Bun.spawn(["mkfifo", fifo], { stdout: "pipe", stderr: "pipe" })
  assert.equal(await make.exited, 0, await new Response(make.stderr).text())
  const execute = async (label, file, text = "") => {
    const before = fixture.calls.length
    const child = Bun.spawn(
      [
        ...(process.env.APEXO_TEST_CLI_BIN
          ? [process.env.APEXO_TEST_CLI_BIN]
          : [process.execPath, resolve("src/index.ts")]),
        "run",
        "--session-protocol",
        "native",
        "--dir",
        fixture.directory,
        "--model",
        "xai/grok-4.7",
        "--file",
        file,
        "--format",
        "json",
        ...(text ? [text] : []),
      ],
      { env: fixture.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    )
    try {
      const [code, stdout, stderr] = await deadline(
        Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]),
        30000,
        label,
      )
      const result = { label, code, stdout, stderr, providerCalls: fixture.calls.length - before }
      results.push(result)
      return result
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL")
      await child.exited
    }
  }
  for (const [label, file] of [
    ["missing", "missing.png"],
    ["fifo", fifo],
    ["directory", fixture.directory],
  ]) {
    const result = await execute(label, file)
    assert.equal(result.code, 1, result.stdout + result.stderr)
    assert.equal(result.providerCalls, 0)
    assert.ok((result.stderr + result.stdout).includes(label === "missing" ? "ENOENT" : "special file"))
    assert.equal(await Bun.file(fixture.env.APEXO_DB).exists(), false, "invalid attachment must fail before local host")
  }
  const image = join(fixture.directory, "image.png")
  await Bun.write(
    image,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==",
      "base64",
    ),
  )
  for (const [label, text] of [
    ["image-with-text", "LOCAL_IMAGE_PROMPT"],
    ["image-only", ""],
  ]) {
    const result = await execute(label, image, text)
    assert.equal(result.code, 0, result.stderr + result.stdout)
    assert.equal(result.providerCalls, 1)
    const events = result.stdout.trim().split("\n").map(JSON.parse)
    assert.ok(events.some((event) => event.type === "text" && event.part.text === "LOCAL_IMAGE_VISIBLE"))
    assert.equal(events.find((event) => event.type === "input_execution").status, "completed")
  }
  const document = join(fixture.directory, "document.txt")
  await Bun.write(document, "LOCAL_TEXT_BYTES 世界\nexact content")
  for (const [label, text] of [
    ["text-with-prompt", "Read the file"],
    ["text-only", ""],
  ]) {
    const result = await execute(label, document, text)
    assert.equal(result.code, 0, result.stderr + result.stdout)
    assert.equal(result.providerCalls, 1)
    const events = result.stdout.trim().split("\n").map(JSON.parse)
    assert.ok(events.some((event) => event.type === "text" && event.part.text === "LOCAL_TEXT_VISIBLE"))
    assert.equal(events.find((event) => event.type === "input_execution").status, "completed")
  }
  await Bun.write(join(fixture.output, "headless-files.json"), JSON.stringify(results, null, 2))
  console.log(
    JSON.stringify({
      checks: results.length,
      providerCalls: fixture.calls.length,
      results: results.map(({ label, code, providerCalls }) => ({ label, code, providerCalls })),
    }),
  )
} finally {
  await fixture.close()
  console.error(`Headless local attachment evidence: ${fixture.output}`)
}
