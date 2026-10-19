// Built-in slash commands typed into the minimal-mode footer.
//
// Minimal mode runs a subset of the fullscreen built-ins itself (footer routes, the prompt queue's /new, /exit and
// /fullscreen). Everything else used to fall through to the model as prompt text. Like Grok Build, a built-in that
// only the fullscreen interface can run now gets a one-line notice instead.
import { parseSlashInput } from "@apexo/sdk/v2/grok-commands"

/** Fullscreen built-ins (names and aliases) that minimal mode cannot run. */
const fullscreenOnly = new Set([
  "resume",
  "continue",
  "dashboard",
  "agents-dashboard",
  "sessions",
  "workspaces",
  "workspace",
  "agents",
  "agent",
  "config-agents",
  "personas",
  "mcp",
  "mcps",
  "resources",
  "connect",
  "status",
  "session-info",
  "info",
  "debug",
  "themes",
  "theme",
  "always-approve",
  "auto",
  "diff",
  "sandbox",
  "editor",
  "warp",
  "move",
  "rename",
  "title",
  "timeline",
  "fork",
  "compact",
  "summarize",
  "undo",
  "rewind",
  "redo",
  "timestamps",
  "toggle-timestamps",
  "thinking",
  "toggle-thinking",
  "export",
  "usage",
  "cost",
  "trace",
  "plugins",
  "marketplace",
  "tasks",
  "memory",
  "mem",
  "remember",
  "flush",
  "dream",
  "workflow",
  "workflows",
  "deep-research",
  "btw",
  "feedback",
  "hooks",
  "goal",
  "context",
  "delete",
  "history",
  "plan",
  "view-plan",
  "show-plan",
  "plan-view",
  "docs",
  "howto",
  "guides",
  "release-notes",
  "changelog",
  "tutorial",
  "tour",
  "onboarding",
  "doctor",
  "terminal-setup",
  "terminal-check",
  "terminal-info",
  "settings",
  "config",
  "preferences",
  "prefs",
  "multiline",
  "ml",
  "import-claude",
  "vim-mode",
  "compact-mode",
  "context-window",
  "logout",
])

export type MinimalSlash =
  | { type: "copy"; args: string }
  | { type: "model"; args: string }
  | { type: "effort"; args: string }
  | { type: "skills" }
  | { type: "commands" }
  | { type: "new" }
  | { type: "notice"; text: string }

/**
 * Classifies a slash command typed into the minimal footer that is not a server/footer command. Returns undefined
 * for anything that should keep its existing route (including unknown slash text).
 */
export function minimalSlash(text: string): MinimalSlash | undefined {
  const input = parseSlashInput(text)
  if (!input) return
  if (input.name === "copy") return { type: "copy", args: input.args }
  if (["model", "models", "m", "mo"].includes(input.name)) return { type: "model", args: input.args }
  if (["effort", "variants"].includes(input.name)) return { type: "effort", args: input.args }
  if (input.name === "skills") return { type: "skills" }
  if (["help", "commands"].includes(input.name)) return { type: "commands" }
  if (["clear", "home", "welcome"].includes(input.name)) return { type: "new" }
  if (input.name === "minimal") return { type: "notice", text: "Already in minimal mode." }
  if (fullscreenOnly.has(input.name))
    return {
      type: "notice",
      text: `/${input.name} isn't available in minimal mode. Run /fullscreen to switch this session.`,
    }
}
