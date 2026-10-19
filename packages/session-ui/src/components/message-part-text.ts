export function stripInlineThink(raw: string): string {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith("<think>")) return raw
  const withoutClosed = trimmed.replace(/^<think>[\s\S]*?<\/think>\s*/, "")
  if (withoutClosed !== trimmed) return withoutClosed
  return trimmed.replace(/^<think>[\s\S]*$/, "")
}

export function readPartText(
  accum: Record<string, string> | undefined,
  part: { id: string; type?: string; text?: string },
): string {
  const raw = accum?.[part.id] ?? part.text ?? ""
  const cleaned = part.type === "reasoning" ? raw : stripInlineThink(raw)
  return cleaned.trim()
}

