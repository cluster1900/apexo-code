// Exercises the Grok Build slash commands added to the TUI (context, history, effort, view-plan, doctor,
// tutorial, settings, plan, delete) in a real PTY against the fixture provider.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Terminal } from "@xterm/headless"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { autoReviewFixture, bashPrefixFixture, importedClaude, seedClaude, startGoalFixture } from "./grok-goal-fixture.mjs"

// --vim-config: start with config ui.vim_mode = true and check the config default plus the local override only.
const vimConfig = process.argv.includes("--vim-config")
// --context-window: the model lists several sizes; checks /context-window only.
const windowFlow = process.argv.includes("--context-window")
// --auto: bash asks for permission; checks Auto-review approves a safe command and escalates a risky one.
const autoFlow = process.argv.includes("--auto")
// --import-claude: a seeded ~/.claude; checks the import modal and the written config.
const importFlow = process.argv.includes("--import-claude")
// --edit-prompt: a scripted $EDITOR; checks /edit-prompt and the palette entry.
const editFlow = process.argv.includes("--edit-prompt")
// --mode-cycle: Shift+Tab cycles Normal → Plan → Auto → Always-approve like Grok Build.
const cycleFlow = process.argv.includes("--mode-cycle")
// --bash-prefix: bash asks; "Allow always" shows and saves the Grok Build scoped prefix, which then covers chained reuse.
const prefixFlow = process.argv.includes("--bash-prefix")
const { runtime } = await startGoalFixture(
  "cli",
  prefixFlow
    ? bashPrefixFixture
    : autoFlow || cycleFlow
    ? autoReviewFixture
    : vimConfig
      ? { config: { ui: { vim_mode: true } } }
      : windowFlow
        ? {
            models: {
              "grok-4.7": {
                name: "Restart parity",
                tool_call: true,
                limit: { context: 100000, output: 10000, context_options: [100000, 50000, 100] },
              },
            },
          }
        : {},
)
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const plain = () =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const rendered = (text, timeout) => poll(() => plain().includes(text), `render ${text}`, timeout)
const checks = []
let child
try {
  const model = { providerID: "xai", id: "grok-4.7" }
  const session = await runtime.api("/session", { title: "Slash verification", agent: "build", model })
  await runtime.api(`/session/${session.id}/message`, {
    agent: "build",
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "SLASH_HELLO first prompt" }],
  })
  if (editFlow) {
    const { chmod } = await import("node:fs/promises")
    const script = join(runtime.output, "editor.sh")
    await writeFile(script, `#!/bin/sh\nprintf '%s EDITED_TUI' "$(cat "$1")" > "$1"\n`)
    await chmod(script, 0o755)
  }
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      resolve("src/index.ts"),
      "attach",
      runtime.url,
      "--dir",
      runtime.directory,
      "--session",
      session.id,
    ],
    {
      env: {
        ...runtime.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        ...(editFlow ? { VISUAL: "", EDITOR: join(runtime.output, "editor.sh") } : {}),
      },
      terminal: {
        cols: 120,
        rows: 40,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await rendered("SLASH_HELLO", 30_000)
  const run = async (command) => {
    child.terminal.write(`\x1b[200~/${command}\x1b[201~`)
    await poll(() => plain().includes(`/${command}`), `typed /${command}`)
    // Without arguments Enter picks the autocomplete entry; with arguments the popup is already closed.
    await Bun.sleep(300)
    child.terminal.write("\r")
  }
  const escape = async () => {
    child.terminal.write("\x1b")
    await Bun.sleep(300)
  }

  if (cycleFlow) {
    // Asserts real state: the agent recorded on the sent message and what the permission layer actually does.
    const messages = async () => runtime.api(`/session/${session.id}/message`)
    const pending = async () => runtime.api(`/permission`)
    const completed = async (marker) =>
      (await messages()).flatMap((item) => item.parts).filter(
        (part) => part.type === "tool" && part.state.status === "completed" && JSON.stringify(part.state.input).includes(marker),
      ).length
    const idle = () => poll(async () => (await messages()).at(-1)?.info.time?.completed, "turn finished", 30_000)
    const prompt = async (text) => {
      child.terminal.write(`\x1b[200~${text}\x1b[201~`)
      await rendered(text)
      await Bun.sleep(200)
      child.terminal.write("\r")
      await poll(async () => (await messages()).some((item) => item.info.role === "user" && JSON.stringify(item.parts).includes(text)), `${text} sent`)
    }
    const agentOf = async (text) =>
      (await messages()).find((item) => item.info.role === "user" && JSON.stringify(item.parts).includes(text))?.info.agent
    const shiftTab = async () => {
      child.terminal.write("\x1b[Z")
      await Bun.sleep(600)
    }
    await shiftTab()
    await prompt("PLAN_MARK")
    assert.equal(await agentOf("PLAN_MARK"), "plan", "Plan-mode prompt carries the plan agent")
    await idle()
    checks.push("shift-tab-plan-prompt-uses-plan-agent")
    await shiftTab()
    const safe = await completed("git status")
    await prompt("AUTO_SAFE one")
    assert.equal(await agentOf("AUTO_SAFE one"), "build", "leaving Plan restores the previous agent")
    await poll(async () => (await completed("git status")) > safe, "auto mode auto-approves safe command", 30_000)
    await idle()
    checks.push("shift-tab-auto-review-approves-safe-and-restores-agent")
    await shiftTab()
    await prompt("AUTO_RISKY one")
    await poll(async () => (await completed("rm -rf auto-risky-dir")) > 0, "always-approve runs risky command", 30_000)
    assert.equal((await pending()).length, 0)
    await idle()
    checks.push("shift-tab-always-approve-runs-risky-without-prompt")
    await shiftTab()
    await prompt("AUTO_SAFE two")
    await poll(async () => (await pending()).length > 0, "normal mode asks again", 30_000)
    checks.push("shift-tab-normal-asks-again")
    for (const item of await pending()) await runtime.api(`/permission/${item.id}/reply`, { reply: "reject" })
    await idle()
    await Bun.sleep(500)
    child.terminal.write("\x0f")
    await Bun.sleep(600)
    await prompt("AUTO_RISKY two")
    await poll(async () => (await completed("rm -rf auto-risky-dir")) > 1, "ctrl+o always-approve", 30_000)
    await idle()
    checks.push("ctrl-o-enables-always-approve")
    child.terminal.write("\t")
    await Bun.sleep(600)
    await prompt("TAB_MARK")
    assert.equal(await agentOf("TAB_MARK"), "plan", "Tab still cycles agents")
    checks.push("tab-still-cycles-agents")
    console.log(JSON.stringify({ checks, output: runtime.output }, null, 2))
  } else if (editFlow) {
    child.terminal.write("DRAFT_TUI")
    await rendered("DRAFT_TUI")
    child.terminal.write("\x10")
    await rendered("Commands")
    child.terminal.write("Open editor")
    await Bun.sleep(400)
    child.terminal.write("\r")
    await rendered("DRAFT_TUI EDITED_TUI", 15_000)
    checks.push("palette-entry-edits-draft-in-editor")
    for (let index = 0; index < 25; index++) child.terminal.write("\x7f")
    await poll(() => !plain().includes("EDITED_TUI"), "draft cleared")
    await run("edit-prompt")
    await poll(() => plain().includes(" EDITED_TUI") && !plain().includes("DRAFT_TUI"), "slash opens editor", 15_000)
    checks.push("slash-opens-editor-and-saving-replaces-draft")
    console.log(JSON.stringify({ checks, output: runtime.output }, null, 2))
  } else if (importFlow) {
    await seedClaude(runtime)
    await run("import-claude")
    await rendered("Import Claude settings")
    for (const text of ["Permissions (4)", "Environment variables (1)", "MCP servers (1)", "Hooks (1)", "Rule paths"])
      await rendered(text)
    checks.push("modal-lists-claude-sections")
    // Untick hooks (4th row), then import the rest.
    for (let index = 0; index < 3; index++) child.terminal.write("\x1b[B")
    child.terminal.write("\r")
    await rendered("[ ] Hooks")
    await rendered("Import 4 selected")
    checks.push("sections-toggle")
    for (let index = 0; index < 2; index++) child.terminal.write("\x1b[B")
    child.terminal.write("\r")
    await rendered("Imported Claude settings", 20_000)
    const imported = await poll(async () => {
      const value = await importedClaude(runtime)
      return Object.values(value).every(Boolean) && value
    }, "config written")
    assert.ok(imported)
    checks.push("chosen-sections-written-to-global-config")
    const { existsSync } = await import("node:fs")
    assert.ok(!existsSync(join(runtime.env.APEXO_TEST_HOME, ".grok", "hooks", "claude-import.json")))
    checks.push("unticked-hooks-not-imported")
    console.log(JSON.stringify({ checks, output: runtime.output }, null, 2))
  } else if (prefixFlow) {
    const pending = async () => runtime.api(`/permission`)
    const prompt = async (text) => {
      child.terminal.write(`\x1b[200~${text}\x1b[201~`)
      await rendered(text)
      await Bun.sleep(200)
      child.terminal.write("\r")
    }
    const ran = async (command) =>
      (await runtime.api(`/session/${session.id}/message`)).some((item) =>
        item.parts.some(
          (part) => part.type === "tool" && part.state.status === "completed" && part.state.input?.command === command,
        ),
      )
    const asked = async (command) => (await pending()).find((item) => item.metadata?.command === command || item.patterns?.includes(command))
    const alwaysViaPrompt = async (command, expected) => {
      await poll(() => asked(command), `asks for ${command}`, 30_000)
      const request = await asked(command)
      assert.deepEqual(request.always, expected, `always scope for ${command}`)
      await rendered("Permission required")
      child.terminal.write("\x1b[C")
      await Bun.sleep(200)
      child.terminal.write("\r")
      await rendered("Always allow")
      for (const pattern of expected) await rendered("- " + pattern)
      child.terminal.write("\r")
      await poll(() => ran(command), `${command} ran`, 30_000)
    }
    await prompt("PREFIX_FIRST")
    await alwaysViaPrompt("git status", ["git status *"])
    checks.push("prompt-shows-arity-prefix:git status *")
    await prompt("PREFIX_AGAIN")
    await poll(() => ran("cd . && git status --short"), "chained reuse ran without a prompt", 30_000)
    checks.push("saved-prefix-covers-cd-chain-and-flags")
    await prompt("PREFIX_OTHER")
    await poll(() => asked("git log -1 --oneline"), "other subcommand still asks", 30_000)
    assert.deepEqual((await asked("git log -1 --oneline")).always, ["git log *"])
    checks.push("other-subcommand-still-asks")
    for (const item of await pending()) await runtime.api(`/permission/${item.id}/reply`, { reply: "reject" })
    await poll(async () => (await pending()).length === 0, "rejected")
    await Bun.sleep(800)
    await prompt("PREFIX_RM")
    await alwaysViaPrompt("rm -rf prefix-flow-dir", ["rm -rf prefix-flow-dir"])
    checks.push("dangerous-command-pinned-to-exact")
    await prompt("PREFIX_RM_AGAIN")
    await poll(() => asked("rm -rf prefix-flow-other"), "different rm still asks", 30_000)
    checks.push("different-rm-still-asks")
    for (const item of await pending()) await runtime.api(`/permission/${item.id}/reply`, { reply: "reject" })
    console.log(JSON.stringify({ checks, output: runtime.output }, null, 2))
  } else if (autoFlow) {
    const pending = async () => runtime.api(`/permission`)
    const prompt = async (text) => {
      child.terminal.write(`\x1b[200~${text}\x1b[201~`)
      await rendered(text)
      await Bun.sleep(200)
      child.terminal.write("\r")
    }
    const tool = async (marker) =>
      (await runtime.api(`/session/${session.id}/message`)).some((item) =>
        item.parts.some(
          (part) =>
            part.type === "tool" &&
            part.state.status === "completed" &&
            JSON.stringify(part.state.input).includes(marker),
        ),
      )
    await run("auto")
    await rendered("Auto-review on")
    await rendered("auto ·")
    checks.push("auto-toggles-review-mode-and-status")
    await prompt("AUTO_SAFE")
    await poll(() => tool("git status"), "safe command ran without a prompt", 30_000)
    checks.push("safe-command-auto-approved")
    await prompt("AUTO_RISKY")
    await poll(async () => (await pending()).some((item) => item.metadata?.command?.includes("rm -rf")), "risky asks")
    await rendered("rm -rf")
    checks.push("risky-command-escalates-to-prompt")
    child.terminal.write("\x1b")
    await Bun.sleep(300)
    for (const item of await pending()) await runtime.api(`/permission/${item.id}/reply`, { reply: "reject" })
    assert.equal(autoReviewFixture.classified.length, 0, "rules decided safe/risky without the model")
    await prompt("AUTO_MODEL_ALLOW")
    await poll(() => tool("terraform plan"), "model-approved command ran", 30_000)
    assert.ok(autoReviewFixture.classified.some((item) => item.includes("terraform plan")))
    checks.push("model-classifier-approves-unknown-safe-command")
    await prompt("AUTO_MODEL_ASK")
    await poll(async () => (await pending()).some((item) => item.metadata?.command?.includes("terraform apply")), "model escalates")
    await Bun.sleep(1500)
    assert.ok((await pending()).some((item) => item.metadata?.command?.includes("terraform apply")), "still pending")
    checks.push("model-classifier-escalates-risky-command")
    for (const item of await pending()) await runtime.api(`/permission/${item.id}/reply`, { reply: "reject" })
    await poll(() => plain().includes("AUTO_DONE") && !plain().includes("Permission required"), "turn finished")
    await Bun.sleep(500)
    await run("always-approve")
    await rendered("always-approve ·")
    await run("auto")
    await rendered("auto ·")
    assert.ok(!plain().includes("always-approve ·"))
    checks.push("auto-replaces-always-approve")
    console.log(JSON.stringify({ checks, output: runtime.output }, null, 2))
  } else if (windowFlow) {
    await run("context-window")
    await rendered("Context window")
    assert.ok(plain().includes("100k") && plain().includes("50k") && plain().includes("100 "))
    checks.push("context-window-lists-model-sizes")
    child.terminal.write("\x1b")
    await Bun.sleep(300)
    await run("context-window 2M")
    await rendered("Unsupported context window")
    checks.push("context-window-rejects-unsupported")
    await run("context-window 50000")
    await rendered("Context window set to 50k")
    child.terminal.write("CW_PROMPT")
    await rendered("CW_PROMPT")
    child.terminal.write("\r")
    const users = async () =>
      (await runtime.api(`/session/${session.id}/message`)).filter((item) => item.info.role === "user")
    await poll(
      async () => (await users()).some((item) => item.info.model.contextWindow === 50000),
      "prompt carries 50k",
    )
    checks.push("prompt-carries-session-window")
    await poll(async () => (await runtime.api(`/session/${session.id}/message`)).at(-1)?.info.time?.completed, "reply")
    await run("context-window 100")
    await rendered("compacting to fit")
    await poll(
      async () =>
        (await runtime.api(`/session/${session.id}/message`)).some((item) =>
          item.parts.some((part) => part.type === "compaction"),
        ),
      "auto-compact started",
    )
    checks.push("smaller-than-usage-starts-auto-compact")
    console.log(JSON.stringify({ checks, output: runtime.output }, null, 2))
  } else if (vimConfig) {
    await Bun.sleep(500)
    child.terminal.write("\x1b")
    await rendered("Scrollback: j/k scroll")
    child.terminal.write("i")
    await Bun.sleep(300)
    checks.push("config-ui-vim-mode-enables-scrollback")
    await run("vim-mode")
    await rendered("Vim mode off")
    await Bun.sleep(300)
    child.terminal.write("\x1b")
    await Bun.sleep(800)
    assert.ok(!plain().includes("Scrollback: j/k scroll"), "local toggle overrides config")
    checks.push("local-toggle-overrides-config")
    console.log(JSON.stringify({ checks, output: runtime.output }, null, 2))
    process.exitCode = 0
  } else {
    await run("context")
    await rendered("Context")
    assert.match(plain(), /Window: |No model response/)
    checks.push("context-dialog")
    await escape()

    await run("history")
    await rendered("Prompt history")
    assert.ok(plain().includes("SLASH_HELLO first prompt"))
    checks.push("history-lists-session-prompts")
    await escape()

    await run("effort high")
    await poll(() => /Effort set to|not available|no effort levels/.test(plain()), "effort toast")
    checks.push("effort-with-argument")

    await run("view-plan")
    await rendered("No saved plan for this session yet")
    checks.push("view-plan-empty")
    await escape()

    await run("doctor")
    await rendered("Doctor")
    assert.ok(plain().includes("Server: "))
    checks.push("doctor")
    await escape()

    await run("tour")
    await rendered("Your first prompt")
    checks.push("tutorial-alias")
    await escape()

    await run("prefs")
    await rendered("Permissions:")
    checks.push("settings-alias")
    await escape()

    await run("plan")
    await rendered("Plan mode")
    checks.push("plan-mode")

    await run("ml")
    await rendered("Multiline on")
    child.terminal.write("MLA")
    await rendered("MLA")
    await Bun.sleep(200)
    child.terminal.write("\r")
    await Bun.sleep(200)
    child.terminal.write("MLB")
    await rendered("MLB")
    // Both halves are still in the composer on separate lines: Enter inserted a newline instead of sending.
    assert.match(plain(), /MLA\s*┃?\s*\n.*MLB/)
    child.terminal.write("\x1b\r")
    await poll(async () => {
      const messages = await (await fetch(`${runtime.url}/session/${session.id}/message`)).json()
      return messages.some((m) => m.parts?.some((p) => p.type === "text" && p.text === "MLA\nMLB"))
    }, "multiline message sent with Alt+Enter")
    checks.push("multiline-enter-newline-alt-enter-sends")
    await run("ml")
    await rendered("Multiline off")

    await run("vim-mode")
    await rendered("Vim mode on")
    await Bun.sleep(300)
    child.terminal.write("\x1b")
    await rendered("Scrollback: j/k scroll")
    child.terminal.write("y")
    await poll(() => /Message copied|Failed to copy/.test(plain()), "y copies the last assistant message")
    child.terminal.write("j")
    child.terminal.write("k")
    child.terminal.write("x")
    // A bare letter leaves the scrollback and is typed into the prompt.
    await poll(() => /┃\s+>\s+x\s/.test(plain()), "x typed into prompt")
    checks.push("vim-mode-scrollback-keys")
    child.terminal.write("\x7f")
    await Bun.sleep(200)
    await run("vim-mode")
    await rendered("Vim mode off")

    // /compact-mode removes the blank spacer rows between transcript blocks.
    const rows = () => {
      const lines = plain().split("\n")
      const user = lines.findIndex((line) => line.includes("SLASH_HELLO"))
      const reply = lines.findIndex((line, index) => index > user && line.includes("GOAL_UI_WORK_COMPLETED"))
      return reply - user
    }
    await run("view-plan")
    await Bun.sleep(300)
    child.terminal.write("\x1b")
    await Bun.sleep(300)
    const before = rows()
    await run("compact-mode")
    await rendered("Compact display on")
    await poll(() => rows() < before, `compact spacing (${before} rows before)`)
    checks.push(`compact-mode-tightens-spacing:${before}->${rows()}`)
    await run("compact-mode")
    await rendered("Compact display off")
    await poll(() => rows() === before, "spacing restored")

    await run("delete")
    await rendered("Delete this session's history?")
    child.terminal.write("\r")
    await poll(async () => (await fetch(`${runtime.url}/session/${session.id}`)).status === 404, "session deleted")
    checks.push("delete-confirmed")
    console.log(JSON.stringify({ checks, output: runtime.output }, null, 2))
  }
} finally {
  const snapshot = plain()
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "slash-tui.txt"), snapshot)
  terminal.dispose()
  await runtime.close()
  console.error(`Slash TUI evidence: ${runtime.output}`)
}
