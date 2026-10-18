import type { Hooks } from "./registration.js"

export type ShellHooks = Hooks<{
  /** Add variables to the environment of shell commands the agent runs. Mutate `env`. */
  env: {
    readonly cwd: string
    readonly sessionID?: string
    readonly callID?: string
    env: Record<string, string>
  }
}>
