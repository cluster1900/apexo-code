/**
 * Shared behavior for Grok Build slash commands that both the TUI and Desktop implement, so the two surfaces
 * parse arguments and render content identically. See docs/user-guide/04-slash-commands.md in grok-build.
 */

export type SlashInput = { name: string; args: string }

/** Splits `/name rest` into its command name and argument text; undefined when the text is not a slash command. */
export function parseSlashInput(text: string): SlashInput | undefined {
  const match = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/u.exec(text.trim())
  if (!match) return
  return { name: match[1]!, args: (match[2] ?? "").trim() }
}

export const effortLevels = ["low", "medium", "high", "xhigh"] as const

/**
 * Resolves `/effort <level>` against the current model's variants. Grok's levels are low/medium/high/xhigh;
 * Apexo models expose reasoning effort as variants, so a level selects the variant with the same name
 * (`xhigh` also matches `max`). Returns undefined when the model has no such variant.
 */
export function resolveEffort(level: string, variants: string[]): string | undefined {
  const wanted = level.trim().toLowerCase()
  if (!wanted) return
  const exact = variants.find((variant) => variant.toLowerCase() === wanted)
  if (exact) return exact
  if (wanted === "xhigh")
    return variants.find((variant) => ["max", "maximum", "extra-high"].includes(variant.toLowerCase()))
}

export const docsURL = "https://github.com/cluster1900/apexo-grok#readme"
export const docsGuides = [
  { title: "Getting Started", url: "https://github.com/cluster1900/apexo-grok#readme" },
  { title: "Goals", url: "https://github.com/cluster1900/apexo-grok/blob/main/docs/goal-feature.md" },
  { title: "Plugins", url: "https://github.com/cluster1900/apexo-grok/blob/main/docs/plugins-feature.md" },
  { title: "Memory", url: "https://github.com/cluster1900/apexo-grok/blob/main/docs/memory-v2-feature.md" },
  { title: "Workflows", url: "https://github.com/cluster1900/apexo-grok/blob/main/docs/workflow-management.md" },
] as const

/** `/docs`, `/docs web` and `/docs <title>`: the guide to open, or undefined for the picker. */
export function resolveDocs(args: string): { title: string; url: string } | undefined {
  const query = args.trim().toLowerCase()
  if (!query || query === "how-to") return
  if (query === "web") return { title: "Docs", url: docsURL }
  return (
    docsGuides.find((guide) => guide.title.toLowerCase() === query) ??
    docsGuides.find((guide) => guide.title.toLowerCase().includes(query))
  )
}

export function releaseNotesURL(version: string) {
  return /^\d+\.\d+\.\d+/u.test(version)
    ? `https://github.com/cluster1900/apexo-grok/releases/tag/v${version}`
    : "https://github.com/cluster1900/apexo-grok/releases"
}

/** `/tutorial`: short onboarding topics, rendered as a list on both surfaces. */
export const tutorialTopics = [
  {
    title: "Your first prompt",
    body: "Describe the change you want in plain language. Apexo reads the code, proposes edits and runs tools; you approve anything risky.",
  },
  {
    title: "Attaching context",
    body: "Type @ to attach files or folders, paste images, or use /resources to attach MCP resources.",
  },
  {
    title: "Navigation",
    body: "Use /sessions to switch sessions, /timeline to jump to a message, and /history to reuse an earlier prompt.",
  },
  {
    title: "Slash commands",
    body: "Type / to open the command menu. Built-in commands, plugin commands and user-invocable skills all appear there.",
  },
  {
    title: "Plan mode",
    body: "Run /plan to plan before editing, /view-plan to read the saved plan, then approve it to start building.",
  },
  {
    title: "Goals",
    body: "Run /goal <objective> [--budget N] to let Apexo work autonomously until independent reviewers verify the result.",
  },
  {
    title: "Customization",
    body: "Use /settings, /themes, /models, /effort and /agents. Plugins, hooks and skills extend Apexo further.",
  },
  {
    title: "Switching from another tool",
    body: "Apexo reads AGENTS.md and CLAUDE.md, Claude-style skills and plugins, and MCP servers from your config.",
  },
] as const

export type ContextUsage = {
  used: number
  limit: number
  input: number
  output: number
  reasoning: number
  cache: number
}

/**
 * `/context`: the context window split for the latest assistant turn. Tokens sent on the last request
 * (input + cache reads/writes) plus output and reasoning occupy the window; the rest is free.
 */
export function contextUsage(
  messages: Array<{
    role: string
    tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  }>,
  limit: number,
): ContextUsage | undefined {
  // The SDK targets ES2022, so no Array.prototype.findLast.
  const last = [...messages]
    .reverse()
    .find(
      (message) => message.role === "assistant" && message.tokens && message.tokens.input + message.tokens.output > 0,
    )
  if (!last?.tokens) return
  const { input, output, reasoning, cache } = last.tokens
  const cached = cache.read + cache.write
  return { used: input + cached + output + reasoning, limit, input, output, reasoning, cache: cached }
}

/** `/history`: this session's prompts, newest first, filtered by a case-insensitive fuzzy query. */
export function promptHistory(prompts: string[], query = "") {
  const needle = query.trim().toLowerCase()
  const seen = new Set<string>()
  return [...prompts].reverse().filter((prompt) => {
    const text = prompt.trim()
    if (!text || seen.has(text)) return false
    seen.add(text)
    return !needle || fuzzy(text.toLowerCase(), needle)
  })
}

function fuzzy(text: string, needle: string) {
  let at = 0
  for (const char of needle) {
    at = text.indexOf(char, at)
    if (at < 0) return false
    at++
  }
  return true
}

export type VimScrollAction =
  | "line.down"
  | "line.up"
  | "half.down"
  | "half.up"
  | "page.down"
  | "page.up"
  | "message.previous"
  | "message.next"
  | "first"
  | "last"
  | "copy.message"
  | "copy.transcript"
  | "prompt"

/**
 * Grok Build `/vim-mode`: vim-style scrollback keys (j/k, h/l, g/G, y/Y, Ctrl+D/U, Ctrl+F/B). `i`, `a`, Enter and
 * any other printable key return to the prompt (the character is typed there), matching the non-vim behavior.
 */
export function vimScrollAction(key: {
  name?: string
  char?: string
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
}): { action: VimScrollAction; type?: string } | undefined {
  if (key.alt) return
  const name = (key.name ?? "").toLowerCase()
  if (key.ctrl) {
    const ctrl: Record<string, VimScrollAction> = {
      d: "half.down",
      u: "half.up",
      f: "page.down",
      b: "page.up",
      e: "line.down",
      y: "line.up",
    }
    return ctrl[name] ? { action: ctrl[name] } : undefined
  }
  // Some synthetic and remote keyboards report Shift+g as key "g" with shift set; treat it as "G".
  const raw = key.char ?? (name.length === 1 ? name : undefined)
  const char = raw && key.shift && /^[a-z]$/.test(raw) ? raw.toUpperCase() : raw
  const map: Record<string, VimScrollAction> = {
    j: "line.down",
    k: "line.up",
    h: "message.previous",
    l: "message.next",
    g: "first",
    G: "last",
    y: "copy.message",
    Y: "copy.transcript",
  }
  if (name === "down") return { action: "line.down" }
  if (name === "up") return { action: "line.up" }
  if (name === "return" || name === "enter") return { action: "prompt" }
  if (!char || char.length !== 1) return
  if (map[char]) return { action: map[char] }
  if (char === "i" || char === "a") return { action: "prompt" }
  if (char >= " " && char !== "\x7f") return { action: "prompt", type: char }
}

/** `[ui] vim_mode` from config is the default; the local /vim-mode toggle overrides it once set. */
export function resolveVimMode(local: boolean | undefined, config: { ui?: { vim_mode?: boolean } } | undefined) {
  return local ?? config?.ui?.vim_mode ?? false
}

/** `ui.compact_mode` from config is the default; the local /compact-mode toggle overrides it once set. */
export function resolveCompactMode(
  local: boolean | undefined,
  config: { ui?: { compact_mode?: boolean } } | undefined,
) {
  return local ?? config?.ui?.compact_mode ?? false
}
