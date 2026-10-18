export * as BashApproval from "./bash-approval"

import { ShellParser } from "./shell-parser"

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
      // Background `&` is not word-only in POSIX shells (Grok Build fails it closed); cmd uses `&` as a separator.
      if (ch === "&" && posix && next !== "&") return undefined
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
export function unambiguous(words: readonly string[], kind: ShellKind = "posix") {
  if (words.length === 0 || words.some((w) => w === "" || /[\s*?]/.test(w))) return false
  const again = split(words.join(" "), kind)
  return again?.length === 1 && again[0]!.words.join("\u0000") === words.join("\u0000")
}

// Grok Build exec_risk.rs SAFE_GIT_SUBCOMMANDS / GIT_QUERY_UNSAFE_OPTIONS.
const SAFE_GIT = new Set([
  "status",
  "branch",
  "log",
  "diff",
  "ls-files",
  "show",
  "rev-parse",
  "blame",
  "grep",
  "describe",
  "merge-base",
  "check-ignore",
  "check-attr",
  "cat-file",
  "ls-tree",
  "show-ref",
  "for-each-ref",
  "rev-list",
  "name-rev",
  "count-objects",
  "shortlog",
])
const GIT_UNSAFE_OPTIONS = ["--filters", "--textconv", "--output", "--ext-diff", "--open-files-in-pager"]
const RG_UNSAFE = new Set(["--pre", "--hostname-bin"])
const KUBECTL_UNSAFE = new Set([
  "--kubeconfig",
  "--context",
  "--cluster",
  "--server",
  "-s",
  "--token",
  "--user",
  "--as",
  "--as-group",
  "--as-uid",
  "--as-user-extra",
  "--username",
  "--password",
  "--client-certificate",
  "--client-key",
  "--certificate-authority",
])
const SAFE_PREFIXES = [
  "ls",
  "cat",
  "pwd",
  "date",
  "whoami",
  "hostname",
  "uptime",
  "grep",
  "rg",
  "kubectl get",
  "kubectl logs",
  "kubectl describe",
  "ps",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "tr",
  "cut",
  "echo",
  "printf",
]

const matchesPrefix = (command: string, prefix: string) => command === prefix || command.startsWith(prefix + " ")
const flagName = (word: string) => word.split("=")[0]!

function gitVerbIndex(words: readonly string[]) {
  let i = 1
  while (true) {
    const token = words[i]
    if (token === undefined || token === "-" || token === "--") return undefined
    if (!token.startsWith("-")) return i
    if (token === "-C") {
      i += 2
      continue
    }
    if ((token.startsWith("-C") && !token.startsWith("--")) || token === "--no-pager" || token === "-P") {
      i++
      continue
    }
    return undefined
  }
}

/** Grok Build git_words_are_read_only_query. */
export function gitReadOnly(words: readonly string[]) {
  if (words[0] !== "git") return false
  const verb = gitVerbIndex(words)
  if (verb === undefined || !SAFE_GIT.has(words[verb]!)) return false
  if (
    words
      .slice(1)
      .some((w) => flagName(w).length > 2 && GIT_UNSAFE_OPTIONS.some((full) => full.startsWith(flagName(w))))
  )
    return false
  if (words[verb] === "grep" && words.slice(1).some((w) => w.startsWith("-O"))) return false
  return true
}

function psDumpsEnvironment(words: readonly string[]) {
  if (head(words) !== "ps") return false
  let skip = false
  for (const s of words.slice(1)) {
    if (skip) {
      skip = false
      continue
    }
    if (s.startsWith("--format=") || s.startsWith("--sort=")) continue
    if (
      [
        "-o",
        "-O",
        "--format",
        "--sort",
        "-p",
        "-q",
        "-t",
        "-u",
        "-U",
        "-g",
        "-G",
        "-C",
        "-s",
        "--pid",
        "--ppid",
        "--sid",
        "--tty",
        "--user",
        "--group",
        "--cols",
        "--columns",
        "--width",
        "o",
        "O",
      ].includes(s)
    ) {
      skip = true
      continue
    }
    if (s.startsWith("-o") || s.startsWith("-O")) continue
    const bsd = s.startsWith("-") && !s.startsWith("--") && /[ax]/.test(s)
    if (s.includes("E") || (s.includes("e") && (!s.startsWith("-") || bsd))) return true
    if (s.startsWith("-") && !s.startsWith("--") && /[oO]$/.test(s)) skip = true
  }
  return false
}

/** Grok Build is_safe_command_words: the full invocation is a read-only safe-listed command. */
export function isSafe(words: readonly string[]) {
  if (words.length === 0) return false
  const name = head(words)
  if (name === "rg" && words.slice(1).some((w) => RG_UNSAFE.has(flagName(w)))) return false
  if (name === "kubectl" && words.slice(1).some((w) => KUBECTL_UNSAFE.has(flagName(w)))) return false
  if (psDumpsEnvironment(words)) return false
  if (words[0] === "git") return gitReadOnly(words)
  return SAFE_PREFIXES.some((prefix) => matchesPrefix(words.join(" "), prefix))
}

const isSafeString = (command: string) =>
  SAFE_PREFIXES.some((prefix) => matchesPrefix(command, prefix)) ||
  (command.startsWith("git ") && SAFE_GIT.has(command.slice(4).split(" ")[0]!))

/** Grok Build always_allow_scope_pinned: dangerous verbs, exec vehicles and `sed` offer only the full command. */
export function pinned(words: readonly string[]) {
  return isDangerous(words) || isExecVehicle(words) || head(words) === "sed"
}

function ghScope(words: readonly string[]) {
  if (head(words) !== "gh") return undefined
  const [, group, verb] = words
  return group && verb && !group.startsWith("-") && !verb.startsWith("-") ? 3 : words.length
}

/** Grok Build base_scope: safe-listed one/two-word command, else verb plus subcommand plus the flags that follow. */
export function baseScope(words: readonly string[]) {
  if (isSafe(words)) {
    if (words[0] && isSafeString(words[0])) return 1
    if (words.length >= 2 && isSafeString(words.slice(0, 2).join(" "))) return 2
  }
  let n = Math.min(words.length, 2)
  while (n < words.length && words[n]!.startsWith("-")) n++
  return n
}

/** Grok Build default_always_allow_scope. */
export function defaultScope(words: readonly string[]) {
  if (words.length === 0) return 0
  if (pinned(words)) return words.length
  return ghScope(words) ?? baseScope(words)
}

/** Grok Build minimum_always_allow_scope: the narrowest scope the picker may offer. */
export function minimumScope(words: readonly string[]) {
  if (pinned(words)) return words.length
  return ghScope(words) ?? 1
}

/** Grant key for the first `n` words. Non-pinned keys match by word-boundary prefix (`git status *`); pinned keys are exact. */
export function key(words: readonly string[], n: number, kind: ShellKind = "posix"): string | undefined {
  const selected = words.slice(0, n)
  if (!unambiguous(selected, kind)) return undefined
  const joined = kind === "posix" ? selected.join(" ") : [selected[0]!.toLowerCase(), ...selected.slice(1)].join(" ")
  return pinned(words) ? joined : `${joined} *`
}

/** Persistable scopes for one command, narrowest first (the Always allow picker's left/right range). */
export function scopes(words: readonly string[], kind: ShellKind = "posix") {
  const out: { readonly size: number; readonly key: string }[] = []
  for (let n = minimumScope(words); n <= words.length; n++) {
    const value = key(words, n, kind)
    if (value && !out.some((item) => item.key === value)) out.push({ size: n, key: value })
  }
  return out
}

/** The pattern "Always allow" persists by default for one command, or undefined when no scope round-trips. */
export function grant(words: readonly string[], kind: ShellKind = "posix"): string | undefined {
  const options = scopes(words, kind)
  if (!options.length) return undefined
  const wanted = defaultScope(words)
  return (options.find((item) => item.size >= wanted) ?? options.at(-1)!).key
}

export type Choice = { readonly label: string; readonly save: readonly string[] }

export type Approval = {
  /** Permission resources: one per non-setup command, or the raw script when opaque. */
  readonly resources: readonly string[]
  /** Patterns persisted by "Always allow" at the default scope. */
  readonly save: readonly string[]
  /** Scope picker for the primary command: each choice is a complete save set; `save` equals choices[defaultChoice]. */
  readonly choices?: readonly Choice[]
  readonly defaultChoice?: number
  /** True when the whole raw script is the only resource and grant (undecomposable or no grantable command). */
  readonly opaque: boolean
  /** Parsed segments; undefined when the script could not be decomposed. */
  readonly segments?: readonly Segment[]
}

export function fromSegments(
  command: string,
  segments: readonly Segment[] | undefined,
  kind: ShellKind = "posix",
): Approval {
  const raw = command.trim()
  const opaque: Approval = { resources: [raw], save: [raw], opaque: true }
  if (!segments || segments.length === 0 || segments.length > MAX_SEGMENTS) return opaque
  const commands: { words: readonly string[]; options: ReturnType<typeof scopes>; default: string }[] = []
  for (const segment of segments) {
    const words = unwrap(segment.words)
    if (isSetup(words)) continue
    const normalized = kind === "posix" ? words : [words[0]!.toLowerCase(), ...words.slice(1)]
    const value = grant(normalized, kind)
    // A command with no argv-unambiguous scope falls back to an exact whole-script grant.
    if (!value) return { ...opaque, segments }
    commands.push({ words: normalized, options: scopes(normalized, kind), default: value })
  }
  if (commands.length === 0) return { ...opaque, segments }
  const resources = [...new Set(commands.map((item) => item.words.join(" ")))]
  const rest = commands.slice(1).map((item) => item.default)
  const primary = commands[0]!
  const choices = primary.options.map((option) => ({
    label: option.key,
    save: [...new Set([option.key, ...rest])],
  }))
  const defaultChoice = Math.max(
    0,
    choices.findIndex((item) => item.label === primary.default),
  )
  return { resources, save: choices[defaultChoice]!.save, choices, defaultChoice, opaque: false, segments }
}

/** Synchronous approval using the hand parser (PowerShell/cmd, and the fallback when tree-sitter is unavailable). */
export function approval(command: string, kind: ShellKind = "posix"): Approval {
  return fromSegments(command, split(command.trim(), kind), kind)
}

/** Approval for a configured shell: POSIX scripts are parsed with tree-sitter bash like Grok Build; PowerShell/cmd use the hand parser. */
export async function analyze(command: string, kind: ShellKind = "posix"): Promise<Approval> {
  if (kind !== "posix") return approval(command, kind)
  const segments = await ShellParser.bashSegments(command.trim()).catch(() => split(command.trim(), kind))
  return fromSegments(command, segments, kind)
}

/** Whether a reply's chosen save set is one this request offered (a forged or widened selection persists nothing). */
export function offered(metadata: Record<string, unknown> | undefined, save: readonly string[]) {
  const choices = metadata?.alwaysChoices
  if (!Array.isArray(choices)) return false
  return choices.some(
    (choice) =>
      Array.isArray(choice?.save) &&
      choice.save.length === save.length &&
      choice.save.every((item: unknown, index: number) => item === save[index]),
  )
}

/** Request metadata carrying the scope picker to the CLI and Desktop prompts. */
export function metadata(approval: Approval) {
  if (!approval.choices || approval.choices.length < 2) return {}
  return { alwaysChoices: approval.choices, alwaysDefault: approval.defaultChoice ?? 0 }
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
