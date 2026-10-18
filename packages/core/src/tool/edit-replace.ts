/**
 * Shared edit replacement engine for the V1 (compatibility) and V2 (native)
 * edit tools. The fuzzy correction approaches are sourced from
 * https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
 * https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
 * https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts
 * The not-found guidance mirrors Grok Build's search_replace tool.
 */
export * as EditReplace from "./edit-replace"

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>

// Similarity thresholds for block anchor fallback matching
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.65
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.65

/**
 * Levenshtein distance algorithm implementation
 */
function levenshtein(a: string, b: string): number {
  // Handle empty strings
  if (a === "" || b === "") {
    return Math.max(a.length, b.length)
  }
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find
}

export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true

    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim()
      const searchTrimmed = searchLines[j].trim()

      if (originalTrimmed !== searchTrimmed) {
        matches = false
        break
      }
    }

    if (matches) {
      let matchStartIndex = 0
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1
      }

      let matchEndIndex = matchStartIndex
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length
        if (k < searchLines.length - 1) {
          matchEndIndex += 1 // Add newline character except for the last line
        }
      }

      yield content.substring(matchStartIndex, matchEndIndex)
    }
  }
}

export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines.length < 3) {
    return
  }

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length
  const maxLineDelta = Math.max(1, Math.floor(searchBlockSize * 0.25))

  // Collect all candidate positions where both anchors match
  const candidates: Array<{ startLine: number; endLine: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) {
      continue
    }

    // Look for the matching last line after this first line
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        const actualBlockSize = j - i + 1
        if (Math.abs(actualBlockSize - searchBlockSize) <= maxLineDelta) {
          candidates.push({ startLine: i, endLine: j })
        }
        break // Only match the first occurrence of the last line
      }
    }
  }

  // Return immediately if no candidates
  if (candidates.length === 0) {
    return
  }

  // Handle single candidate scenario (using relaxed threshold)
  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    const actualBlockSize = endLine - startLine + 1

    let similarity = 0
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2) // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        const distance = levenshtein(originalLine, searchLine)
        similarity += (1 - distance / maxLen) / linesToCheck

        // Exit early when threshold is reached
        if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
          break
        }
      }
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0
    }

    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      let matchStartIndex = 0
      for (let k = 0; k < startLine; k++) {
        matchStartIndex += originalLines[k].length + 1
      }
      let matchEndIndex = matchStartIndex
      for (let k = startLine; k <= endLine; k++) {
        matchEndIndex += originalLines[k].length
        if (k < endLine) {
          matchEndIndex += 1 // Add newline character except for the last line
        }
      }
      yield content.substring(matchStartIndex, matchEndIndex)
    }
    return
  }

  // Calculate similarity for multiple candidates
  let bestMatch: { startLine: number; endLine: number } | null = null
  let maxSimilarity = -1

  for (const candidate of candidates) {
    const { startLine, endLine } = candidate
    const actualBlockSize = endLine - startLine + 1

    let similarity = 0
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2) // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        const distance = levenshtein(originalLine, searchLine)
        similarity += 1 - distance / maxLen
      }
      similarity /= linesToCheck // Average similarity
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0
    }

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = candidate
    }
  }

  // Threshold judgment
  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const { startLine, endLine } = bestMatch
    let matchStartIndex = 0
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1
    }
    let matchEndIndex = matchStartIndex
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length
      if (k < endLine) {
        matchEndIndex += 1
      }
    }
    yield content.substring(matchStartIndex, matchEndIndex)
  }
}

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim()
  const normalizedFind = normalizeWhitespace(find)

  // Handle single line matches
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line
    } else {
      // Only check for substring matches if the full line doesn't match
      const normalizedLine = normalizeWhitespace(line)
      if (normalizedLine.includes(normalizedFind)) {
        // Find the actual substring in the original line that matches
        const words = find.trim().split(/\s+/)
        if (words.length > 0) {
          const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
          try {
            const regex = new RegExp(pattern)
            const match = line.match(regex)
            if (match) {
              yield match[0]
            }
          } catch {
            // Invalid regex pattern, skip
          }
        }
      }
    }
  }

  // Handle multi-line matches
  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length)
      if (normalizeWhitespace(block.join("\n")) === normalizedFind) {
        yield block.join("\n")
      }
    }
  }
}

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split("\n")
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
    if (nonEmptyLines.length === 0) return text

    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(/^(\s*)/)
        return match ? match[1].length : 0
      }),
    )

    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join("\n")
  }

  const normalizedFind = removeIndentation(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndentation(block) === normalizedFind) {
      yield block
    }
  }
}

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapeString = (str: string): string => {
    return str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, capturedChar) => {
      switch (capturedChar) {
        case "n":
          return "\n"
        case "t":
          return "\t"
        case "r":
          return "\r"
        case "'":
          return "'"
        case '"':
          return '"'
        case "`":
          return "`"
        case "\\":
          return "\\"
        case "\n":
          return "\n"
        case "$":
          return "$"
        default:
          return match
      }
    })
  }

  const unescapedFind = unescapeString(find)

  // Try direct match with unescaped find string
  if (content.includes(unescapedFind)) {
    yield unescapedFind
  }

  // Also try finding escaped versions in content that match unescaped find
  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    const unescapedBlock = unescapeString(block)

    if (unescapedBlock === unescapedFind) {
      yield block
    }
  }
}

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  // This replacer yields all exact matches, allowing the replace function
  // to handle multiple occurrences based on replaceAll parameter
  let startIndex = 0

  while (true) {
    const index = content.indexOf(find, startIndex)
    if (index === -1) break

    yield find
    startIndex = index + find.length
  }
}

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim()

  if (trimmedFind === find) {
    // Already trimmed, no point in trying
    return
  }

  // Try to find the trimmed version
  if (content.includes(trimmedFind)) {
    yield trimmedFind
  }

  // Also try finding blocks where trimmed content matches
  const lines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")

    if (block.trim() === trimmedFind) {
      yield block
    }
  }
}

export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split("\n")
  if (findLines.length < 3) {
    // Need at least 3 lines to have meaningful context
    return
  }

  // Remove trailing empty line if present
  if (findLines[findLines.length - 1] === "") {
    findLines.pop()
  }

  const contentLines = content.split("\n")

  // Extract first and last lines as context anchors
  const firstLine = findLines[0].trim()
  const lastLine = findLines[findLines.length - 1].trim()

  // Find blocks that start and end with the context anchors
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue

    // Look for the matching last line
    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() === lastLine) {
        // Found a potential context block
        const blockLines = contentLines.slice(i, j + 1)
        const block = blockLines.join("\n")

        // Check if the middle content has reasonable similarity
        // (simple heuristic: at least 50% of non-empty lines should match when trimmed)
        if (blockLines.length === findLines.length) {
          let matchingLines = 0
          let totalNonEmptyLines = 0

          for (let k = 1; k < blockLines.length - 1; k++) {
            const blockLine = blockLines[k].trim()
            const findLine = findLines[k].trim()

            if (blockLine.length > 0 || findLine.length > 0) {
              totalNonEmptyLines++
              if (blockLine === findLine) {
                matchingLines++
              }
            }
          }

          if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
            yield block
            break // Only match the first occurrence
          }
        }
        break
      }
    }
  }
}

export function trimDiff(diff: string): string {
  const lines = diff.split("\n")
  const contentLines = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )

  if (contentLines.length === 0) return diff

  let min = Infinity
  for (const line of contentLines) {
    const content = line.slice(1)
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/)
      if (match) min = Math.min(min, match[1].length)
    }
  }
  if (min === Infinity || min === 0) return diff
  const trimmedLines = lines.map((line) => {
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      const prefix = line[0]
      const content = line.slice(1)
      return prefix + content.slice(min)
    }
    return line
  })

  return trimmedLines.join("\n")
}

export interface ReplaceResult {
  /** File content after the replacement. */
  readonly content: string
  /** Number of replaced spans. */
  readonly replacements: number
  /** The exact file span that matched; differs from oldString when a fuzzy strategy matched. */
  readonly matched: string
  /** Name of the strategy that produced the match. */
  readonly strategy: string
}

export class ReplaceError extends Error {
  constructor(
    readonly reason: "identical" | "empty" | "not-found" | "multiple" | "disproportionate",
    message: string,
  ) {
    super(message)
    this.name = "ReplaceError"
  }
}

const REPLACERS: ReadonlyArray<readonly [string, Replacer]> = [
  ["exact", SimpleReplacer],
  ["line-trimmed", LineTrimmedReplacer],
  ["block-anchor", BlockAnchorReplacer],
  ["whitespace-normalized", WhitespaceNormalizedReplacer],
  ["indentation-flexible", IndentationFlexibleReplacer],
  ["escape-normalized", EscapeNormalizedReplacer],
  ["trimmed-boundary", TrimmedBoundaryReplacer],
  ["context-aware", ContextAwareReplacer],
  ["multi-occurrence", MultiOccurrenceReplacer],
]

const countExact = (content: string, search: string) => {
  let count = 0
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    count++
    offset += search.length
  }
  return count
}

/**
 * Runs the exact match first, then the fuzzy correction strategies in order
 * (line-trimmed, block-anchor, whitespace-normalized, indentation-flexible,
 * escape-normalized, trimmed-boundary, context-aware). A strategy only applies
 * when it resolves to a unique span (or replaceAll is set). Throws ReplaceError
 * with Grok Build style guidance (nearest match line, Unicode typography hint)
 * when nothing matches.
 */
export function replaceDetailed(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): ReplaceResult {
  if (oldString === newString) {
    throw new ReplaceError("identical", "No changes to apply: oldString and newString are identical.")
  }
  if (oldString === "") {
    throw new ReplaceError(
      "empty",
      "oldString cannot be empty when editing an existing file. Provide the exact text to replace, or use write for an intentional full-file replacement.",
    )
  }

  let notFound = true

  for (const [strategy, replacer] of REPLACERS) {
    for (const search of replacer(content, oldString)) {
      if (search === "") continue
      const index = content.indexOf(search)
      if (index === -1) continue
      notFound = false
      if (isDisproportionateMatch(search, oldString)) {
        throw new ReplaceError(
          "disproportionate",
          "Refusing replacement because the matched span is much larger than oldString. Re-read the file and provide the full exact oldString for the intended replacement.",
        )
      }
      if (replaceAll) {
        return {
          content: content.replaceAll(search, () => newString),
          replacements: countExact(content, search),
          matched: search,
          strategy,
        }
      }
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) {
        // Grok Build: an exact multi-match is ambiguous; never fall through to a fuzzier strategy.
        if (strategy === "exact") break
        continue
      }
      return {
        content: content.substring(0, index) + newString + content.substring(index + search.length),
        replacements: 1,
        matched: search,
        strategy,
      }
    }
  }

  if (notFound) {
    throw new ReplaceError(
      "not-found",
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings." +
        nearestMatchHint(content, oldString) +
        confusableHint(content, oldString),
    )
  }
  throw new ReplaceError(
    "multiple",
    "Found multiple matches for oldString. Provide more surrounding context to make the match unique, or set replaceAll to true.",
  )
}

export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  return replaceDetailed(content, oldString, newString, replaceAll).content
}

function isDisproportionateMatch(search: string, oldString: string) {
  const oldLines = oldString.split("\n").length
  const searchLines = search.split("\n").length
  if (searchLines >= Math.max(oldLines + 3, oldLines * 2)) return true
  if (oldLines === 1) return false
  return search.trim().length > Math.max(oldString.trim().length + 500, oldString.trim().length * 4)
}

/**
 * Grok Build `build_nearest_match_hint`: the first file line containing the
 * longest whitespace-separated token of oldString's first line, capped at 200
 * characters.
 */
export function nearestMatchHint(content: string, oldString: string): string {
  const keyword = (oldString.split("\n")[0] ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .reduce((best, word) => (word.length > best.length ? word : best), "")
  if (!keyword) return ""
  const lines = content.split("\n")
  const index = lines.findIndex((line) => line.includes(keyword))
  if (index === -1) return ""
  const full = `\n\nNearest match: line ${index + 1}: ${lines[index].trimEnd()}`
  return full.length > 200 ? `${full.slice(0, 197)}...` : full
}

/** Grok Build CONFUSABLE_MAP: typography characters that render like ASCII. */
export const CONFUSABLES: ReadonlyArray<readonly [string, string]> = [
  ["\u201C", '"'],
  ["\u201D", '"'],
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u2014", "--"],
  ["\u2013", "-"],
  ["\u2026", "..."],
  ["\u00A0", " "],
]
const confusableMap = new Map(CONFUSABLES)

export const normalizeConfusables = (text: string) => {
  let out = ""
  for (const char of text) out += confusableMap.get(char) ?? char
  return out
}

/**
 * Grok Build `build_confusable_hint`: when the miss is explained by Unicode
 * typography in the file, list the affected lines (max 8 shown) of the region
 * that would match after confusable normalization. Returns "" otherwise so no
 * false guidance is given.
 */
export function confusableHint(content: string, oldString: string): string {
  const chars = Array.from(content)
  if (!chars.some((char) => confusableMap.has(char))) return ""
  // offsets[i] = index in `content` (UTF-16) of the char producing normalized position i; final entry = content.length
  const offsets: number[] = []
  let normalized = ""
  let position = 0
  for (const char of chars) {
    const replacement = confusableMap.get(char) ?? char
    for (let i = 0; i < replacement.length; i++) offsets.push(position)
    normalized += replacement
    position += char.length
  }
  offsets.push(content.length)
  const needle = normalizeConfusables(oldString)
  if (!needle) return ""
  const start = normalized.indexOf(needle)
  if (start === -1) return ""
  const originalStart = offsets[start]
  const originalEnd = offsets[start + needle.length]
  const startLine = content.slice(0, originalStart).split("\n").length
  const endLine = content.slice(0, Math.max(originalStart, originalEnd - 1) + 1).split("\n").length
  const affected: number[] = []
  content.split("\n").forEach((line, index) => {
    const lineNumber = index + 1
    if (lineNumber < startLine || lineNumber > endLine) return
    if (Array.from(line).some((char) => confusableMap.has(char))) affected.push(lineNumber)
  })
  if (affected.length === 0) return ""
  const MAX = 8
  const summary =
    affected.length <= MAX
      ? affected.join(", ")
      : `${affected.slice(0, MAX).join(", ")} (and ${affected.length - MAX} more)`
  return (
    `\n\nThe nearest matching region contains Unicode typography characters (smart quotes, em-dashes, etc.) on lines ${summary} ` +
    "that look identical to ASCII in read output but differ at the byte level. Re-read the file and use a shorter oldString anchored on nearby ASCII-only context, or use bash with a short script to edit the file directly."
  )
}
