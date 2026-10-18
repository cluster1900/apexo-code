export * as BashApproval from "./bash-approval"

import { BashArity } from "../permission/arity"

/**
 * Parser-based approval reduction for the V2 bash tool, modelled on Grok Build's
 * bash grant rules (xai-grok-workspace permission/grants + bash_command_splitting):
 *
 * - A script is split into plain commands at `&&`, `||`, `;`, `|`, `&` and newlines.
 *   Only "word-only" scripts are decomposed. Command/process substitution, subshells,
 *   groups, heredocs, control keywords, variable expansion and file redirects make the
 *   script opaque, and then the whole raw script is both the permission resource and
 *   the only grant that "Always allow" may persist (an exact grant).
 * - Each segment is checked on its own after peeling wrappers (`timeout`, `nice`,
 *   `env`, leading `NAME=value`). Setup commands (`cd`, `export`, `sleep`, ...) need no
 *   grant, like Grok Build's `is_setup_command`.
 * - "Always allow" saves a reusable command prefix per segment, chosen by BashArity
 *   (`git status *`, `npm run dev *`). Dangerous verbs (`rm`, `chmod`, `kill`, `git push`,
 *   ...) and exec vehicles (`python`, `bash`, `sudo`, `npx`, `docker`, ...) are pinned to
 *   the exact command, and `gh` is scoped to group + action, as in Grok Build.
 */

export type ShellKind = "posix" | "powershell" | "cmd"

export type Segment = { readonly words: readonly string[]; readonly text: string }

export type Approval = {
  /** Permission resources: one per non-setup command, or the raw script when opaque. */
  readonly resources: readonly string[]
  /** Patterns persisted by "Always allow". */
  readonly save: readonly string[]
  /** Parsed segments; undefined when the script could not be decomposed. */
  readonly segments?: readonly Segment[]
}

export function shellKind(shell: string): ShellKind {
  const base = shell
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.exe$/, "")
  if (base === "powershell" || base === "pwsh") return "powershell"
  if (base === "cmd") return "cmd"
  return "posix"
}

const SETUP = new Set([
  "cd",
  "pushd",
  "popd",
  "export",
  "unset",
  "set",
  "sleep",
  "timeout",
  "chdir",
  "set-location",
  "push-location",
  "pop-location",
])
const KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "function",
  "select",
  "{",
  "}",
  "!",
  "[[",
  "]]",
  "coproc",
  "time",
])
const DANGEROUS = [
  "rm",
  "chmod",
  "chown",
  "chgrp",
  "chattr",
  "pkill",
  "kill",
  "killall",
  "git push",
  "remove-item",
  "del",
  "erase",
  "rd",
  "rmdir",
  "stop-process",
]
const EXEC_VEHICLES = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "deno",
  "bun",
  "julia",
  "rscript",
  "awk",
  "gawk",
  "mawk",
  "nawk",
  "nodejs",
  "luajit",
  "phpdbg",
  "php-cgi",
  "pythonw",
  "npx",
  "bunx",
  "pipx",
  "uvx",
  "uv",
  "xargs",
  "find",
  "sudo",
  "doas",
  "su",
  "ssh",
  "watch",
  "setsid",
  "flock",
  "chroot",
  "nsenter",
  "docker",
  "podman",
  "eval",
  "exec",
  "source",
  ".",
  "command",
  "builtin",
  "powershell",
  "pwsh",
  "cmd",
  "invoke-expression",
  "iex",
  "start-process",
])
const EXEC_FAMILIES = ["python", "node", "ruby", "perl", "php", "lua"]
const MAX_SEGMENTS = 32

export function head(words: readonly string[]) {
  const first = words[0]
  if (first === undefined) return undefined
  return first
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.exe$/, "")
}

export function isExecVehicle(words: readonly string[]) {
  const name = head(words)
  if (!name) return false
  if (EXEC_VEHICLES.has(name)) return true
  return EXEC_FAMILIES.some((family) => {
    if (!name.startsWith(family)) return false
    const rest = name.slice(family.length).replace(/t$/, "")
    return /^[\d.]*$/.test(rest)
  })
}

export function isDangerous(words: readonly string[]) {
  const name = head(words)
  if (!name) return false
  const joined = [name, ...words.slice(1)].join(" ")
  return DANGEROUS.some((prefix) => joined === prefix || joined.startsWith(prefix + " "))
}

const isAssignment = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)

/** Peel `NAME=value`, `env [-i] [NAME=value]...`, `timeout [opts] DURATION`, `nice [-n N]` wrappers. */
export function unwrap(words: readonly string[]): readonly string[] {
  let current = words
  for (let depth = 0; depth < 8; depth++) {
    let i = 0
    while (i < current.length && isAssignment(current[i]!)) i++
    if (i > 0) {
      current = current.slice(i)
      continue
    }
    const name = head(current)
    if (name === "env") {
      i = 1
      while (i < current.length && (current[i] === "-i" || current[i] === "--ignore-environment" || current[i] === "-"))
        i++
      if (current[i]?.startsWith("-")) return current // unknown env option: keep as-is (fails safe: env is not peeled)
      while (i < current.length && isAssignment(current[i]!)) i++
      if (i >= current.length) return current
      current = current.slice(i)
      continue
    }
    if (name === "timeout") {
      i = 1
      while (current[i]?.startsWith("-")) i += ["-k", "-s", "--kill-after", "--signal"].includes(current[i]!) ? 2 : 1
      if (i + 1 >= current.length) return current
      current = current.slice(i + 1)
      continue
    }
    if (name === "nice") {
      i = 1
      while (current[i]?.startsWith("-")) i += ["-n", "--adjustment"].includes(current[i]!) ? 2 : 1
      if (i >= current.length) return current
      current = current.slice(i)
      continue
    }
    return current
  }
  return current
}

export function isSetup(words: readonly string[]) {
  const name = head(words)
  return name === undefined || SETUP.has(name)
}

const SAFE_REDIRECT = /^(?:[012]?>&[012-]|[012]?>\/dev\/null|&>\/dev\/null|[012]?>>\/dev\/null|<\/dev\/null)$/

/**
 * Split a script into word-only commands. Returns undefined when the script uses a
 * construct whose effect cannot be reduced to plain argv (the script is then opaque).
 */
export function split(command: string, kind: ShellKind = "posix"): Segment[] | undefined {
  const segments: Segment[] = []
  let words: string[] = []
  let word = ""
  let inWord = false
  let quotedWord = false
  let start = 0
  const flushWord = () => {
    if (inWord) {
      if (!quotedWord && SAFE_REDIRECT.test(word)) {
        // Redirects to /dev/null or fd duplication carry no file side effect.
      } else words.push(word)
    }
    word = ""
    inWord = false
    quotedWord = false
  }
  const flushSegment = (end: number) => {
    flushWord()
    if (words.length) segments.push({ words, text: command.slice(start, end).trim() })
    words = []
  }
  const posix = kind === "posix"
  const escape = kind === "powershell" ? "`" : kind === "posix" ? "\\" : undefined
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    const next = command[i + 1]
    if (escape && ch === escape && kind === "posix") {
      if (next === undefined) return undefined
      if (next === "\n") {
        i++
        continue
      }
      word += next
      inWord = true
      i++
      continue
    }
    if (ch === "'" && kind !== "cmd") {
      const end = command.indexOf("'", i + 1)
      if (end < 0) return undefined
      word += command.slice(i + 1, end)
      inWord = true
      quotedWord = true
      i = end
      continue
    }
    if (ch === '"') {
      let j = i + 1
      let value = ""
      for (; j < command.length && command[j] !== '"'; j++) {
        const c = command[j]!
        if (posix && c === "\\" && j + 1 < command.length && '"\\$`\n'.includes(command[j + 1]!)) {
          value += command[++j]
          continue
        }
        if (kind === "powershell" && c === "`") return undefined
        if (c === "$" && kind !== "cmd") return undefined
        if (c === "`" && posix) return undefined
        if (c === "%" && kind === "cmd") return undefined
        value += c
      }
      if (j >= command.length) return undefined
      word += value
      inWord = true
      quotedWord = true
      i = j
      continue
    }
    if (ch === " " || ch === "\t") {
      flushWord()
      continue
    }
    if (ch === "\n" || ch === ";" || ch === "|" || ch === "&") {
      if (ch === "&" && inWord && /[0-9]?>$/.test(word)) {
        // fd duplication such as 2>&1 continues the current word.
        word += ch
        continue
      }
      if (ch === ";" && kind === "cmd") return undefined
      if (ch === "&" && next === ">" && posix) {
        word += ch
        inWord = true
        continue
      }
      flushSegment(i)
      if ((ch === "&" || ch === "|") && next === ch) i++
      start = i + 1
      continue
    }
    if (ch === ">" || ch === "<") {
      if (ch === "<" && next === "<") return undefined // heredoc / herestring
      word += ch
      inWord = true
      continue
    }
    if (posix && (ch === "$" || ch === "`" || ch === "(" || ch === ")" || ch === "{" || ch === "}")) return undefined
    if (
      kind === "powershell" &&
      (ch === "$" || ch === "(" || ch === ")" || ch === "{" || ch === "}" || ch === "@" || ch === "`")
    )
      return undefined
    if (kind === "cmd" && (ch === "%" || ch === "^" || ch === "(" || ch === ")" || ch === "!")) return undefined
    if (posix && ch === "#" && !inWord) {
      const end = command.indexOf("\n", i)
      flushSegment(i)
      if (end < 0) {
        start = command.length
        break
      }
      i = end - 1
      start = end
      continue
    }
    word += ch
    inWord = true
  }
  flushSegment(command.length)
  if (segments.length > MAX_SEGMENTS) return undefined
  for (const segment of segments) {
    // Any remaining redirect word writes or reads a file: opaque.
    if (segment.words.some((w) => /[<>]/.test(w))) return undefined
    if (posix && KEYWORDS.has(segment.words[0]!)) return undefined
    if (segment.words[0]?.startsWith("-")) return undefined
  }
  return segments
}

/** Whether `words.join(" ")` is a safe grant key: re-splitting yields the same argv, and no wildcard characters leak into the rule. */
const unambiguous = (words: readonly string[], kind: ShellKind) => {
  if (words.some((w) => w === "" || /[\s*?]/.test(w))) return false
  const again = split(words.join(" "), kind)
  return again?.length === 1 && again[0]!.words.join("\u0000") === words.join("\u0000")
}

/** "Always allow" scope (word count) for one command, per Grok Build's default_always_allow_scope with BashArity as the base scope. */
export function scope(words: readonly string[]): { readonly size: number; readonly prefix: boolean } {
  if (words.length === 0) return { size: 0, prefix: false }
  if (isDangerous(words) || isExecVehicle(words)) return { size: words.length, prefix: false }
  if (head(words) === "gh") {
    const [, group, verb] = words
    if (group && verb && !group.startsWith("-") && !verb.startsWith("-")) return { size: 3, prefix: true }
    return { size: words.length, prefix: false }
  }
  return { size: BashArity.prefix([...words]).length, prefix: true }
}

/** The pattern "Always allow" persists for one command. */
export function grant(words: readonly string[], kind: ShellKind = "posix"): string | undefined {
  const s = scope(words)
  const selected = words.slice(0, s.size)
  if (!unambiguous(selected, kind)) return undefined
  const key = kind === "posix" ? selected.join(" ") : [selected[0]!.toLowerCase(), ...selected.slice(1)].join(" ")
  return s.prefix ? `${key} *` : key
}

export function approval(command: string, kind: ShellKind = "posix"): Approval {
  const raw = command.trim()
  const opaque: Approval = { resources: [raw], save: [raw] }
  const segments = split(raw, kind)
  if (!segments || segments.length === 0) return opaque
  const resources: string[] = []
  const save: string[] = []
  for (const segment of segments) {
    const words = unwrap(segment.words)
    if (isSetup(words)) continue
    const normalized = kind === "posix" ? words : [words[0]!.toLowerCase(), ...words.slice(1)]
    const resource = normalized.join(" ")
    const key = grant(normalized, kind)
    // A command whose argv cannot round-trip as a grant falls back to an exact whole-script grant.
    if (!key || normalized.some((w) => /\s/.test(w))) return { ...opaque, segments }
    if (!resources.includes(resource)) resources.push(resource)
    if (!save.includes(key)) save.push(key)
  }
  if (resources.length === 0) return { ...opaque, segments }
  return { resources, save, segments }
}

/**
 * Process invocation for a configured shell. PowerShell gets an explicit
 * non-interactive -Command argv (no profile), cmd gets /d /s /c, POSIX shells get -c.
 */
export function invocation(
  shell: string,
  command: string,
): { readonly file: string; readonly args: readonly string[] } {
  const kind = shellKind(shell)
  if (kind === "powershell")
    return { file: shell, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] }
  if (kind === "cmd") return { file: shell, args: ["/d", "/s", "/c", command] }
  return { file: shell, args: ["-c", command] }
}
