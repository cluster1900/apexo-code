import { parseSlashInput, sideQuestionText } from "@apexo/sdk/v2/grok-commands"

/**
 * A typed `/name args` the registered Desktop commands should run instead of the model. Server commands keep their own
 * route, and the prompt submit path itself routes `/goal <objective>`, `/remember <text>` and the bare memory jobs
 * once a session exists.
 */
export function registeredSlash(text: string, serverCommands: string[]) {
  const slash = parseSlashInput(text)
  if (!slash) return
  if (serverCommands.includes(slash.name)) return
  if (slash.name === "goal" || slash.name === "remember") return
  if ((slash.name === "flush" || slash.name === "dream") && !slash.args) return
  return slash
}

/**
 * `/btw` at the start or mid-message (Grok Build): the side question to ask, or undefined when the message is not one.
 * A bare `/btw` opens the side question with an empty draft.
 */
export function sideQuestion(text: string) {
  if (/^\/btw$/u.test(text.trim())) return ""
  return sideQuestionText(text)
}
