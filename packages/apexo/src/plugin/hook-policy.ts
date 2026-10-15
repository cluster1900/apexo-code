const policies = new WeakMap<object, { ask: boolean; rewritten: boolean; reason?: string }>()

export function policy(args: object) {
  return policies.get(args)
}

export function apply(args: Record<string, unknown>, result: Record<string, unknown>) {
  const previous = policies.get(args)
  const decision = result.permissionDecision
  if (decision === "defer") return
  const rewrite = result.updatedInput
  if (rewrite !== undefined && (!rewrite || typeof rewrite !== "object" || Array.isArray(rewrite)))
    throw new Error("Hook updatedInput must be an object")
  if (rewrite) {
    for (const key of Object.keys(args)) delete args[key]
    Object.defineProperties(args, Object.getOwnPropertyDescriptors(rewrite))
  }
  policies.set(args, {
    ask: previous?.ask === true || decision === "ask",
    rewritten: previous?.rewritten === true || rewrite !== undefined,
    reason: typeof result.permissionDecisionReason === "string" ? result.permissionDecisionReason : previous?.reason,
  })
}
