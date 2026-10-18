import { expect, test } from "bun:test"
import path from "node:path"
import { Glob } from "bun"

// Desktop (App) and CLI (TUI) must expose the same slash command names. This scans the command
// registrations in both source trees so a new name on one side fails until the other side has it too.
const packages = path.resolve(import.meta.dir, "../../..")

// Commands that only make sense on one surface. Keep the reason next to each entry.
const cliOnly: Record<string, string> = {
  editor: "opens $EDITOR for the prompt inside the terminal",
  q: "terminal shorthand for exit",
  warp: "experimental-workspaces flag only; changes the attached TUI workspace",
  move: "copies a session into another project directory; Desktop dialog not ported yet",
  slash: "TUI-internal slash palette",
  y: "TUI-internal confirmation binding",
}
const desktopOnly: Record<string, string> = {
  open: "opens files in Desktop editor tabs",
  terminal: "toggles the embedded Desktop terminal panel",
}

async function scan(dir: string, patterns: RegExp[]) {
  const names = new Set<string>()
  for await (const file of new Glob("**/*.{ts,tsx}").scan({ cwd: dir, absolute: true })) {
    if (file.includes(".test.") || file.includes(".stories.") || file.includes("/i18n/")) continue
    const text = await Bun.file(file).text()
    for (const pattern of patterns)
      for (const match of text.matchAll(pattern))
        for (const name of match[1].matchAll(/"([a-z][a-z0-9-]*)"/g)) names.add(name[1])
  }
  return names
}

async function surfaces() {
  const cli = await scan(path.join(packages, "tui/src"), [
    /slashName:\s*("[a-z0-9-]+")/g,
    /slashAliases:\s*\[([^\]]*)\]/g,
    /slash:\s*\{\s*name:\s*("[a-z0-9-]+")/g,
    /slash:\s*\{\s*name:\s*"[a-z0-9-]+",\s*aliases:\s*\[([^\]]*)\]/g,
    /\[("remember", "flush", "dream")\]\.map/g,
  ])
  const desktop = await scan(path.join(packages, "app/src"), [
    /slash:\s*("[a-z0-9-]+")/g,
    /slashAliases:\s*\[([^\]]*)\]/g,
  ])
  // Server commands (grok-build profile) are listed by the server and offered on both surfaces.
  const server = await Bun.file(path.join(packages, "apexo/src/command/index.ts")).text()
  const block = server.slice(server.indexOf('runtimeProfile === "grok-build"'))
  for (const name of ["imagine", "imagine-video", "loop", "memory", "remember", "flush", "dream"]) {
    if (!new RegExp(`(^|\\s|")${name}"?:|name: "${name}"`, "m").test(block)) continue
    cli.add(name)
    desktop.add(name)
  }
  return { cli, desktop }
}

test("Desktop and CLI slash commands correspond 1:1", async () => {
  const { cli, desktop } = await surfaces()

  expect([...cli].filter((name) => !desktop.has(name) && !(name in cliOnly)).sort()).toEqual([])
  expect([...desktop].filter((name) => !cli.has(name) && !(name in desktopOnly)).sort()).toEqual([])
  // Exemptions must stay truthful: a name implemented on both sides should be removed from the lists.
  expect(Object.keys(cliOnly).filter((name) => desktop.has(name))).toEqual([])
  expect(Object.keys(desktopOnly).filter((name) => cli.has(name))).toEqual([])
})

// Every command and alias in Grok Build's public user guide (docs/user-guide/04-slash-commands.md).
const grokBuild = (
  "new clear resume dashboard agents-dashboard sessions compact context session-info status info fork rewind undo " +
  "copy export quit exit home welcome delete rename title model m effort context-window always-approve auto " +
  "multiline ml history compact-mode vim-mode edit-prompt minimal fullscreen full plan view-plan show-plan " +
  "plan-view memory mem flush dream remember hooks plugins marketplace skills imagine imagine-video loop goal " +
  "deep-research workflow workflows theme t feedback btw mcps doctor terminal-setup terminal-check terminal-info " +
  "release-notes changelog docs howto guides tutorial tour onboarding import-claude config-agents agents personas " +
  "login logout usage cost privacy settings config preferences prefs timestamps"
).split(" ")
// Grok Build commands that only exist on one surface, with the reason. Everything else must be on both.
// Intentionally kept as opencode (Martha's decision): /login is an alias of the existing /connect provider flow and
// /logout removes stored provider credentials through the existing auth API (same as `apexo auth logout`); neither
// replicates Grok Build's xAI account login.
const grokSurfaceOnly: Record<string, string> = {
  minimal: "terminal inline vs alt-screen switch; chosen at launch with --fullscreen, cannot change at runtime",
  fullscreen: "same as minimal",
  full: "alias of fullscreen",
  privacy:
    "intentionally kept as opencode: no xAI account; account/privacy settings follow the opencode provider auth model",
}

test("every Grok Build slash command is available in both CLI and Desktop", async () => {
  const { cli, desktop } = await surfaces()
  const missing = grokBuild.filter((name) => !(name in grokSurfaceOnly) && (!cli.has(name) || !desktop.has(name)))
  expect(
    missing.map((name) => `${name} (${cli.has(name) ? "" : "cli "}${desktop.has(name) ? "" : "desktop"})`),
  ).toEqual([])
})
