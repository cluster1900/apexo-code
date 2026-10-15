export * as HookEnvironment from "./hook-environment"

export const reserved = [
  "GROK_HOOK_EVENT",
  "GROK_HOOK_NAME",
  "GROK_SESSION_ID",
  "GROK_WORKSPACE_ROOT",
  "CLAUDE_PROJECT_DIR",
]

// Consume complete modifier forms so nested references remain for the shell.
const references = /\$\{([^}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\$[^A-Za-z_{]/g

export function expand(input: string, extra: Record<string, string>, skip: readonly string[] = []) {
  return input.replace(references, (raw, braced: string | undefined, bare: string | undefined) => {
    const name = bare ?? braced
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return raw
    return extra[name] ?? (skip.includes(name) ? undefined : process.env[name]) ?? raw
  })
}

export function configured(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && !reserved.includes(entry[0]),
    ),
  )
}

export function prepare(hook: Record<string, unknown>) {
  const env = configured(hook.env)
  return {
    ...hook,
    env,
    ...(typeof hook.command === "string" ? { command: expand(hook.command, env, reserved) } : {}),
    ...(typeof hook.url === "string" ? { url: expand(hook.url, env, reserved) } : {}),
  }
}

export function unresolved(input: string, env: Record<string, string | undefined>) {
  const assigned = new Set(
    [...input.matchAll(/(?:^|[;&|\n({])[ \t]*([A-Za-z_][A-Za-z0-9_]*)=/g)].map((match) => match[1]),
  )
  for (const match of input.matchAll(/(?:^|[;&|\n({])[ \t]*read[ \t]+([^;&|\n<>]*)/g)) {
    for (const name of match[1]!.split(/[ \t]+/).filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
      assigned.add(name)
  }
  return [...input.matchAll(references)].flatMap((match) => {
    const name = match[2] ?? match[1]
    return name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && env[name] === undefined && !assigned.has(name) ? [name] : []
  })
}
