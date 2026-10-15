export * as EnvBoolean from "./env-boolean"

/** Environment flags may opt in, explicitly opt out, or defer to configuration. */
export function parse(raw: string | undefined) {
  const value = raw?.trim().toLowerCase()
  if (["0", "false", "no", "off", "disabled"].includes(value ?? "")) return false
  if (["1", "true", "yes", "on", "enabled"].includes(value ?? "")) return true
  return undefined
}
