export * as ShellParser from "./shell-parser"

import { fileURLToPath } from "url"
import { Language, type Node, type Parser } from "web-tree-sitter"

// One tree-sitter loader (bash + PowerShell grammars) shared by the V2 bash tool and the legacy shell tool.

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  return fileURLToPath(new URL(asset, import.meta.url))
}

let loading: Promise<{ bash: Parser; ps: Parser }> | undefined

export function parsers() {
  loading ??= (async () => {
    const { Parser } = await import("web-tree-sitter")
    const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
      with: { type: "wasm" },
    })
    const treePath = resolveWasm(treeWasm)
    await Parser.init({
      locateFile() {
        return treePath
      },
    })
    const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
      with: { type: "wasm" },
    })
    const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
      with: { type: "wasm" },
    })
    const [bashLanguage, psLanguage] = await Promise.all([
      Language.load(resolveWasm(bashWasm)),
      Language.load(resolveWasm(psWasm)),
    ])
    const bash = new Parser()
    bash.setLanguage(bashLanguage)
    const ps = new Parser()
    ps.setLanguage(psLanguage)
    return { bash, ps }
  })().catch((error) => {
    loading = undefined
    throw error
  })
  return loading
}

export type Segment = { readonly words: readonly string[]; readonly text: string }

const SAFE_REDIRECT_TARGET = new Set(["/dev/null"])
const STRUCTURE = new Set(["program", "list", "pipeline", "redirected_statement", "comment"])

function dequote(node: Node): string | undefined {
  switch (node.type) {
    case "word":
    case "command_name":
    case "number": {
      if (node.type === "command_name") {
        const inner = node.namedChild(0)
        return inner ? dequote(inner) : node.text
      }
      // Unquoted backslash escapes: drop the backslash, keep the escaped character.
      return node.text.replace(/\\(.)/gs, "$1")
    }
    case "raw_string":
      return node.text.slice(1, -1)
    case "string": {
      // Double quotes are word-only only when every child is literal content.
      for (const child of node.namedChildren) if (child && child.type !== "string_content") return undefined
      return node.text.slice(1, -1).replace(/\\(["\\$`])/g, "$1")
    }
    case "concatenation": {
      let out = ""
      for (const child of node.namedChildren) {
        if (!child) return undefined
        const part = dequote(child)
        if (part === undefined) return undefined
        out += part
      }
      return out
    }
    default:
      return undefined
  }
}

function redirectIsSafe(node: Node) {
  // `2>&1`, `>&2`, `>/dev/null`, `2>/dev/null`, `&>/dev/null`, `</dev/null`
  if (node.type !== "file_redirect") return false
  const target = node.childForFieldName("destination") ?? node.namedChildren.at(-1)
  if (!target) return false
  if (target.type === "number" && /&$/.test(node.text.replace(target.text, "").trim())) return true
  const value = dequote(target)
  return value !== undefined && (SAFE_REDIRECT_TARGET.has(value) || (/^[012-]$/.test(value) && /&/.test(node.text)))
}

/**
 * Word-only command sequence from a bash tree, like Grok Build's try_parse_word_only_commands_sequence.
 * Returns undefined for anything that is not a chain of plain commands: substitutions, expansions,
 * subshells, groups, control flow, heredocs, background `&`, file redirects, or syntax errors.
 */
export function wordOnly(root: Node, source: string): Segment[] | undefined {
  if (root.hasError) return undefined
  const segments: Segment[] = []
  const visit = (node: Node): boolean => {
    if (node.type === "command") {
      const words: string[] = []
      for (const child of node.namedChildren) {
        if (!child) return false
        if (child.type === "variable_assignment") {
          const name = child.childForFieldName("name")?.text
          const value = child.childForFieldName("value")
          const literal = value ? dequote(value) : ""
          if (!name || literal === undefined) return false
          words.push(`${name}=${literal}`)
          continue
        }
        if (child.type === "file_redirect") {
          if (!redirectIsSafe(child)) return false
          continue
        }
        const word = dequote(child)
        if (word === undefined) return false
        words.push(word)
      }
      if (words.length) segments.push({ words, text: source.slice(node.startIndex, node.endIndex).trim() })
      return true
    }
    if (!STRUCTURE.has(node.type)) return false
    if (node.type === "comment") return true
    if (node.type === "redirected_statement") {
      for (const child of node.namedChildren) {
        if (!child) return false
        if (child.type === "file_redirect") {
          if (!redirectIsSafe(child)) return false
          continue
        }
        if (child.type === "heredoc_redirect" || child.type === "herestring_redirect") return false
        if (!visit(child)) return false
      }
      return true
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) return false
      if (!child.isNamed) {
        // Operators: && || ; | |& and newlines are sequence boundaries; background & is not word-only.
        if (child.type === "&") return false
        continue
      }
      if (!visit(child)) return false
    }
    return true
  }
  return visit(root) ? segments : undefined
}

export async function bashSegments(command: string): Promise<Segment[] | undefined> {
  const { bash } = await parsers()
  const tree = bash.parse(command)
  if (!tree) return undefined
  try {
    return wordOnly(tree.rootNode, command)
  } finally {
    tree.delete()
  }
}
