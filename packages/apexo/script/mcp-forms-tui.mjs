import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startMcpFormsFixture } from "./mcp-forms-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"
const fixture = await startMcpFormsFixture()
const { runtime, repo, session } = fixture
const fullscreen = process.argv.includes("--fullscreen")
const terminal = new Terminal({ cols: 100, rows: 35, allowProposedApi: true })
const plain = () =>
  Array.from({ length: 35 }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const screen = []
let child
const checks = []
const tools = async (id = session.id) =>
  (await runtime.api(`/api/session/${id}/message?order=asc`)).data.flatMap((message) =>
    message.type === "assistant" ? message.content.filter((item) => item.type === "tool") : [],
  )
try {
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      join(repo, "packages/apexo/src/index.ts"),
      "attach",
      runtime.url,
      ...(!fullscreen ? ["--mini", "--no-replay"] : []),
      "--dir",
      runtime.directory,
      "--session",
      session.id,
    ],
    {
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: 100,
        rows: 35,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.push(text)
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "composer ready", 30000)
  for (const action of ["accept", "decline", "cancel"]) {
    const before = (await tools()).length
    await fixture.prompt(session.id)
    await fixture.pending(session.id)
    await poll(
      () => plain().includes("Input requested by forms") && plain().includes("sample"),
      "typed form ready",
      30000,
    )
    assert.ok(!plain().includes("Sending response"))
    checks.push(`${action}-default-visible-no-autosubmit`)
    if (action === "accept") {
      // Edit a required string to invalid empty, navigate to review, and explicitly submit.
      child.terminal.write("\x7f".repeat(6))
      await poll(() => !plain().includes("sample"), "default edited")
      for (let i = 0; i < 6; i++) {
        child.terminal.write("\t")
        await poll(() => plain().includes(i === 5 ? "Review answers" : `Field ${i + 2} /`), "next field")
      }
      child.terminal.write("\r")
      await poll(() => plain().includes("Check the requested field constraints"), "inline validation")
      assert.equal((await runtime.api(`/api/session/${session.id}/mcp/elicitation`)).length, 1)
      child.terminal.write("\x1b[200~terminal\x1b[201~")
      await poll(() => plain().includes("terminal"), "required string corrected")
      for (let i = 0; i < 6; i++) {
        child.terminal.write("\t")
        await poll(() => plain().includes(i === 5 ? "Review answers" : `Field ${i + 2} /`), "review corrected values")
        if (i === 0 || i === 1) {
          child.terminal.write("\x7f".repeat(i === 0 ? 1 : 3))
          child.terminal.write(`\x1b[200~${i === 0 ? "4" : "0.75"}\x1b[201~`)
          await poll(() => plain().includes(i === 0 ? "4" : "0.75"), "numeric editor updated")
        }
        if (i === 2) {
          child.terminal.write(" ")
          await poll(() => plain().includes("[x] true"), "boolean toggled")
        }
        if (i === 3 || i === 4) {
          child.terminal.write("\x1b[B")
          await poll(() => plain().includes(i === 3 ? "> [ ] Production" : "> [ ] B"), "enum option selected")
          child.terminal.write(" ")
          await poll(() => plain().includes(i === 3 ? "> [x] Production" : "> [x] B"), "enum option applied")
        }
      }
      child.terminal.write("\r")
    }
    if (action === "decline") child.terminal.write("\x04")
    if (action === "cancel") child.terminal.write("\x1b[27u")
    const result = await poll(
      async () => {
        const result = (await tools())[before]
        return result?.state.status === "completed" ? result : undefined
      },
      "tool completed",
      20000,
    )
    const output = JSON.parse(result.state.content.find((item) => item.type === "text").text)
    assert.equal(output.replies[0].action, action)
    if (action === "accept")
      assert.deepEqual(output.replies[0].content, {
        name: "terminal",
        quantity: 4,
        ratio: 0.75,
        confirm: true,
        environment: "prod",
        regions: ["a", "b"],
      })
    await poll(() => !plain().includes("Input requested by forms"), "form dock closed")
    checks.push(`${action}-exact-wire-result`)
  }
  for (const scenario of ["F04_DIRECT", "F04_NESTED", "F04_SPECIAL", "F04_SPECIAL_EDIT"]) {
    await fixture.prompt(session.id, undefined, scenario)
    const pending = await fixture.pending(session.id)
    const special = scenario.includes("SPECIAL")
    if (!special) {
      assert.notEqual(pending.sessionID, session.id)
      assert.deepEqual(await runtime.api(`/api/session/${session.id}/mcp/elicitation`), [])
      const owner = (await runtime.api(`/api/session/${pending.sessionID}`)).data
      if (scenario === "F04_DIRECT") assert.equal(owner.parentID, session.id)
      if (scenario === "F04_NESTED") {
        assert.notEqual(owner.parentID, session.id)
        assert.equal((await runtime.api(`/api/session/${owner.parentID}`)).data.parentID, session.id)
      }
    }
    await poll(
      () => plain().includes("Input requested by forms") && plain().includes(special ? "Optional number" : "sample"),
      "descendant or special-name form",
      30000,
    )
    const count = special ? 4 : 6
    if (special) assert.ok(!plain().includes("function"))
    for (let i = 0; i < count; i++) {
      if (scenario === "F04_SPECIAL_EDIT" && i < 2) {
        child.terminal.write(`\x1b[200~${i === 0 ? "2.5" : "chosen"}\x1b[201~`)
        await poll(() => plain().includes(i === 0 ? "2.5" : "chosen"), "prototype-named input edited")
      }
      if (scenario === "F04_SPECIAL_EDIT" && i === 3) {
        child.terminal.write(" ")
        await poll(() => plain().includes("> [x] a"), "optional choice updates after first selection")
      }
      child.terminal.write("\t")
      await poll(
        () => plain().includes(i === count - 1 ? "Review answers" : `Field ${i + 2} /`),
        "review descendant or special fields",
      )
    }
    child.terminal.write("\r")
    const result = await poll(
      async () => {
        const part = (await tools(pending.sessionID)).find((part) => part.id === pending.toolCallID)
        return part?.state.status === "completed" ? part : undefined
      },
      "owned descendant tool completed",
      20000,
    )
    const output = JSON.parse(result.state.content.find((part) => part.type === "text").text)
    assert.equal(output.replies[0].action, "accept")
    assert.deepEqual(
      output.replies[0].content,
      special
        ? {
            hasOwnProperty: false,
            ...(scenario.endsWith("EDIT") ? { toString: 2.5, valueOf: "chosen", isPrototypeOf: "a" } : {}),
          }
        : { name: "sample", quantity: 2, ratio: 0.5, confirm: false, environment: "dev", regions: ["a"] },
    )
    await poll(() => !plain().includes("Input requested by forms"), "descendant form dock closed")
    checks.push(`${scenario}-owned-typed-reply`)
  }
  console.log(JSON.stringify({ mode: fullscreen ? "fullscreen" : "mini", checks, output: runtime.output }))
} finally {
  await writeFile(join(runtime.output, "forms-final.txt"), plain())
  await writeFile(join(runtime.output, "forms.ansi"), screen.join(""))
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "form PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  terminal.dispose()
  await fixture.close()
  console.error(`Form terminal evidence: ${runtime.output}`)
}
