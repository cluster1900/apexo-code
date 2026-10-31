export type BrowserSlashCommand =
  | { action: "help"; message?: string }
  | { action: "open"; url: string; cdpUrl?: string }
  | { action: "observe" }
  | { action: "click"; selector: string }
  | { action: "type"; selector: string; text: string }
  | { action: "press"; key: string }
  | { action: "scroll"; x: number; y: number }
  | { action: "screenshot"; fullPage: boolean }
  | { action: "events"; after?: number; limit?: number }
  | { action: "close" }

const HELP =
  "Usage: /browser open <url> [--cdp-url <url>] | observe | click <selector> | type <selector> <text> | press <key> | scroll <x> <y> | screenshot [full] | events [after] [limit] | close"

export const browserTaskPrompt = (task: string) =>
  `Use the browser tool through Chrome DevTools Protocol for this request. User request: ${task.trim()}`

export function parseBrowserCommand(args = ""): BrowserSlashCommand {
  const tokens = tokenize(args)
  const action = tokens.shift()?.toLowerCase()
  if (!action) return { action: "help", message: HELP }

  if (action === "open") {
    const url = tokens.shift()
    if (!url) return { action: "help", message: `Usage: /browser open <url> [--cdp-url <url>]` }
    const cdpFlag = tokens.shift()
    const cdpUrl =
      cdpFlag === "--cdp-url" ? tokens.shift() : cdpFlag?.startsWith("--cdp-url=") ? cdpFlag.slice(10) : undefined
    if (cdpFlag === "--cdp-url" && !cdpUrl) return { action: "help", message: "Invalid --cdp-url value" }
    if (cdpFlag && cdpFlag !== "--cdp-url" && !cdpFlag.startsWith("--cdp-url="))
      return { action: "help", message: "Usage: /browser open <url> [--cdp-url <url>]" }
    return { action: "open", url, ...(cdpUrl ? { cdpUrl } : {}) }
  }

  if (action === "observe" || action === "snapshot") return { action: "observe" }
  if (action === "close") return { action: "close" }

  if (action === "click") {
    const selector = tokens.join(" ").trim()
    return selector ? { action: "click", selector } : { action: "help", message: "Usage: /browser click <selector>" }
  }

  if (action === "type") {
    const selector = tokens.shift()
    const text = tokens.join(" ").trim()
    if (!selector || !text) return { action: "help", message: "Usage: /browser type <selector> <text>" }
    return { action: "type", selector, text }
  }

  if (action === "press") {
    const key = tokens.join(" ").trim()
    return key ? { action: "press", key } : { action: "help", message: "Usage: /browser press <key>" }
  }

  if (action === "scroll") {
    const x = Number(tokens[0])
    const y = Number(tokens[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { action: "help", message: "Usage: /browser scroll <x> <y>" }
    return { action: "scroll", x, y }
  }

  if (action === "screenshot" || action === "capture")
    return { action: "screenshot", fullPage: tokens[0] === "full" || tokens[0] === "--full-page" }

  if (action === "events") {
    const after = tokens[0] === undefined ? undefined : Number(tokens[0])
    const limit = tokens[1] === undefined ? undefined : Number(tokens[1])
    if ((after !== undefined && !Number.isInteger(after)) || (limit !== undefined && !Number.isInteger(limit)))
      return { action: "help", message: "Usage: /browser events [after] [limit]" }
    return { action: "events", ...(after === undefined ? {} : { after }), ...(limit === undefined ? {} : { limit }) }
  }

  return { action: "help", message: `Unknown browser action: ${action}\n${HELP}` }
}

function tokenize(value: string) {
  const tokens: string[] = []
  let current = ""
  let quote: '"' | "'" | undefined
  let escaped = false

  for (const char of value.trim()) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/u.test(char)) {
      if (current) {
        tokens.push(current)
        current = ""
      }
      continue
    }
    current += char
  }

  if (escaped) current += "\\"
  if (current) tokens.push(current)
  return tokens
}
