/**
 * Grok Build `/model <name> [effort]`: the model named by ID, `provider/id` or display name (case-insensitive), plus an
 * optional trailing effort level. When several providers list the name, the current provider wins.
 */
export function resolveModelArgs<T extends { id: string; name: string; provider: { id: string } }>(
  args: string,
  models: T[],
  currentProvider?: string,
) {
  const text = args.trim()
  const named = (query: string) => {
    const wanted = query.toLowerCase()
    const matches = models.filter(
      (model) =>
        model.id.toLowerCase() === wanted ||
        `${model.provider.id}/${model.id}`.toLowerCase() === wanted ||
        model.name.toLowerCase() === wanted,
    )
    return matches.find((model) => model.provider.id === currentProvider) ?? matches[0]
  }
  const whole = text ? named(text) : undefined
  if (whole) return { model: whole }
  const words = text.split(/\s+/u)
  if (words.length < 2) return
  const model = named(words.slice(0, -1).join(" "))
  return model ? { model, effort: words.at(-1)! } : undefined
}
