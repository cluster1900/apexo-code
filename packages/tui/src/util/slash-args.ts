import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Global } from "@apexo/core/global"
import { parseCopyArgs, resolveEffort } from "@apexo/sdk/v2/grok-commands"

/**
 * Argument handling for built-in slash commands that both the fullscreen TUI and minimal mode run locally
 * (Grok Build docs/user-guide/04-slash-commands.md: `/copy`, `/export`, `/model`).
 */

/**
 * `/copy` responses, oldest first: one per user turn, the source text of that turn's last assistant message that
 * has text. Assistant messages before the first user message form their own turn.
 */
export function turnResponses(messages: ReadonlyArray<{ role: string; text: string }>) {
  return messages
    .reduce<Array<string | undefined>>((turns, message) => {
      if (message.role === "user") return [...turns, undefined]
      if (message.role !== "assistant" || !message.text.trim()) return turns
      return turns.length ? [...turns.slice(0, -1), message.text.trim()] : [message.text.trim()]
    }, [])
    .filter((text): text is string => text !== undefined)
}

/** Grok's `GROK_COPY_FILE`: every copy is also saved here so text survives an unreachable clipboard. */
export function copyBackupFile() {
  return process.env.APEXO_COPY_FILE || path.join(Global.Path.data, "last-copy.txt")
}

/**
 * Runs `/copy [N] [path]` over `responses` (oldest first). Copies to the clipboard, or writes a new file when a path
 * is given; an existing file is refused and left unchanged. Every successful copy also overwrites the backup file.
 */
export async function copyResponse(input: {
  responses: readonly string[]
  args: string
  cwd: string
  write?: (text: string) => Promise<void>
  backup?: string
}): Promise<{ ok: boolean; message: string }> {
  const parsed = parseCopyArgs(input.args)
  if ("error" in parsed) return { ok: false, message: parsed.error }
  if (!input.responses.length) return { ok: false, message: "No assistant response to copy yet" }
  const text = input.responses[input.responses.length - parsed.index]
  if (text === undefined)
    return {
      ok: false,
      message: `Only ${input.responses.length} response${input.responses.length === 1 ? "" : "s"} to copy in this session`,
    }
  const backup = input.backup ?? copyBackupFile()
  if (parsed.path) {
    const written = await writeNewFile(parsed.path, text, input.cwd)
    if (!written.ok) return written
    await saveBackup(backup, text)
    return { ok: true, message: `Copied response to ${written.path}` }
  }
  const saved = await saveBackup(backup, text)
  const copied = input.write
    ? await input.write(text).then(
        () => true,
        () => false,
      )
    : false
  if (copied) return { ok: true, message: "Copied!" }
  return saved
    ? { ok: true, message: `Clipboard unavailable; the response was saved to ${backup}` }
    : { ok: false, message: "Failed to copy the response" }
}

/** Writes `content` to a file that must not exist yet (`~` and relative paths resolve against home and `cwd`). */
export async function writeNewFile(
  file: string,
  content: string,
  cwd: string,
): Promise<{ ok: true; path: string; message: string } | { ok: false; message: string }> {
  const target = resolveUserPath(file, cwd)
  await mkdir(path.dirname(target), { recursive: true }).catch(() => undefined)
  // `wx` refuses an existing file atomically, so a taken name is never truncated.
  return writeFile(target, content, { flag: "wx" }).then(
    () => ({ ok: true as const, path: target, message: `Wrote ${target}` }),
    (error: NodeJS.ErrnoException) => ({
      ok: false as const,
      message:
        error.code === "EEXIST"
          ? `${target} already exists; nothing was written`
          : `Could not write ${target}: ${error.message}`,
    }),
  )
}

function resolveUserPath(file: string, cwd: string) {
  const text = file.trim().replace(/^(["'])(.*)\1$/u, "$2")
  if (text === "~") return homedir()
  if (text.startsWith("~/")) return path.join(homedir(), text.slice(2))
  return path.resolve(cwd, text)
}

function saveBackup(file: string, text: string) {
  return mkdir(path.dirname(file), { recursive: true })
    .then(() => writeFile(file, text))
    .then(
      () => true,
      () => false,
    )
}

type ModelProvider = {
  id: string
  name?: string
  models: Record<string, { id?: string; name?: string; status?: string; variants?: Record<string, unknown> }>
}

/**
 * `/model <name> [effort]`: the model whose ID, display name or `provider/model` equals the text (ignoring case).
 * A trailing word that names an effort level of the matched model selects that effort too. Several matches prefer
 * the current provider; otherwise the text is ambiguous.
 */
export function resolveModelArgs(
  args: string,
  providers: readonly ModelProvider[],
  currentProviderID?: string,
):
  | { providerID: string; modelID: string; effort?: string }
  | { error: string } {
  const text = args.trim()
  const words = text.split(/\s+/u)
  const whole = matchModels(text, providers, currentProviderID)
  if (whole.length === 1) return whole[0]!
  const head = words.length > 1 ? matchModels(words.slice(0, -1).join(" "), providers, currentProviderID) : []
  if (head.length === 1) {
    const model = head[0]!
    const variants = Object.keys(providers.find((item) => item.id === model.providerID)?.models[model.modelID]?.variants ?? {})
    const effort = resolveEffort(words.at(-1)!, variants)
    if (effort) return { ...model, effort }
    return {
      error: variants.length
        ? `Effort "${words.at(-1)}" is not available for ${model.modelID}. Choose one of: ${variants.join(", ")}`
        : `${model.modelID} has no effort levels`,
    }
  }
  const ambiguous = whole.length > 1 ? whole : head
  if (ambiguous.length > 1)
    return {
      error: `"${text}" matches several models: ${ambiguous.map((item) => `${item.providerID}/${item.modelID}`).join(", ")}`,
    }
  return { error: `No model matches "${text}"` }
}

function matchModels(text: string, providers: readonly ModelProvider[], currentProviderID?: string) {
  const wanted = text.trim().toLowerCase()
  if (!wanted) return []
  const matches = providers.flatMap((provider) =>
    Object.entries(provider.models)
      .filter(([, info]) => info.status !== "deprecated")
      .filter(([modelID, info]) =>
        [modelID, info.name, `${provider.id}/${modelID}`].some((name) => name?.toLowerCase() === wanted),
      )
      .map(([modelID]) => ({ providerID: provider.id, modelID })),
  )
  if (matches.length < 2) return matches
  const current = matches.filter((item) => item.providerID === currentProviderID)
  return current.length === 1 ? current : matches
}
