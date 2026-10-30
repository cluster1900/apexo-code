export type ComputerSlashCommand =
  | { action: "help"; message?: string }
  | { action: "open" }
  | { action: "observe" }
  | { action: "click"; x: number; y: number }
  | { action: "type"; text: string }
  | { action: "press"; key: string }
  | { action: "scroll"; y: number }
  | { action: "screenshot" }
  | { action: "events"; after?: number; limit?: number }
  | { action: "close" }

const HELP =
  "Usage: /computer [open] | observe | click <x> <y> | type <text> | press <key> | scroll <y> | screenshot | events [after] [limit] | close"

export function parseComputerCommand(args = ""): ComputerSlashCommand {
  const tokens = tokenize(args)
  const action = tokens.shift()?.toLowerCase()
  // `/computer` is the explicit manual trigger. Treat an omitted action as
  // `open` so both the slash palette and a hand-typed command enter the same
  // guarded Computer Use session.
  if (!action) return { action: "open" }
  if (action === "open") return { action: "open" }
  if (action === "observe" || action === "snapshot") return { action: "observe" }
  if (action === "close") return { action: "close" }
  if (action === "click") {
    const x = Number(tokens.shift())
    const y = Number(tokens.shift())
    return Number.isFinite(x) && Number.isFinite(y)
      ? { action: "click", x, y }
      : { action: "help", message: "Usage: /computer click <x> <y>" }
  }
  if (action === "type") {
    const text = tokens.join(" ").trim()
    return text ? { action: "type", text } : { action: "help", message: "Usage: /computer type <text>" }
  }
  if (action === "press") {
    const key = tokens.join(" ").trim()
    return key ? { action: "press", key } : { action: "help", message: "Usage: /computer press <key>" }
  }
  if (action === "scroll") {
    const y = Number(tokens[0])
    return Number.isFinite(y) ? { action: "scroll", y } : { action: "help", message: "Usage: /computer scroll <y>" }
  }
  if (action === "screenshot" || action === "capture") return { action: "screenshot" }
  if (action === "events") {
    const after = tokens[0] === undefined ? undefined : Number(tokens[0])
    const limit = tokens[1] === undefined ? undefined : Number(tokens[1])
    if ((after !== undefined && !Number.isInteger(after)) || (limit !== undefined && !Number.isInteger(limit)))
      return { action: "help", message: "Usage: /computer events [after] [limit]" }
    return { action: "events", ...(after === undefined ? {} : { after }), ...(limit === undefined ? {} : { limit }) }
  }
  return { action: "help", message: `Unknown computer action: ${action}\n${HELP}` }
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
      if (current) tokens.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (escaped) current += "\\"
  if (current) tokens.push(current)
  return tokens
}
