import type { RuntimeProfile, RuntimeProfileState } from "../preload/types"

// RuntimeFlags is captured when the backend starts. Preference changes must not
// claim to change that snapshot or interrupt sessions on the running backend.
export function createRuntimeProfile(input: {
  read: () => unknown
  write: (profile: RuntimeProfile) => void
  environment?: string
  supported: boolean
}) {
  const fallback = input.environment === "grok-build" ? "grok-build" : "apexo"
  const preferred = () => {
    const value = input.read()
    return value === "apexo" || value === "grok-build" ? value : fallback
  }
  const active = input.supported ? preferred() : null
  const get = (): RuntimeProfileState => ({ active, preferred: preferred(), supported: input.supported })
  return {
    get,
    set(value: unknown) {
      if (!input.supported) throw new Error("Runtime profile selection requires the bundled local backend")
      if (value !== "apexo" && value !== "grok-build") throw new Error("Invalid runtime profile")
      input.write(value)
      return get()
    },
  }
}
