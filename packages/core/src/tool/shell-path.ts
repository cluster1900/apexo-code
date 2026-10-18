export * as ShellPath from "./shell-path"

import path from "path"
import type { BashApproval } from "./bash-approval"

/**
 * Path translation for the bash tool's external-directory advisories, per shell dialect:
 * POSIX `~`, PowerShell `$env:X` / `${env:X}` / `$HOME` / `$PWD` / `$PSHOME` / `~` and FileSystem provider paths,
 * cmd `%VAR%`, and on Windows MSYS/Cygwin drive paths (`/c/x`, `/cygdrive/c/x`) to native `C:\x`.
 * Dynamic arguments (substitutions, other variables, non-FileSystem providers) are skipped: the scan is advisory.
 */
export type Options = {
  readonly kind: BashApproval.ShellKind
  readonly cwd: string
  readonly home: string
  readonly shell: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly platform: NodeJS.Platform
}

const unquote = (text: string) =>
  text.length >= 2 && (text[0] === '"' || text[0] === "'") && text[0] === text.at(-1) ? text.slice(1, -1) : text

function envValue(env: Options["env"], key: string, platform: NodeJS.Platform) {
  if (platform !== "win32") return env[key]
  const name = Object.keys(env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? env[name] : undefined
}

function tilde(text: string, home: string, impl: typeof path.posix) {
  if (text === "~") return home
  if (text.startsWith("~/") || text.startsWith("~\\")) return impl.join(home, text.slice(2))
  return text
}

/** Native Windows form of an MSYS/Cygwin drive path, or the input unchanged. */
export function windowsPath(text: string) {
  const cyg = /^\/cygdrive\/([a-zA-Z])(?:\/(.*))?$/.exec(text)
  const msys = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(text)
  const match = cyg ?? msys
  if (!match) return text
  return `${match[1]!.toUpperCase()}:\\${(match[2] ?? "").replaceAll("/", "\\")}`
}

/** PowerShell provider-qualified path to a FileSystem path; undefined for other providers (Env:, HKLM:, Variable:). */
export function provider(text: string) {
  const qualified = /^(?:[A-Za-z.]+\\)?([A-Za-z]+)::(.*)$/.exec(text)
  if (qualified) return qualified[1]!.toLowerCase() === "filesystem" ? qualified[2] : undefined
  const drive = /^([A-Za-z]+):(.*)$/.exec(text)
  if (!drive || drive[1]!.length === 1) return text
  return undefined
}

function dynamic(text: string, kind: BashApproval.ShellKind) {
  if (text.startsWith("(") || text.startsWith("@(") || text.includes("$(") || text.includes("`")) return true
  if (kind === "powershell") return text.includes("$")
  if (kind === "cmd") return /%[^%]*%|!/.test(text)
  return text.includes("$")
}

/** Literal prefix before the first glob character; undefined when the token starts with one. */
function globPrefix(text: string) {
  const match = /[?*[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return undefined
  return text.slice(0, match.index)
}

/** Absolute path an argument names, or undefined if it is not a literal path. */
export function argument(token: string, options: Options): string | undefined {
  const win = options.platform === "win32"
  const impl = win ? path.win32 : path.posix
  let text = unquote(token).replace(/[;,|&]+$/, "")
  if (!text) return undefined
  if (options.kind === "powershell") {
    text = text
      .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(options.env, key, options.platform) ?? "\u0000")
      .replace(
        /\$env:([A-Za-z_][A-Za-z0-9_]*)/gi,
        (_, key: string) => envValue(options.env, key, options.platform) ?? "\u0000",
      )
      .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) =>
        key.toUpperCase() === "HOME"
          ? options.home
          : key.toUpperCase() === "PWD"
            ? options.cwd
            : impl.dirname(options.shell),
      )
    if (text.includes("\u0000")) return undefined
    text = tilde(text, options.home, impl)
    const next = provider(text)
    if (next === undefined) return undefined
    text = next
  } else if (options.kind === "cmd") {
    if (text.startsWith("/")) return undefined // cmd switches such as /s /q
    text = text.replace(
      /%([A-Za-z_][A-Za-z0-9_()]*)%/g,
      (_, key: string) => envValue(options.env, key, options.platform) ?? "\u0000",
    )
    if (text.includes("\u0000")) return undefined
  } else {
    text = tilde(text, options.home, impl)
  }
  if (dynamic(text, options.kind)) return undefined
  const literal = globPrefix(text)
  if (!literal) return undefined
  const native = win && options.kind === "posix" ? windowsPath(literal) : literal
  if (!impl.isAbsolute(native)) return undefined
  // A bare drive-relative `C:foo` is not absolute on win32; `\foo` is root-relative to the cwd drive.
  return impl.resolve(options.cwd, native)
}

const TOKENS = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g

/** Literal absolute paths named by a command's arguments (advisory only). */
export function paths(command: string, options: Options) {
  const out: string[] = []
  for (const token of command.match(TOKENS) ?? []) {
    const value = argument(token, options)
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}
