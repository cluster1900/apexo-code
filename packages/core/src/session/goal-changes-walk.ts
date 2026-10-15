import { constants } from "node:fs"
import { lstat, open, opendir, realpath } from "node:fs/promises"
import path from "node:path"
import ignore from "ignore"
import type { SessionGoalChanges } from "./goal-changes"

const excluded = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".env",
  "target",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".parcel-cache",
  ".turbo",
  "vendor",
  "bower_components",
  ".tox",
  ".nox",
  ".eggs",
  ".idea",
  ".vscode",
  ".gradle",
  ".dart_tool",
  "coverage",
  ".nyc_output",
  "htmlcov",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
])
const fileLimit = 64 * 1024
const patchLimit = 256 * 1024

/** Bounded, cancellable fallback. This observes current files; it cannot reconstruct deleted or old content. */
export async function scan(
  input: {
    directory: string
    createdAt: number
    canRead: (absolute: string) => boolean
  },
  signal: AbortSignal,
): Promise<SessionGoalChanges.Capture> {
  const root = await realpath(input.directory)
  const state: SessionGoalChanges.Capture = {
    source: "mtime",
    status: "captured",
    reason: "Current files modified since Goal creation; prior content and deleted files cannot be recovered",
    files: [],
    patches: [],
    truncated: false,
    omitted: 0,
  }
  const limits = { entries: 0, names: 0, remaining: patchLimit }
  const walk = async (
    directory: string,
    inherited: { directory: string; rules: ReturnType<typeof ignore> }[],
    depth: number,
  ) => {
    signal.throwIfAborted()
    if (depth > 64 || (await realpath(directory)) !== directory)
      throw new Error("Unsafe or overly deep Goal evidence directory")
    const identity = await lstat(directory, { bigint: true })
    const rules = [...inherited]
    for (const name of [".gitignore", ".ignore", ...(depth === 0 ? [".git/info/exclude"] : [])]) {
      const target = path.join(directory, name)
      if (!input.canRead(target)) continue
      const file = await lstat(target).catch((error: unknown) => {
        if (missing(error)) return
        throw error
      })
      if (!file?.isFile() || file.isSymbolicLink()) continue
      const content = await readPrefix(target, signal)
      if (content.truncated) throw new Error("Goal evidence ignore file exceeds its size limit")
      rules.push({ directory, rules: ignore().add(content.bytes.toString("utf8")) })
    }
    for await (const entry of await opendir(directory)) {
      signal.throwIfAborted()
      if (++limits.entries > 100_000) throw new Error("Goal evidence directory entry limit exceeded")
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) continue
      if (entry.isDirectory() && excluded.has(entry.name.toLowerCase())) continue
      const absolute = path.join(directory, entry.name)
      const ignored = rules.reduce((previous, item) => {
        const relative =
          path.relative(item.directory, absolute).split(path.sep).join("/") + (entry.isDirectory() ? "/" : "")
        const match = item.rules.test(relative)
        return match.ignored ? true : match.unignored ? false : previous
      }, false)
      if (ignored) continue
      if (entry.isDirectory()) {
        await walk(absolute, rules, depth + 1)
        continue
      }
      const info = await lstat(absolute)
      if (!info.isFile() || info.nlink !== 1 || Math.floor(info.mtimeMs / 1000) < Math.floor(input.createdAt / 1000))
        continue
      if (!input.canRead(absolute)) {
        state.omitted++
        continue
      }
      const relative = path.relative(root, absolute).split(path.sep).join("/")
      limits.names += Buffer.byteLength(JSON.stringify(relative)) + 1
      if (limits.names > 2 * 1024 * 1024) throw new Error("Goal evidence file list limit exceeded")
      state.files.push(relative)
    }
    const after = await lstat(directory, { bigint: true })
    if (identity.ino !== after.ino || identity.dev !== after.dev || (await realpath(directory)) !== directory)
      throw new Error("Goal evidence directory changed while scanning")
  }
  await walk(root, [], 0)
  state.files.sort()
  if (!state.files.length)
    return { ...state, status: "unavailable", reason: "No readable files modified since Goal creation were found" }
  for (const file of state.files) {
    signal.throwIfAborted()
    if (!limits.remaining) {
      state.truncated = true
      break
    }
    const content = await readPrefix(path.join(root, file), signal)
    const header = `diff --git ${JSON.stringify(`a/${file}`)} ${JSON.stringify(`b/${file}`)}\n--- /dev/null\n+++ ${JSON.stringify(`b/${file}`)}\n`
    const text = new TextDecoder().decode(content.bytes, { stream: content.truncated })
    const lines = text.split(/(?<=\n)/)
    const raw = content.bytes.subarray(0, 8192).includes(0)
      ? `${header}Binary file differs (${content.size} bytes)\n`
      : `${header}@@ -0,0 +1,${text ? lines.length : 0} @@\n${text ? lines.map((line) => `+${line}`).join("") : ""}${text && !text.endsWith("\n") ? "\n\\ No newline at end of file\n" : ""}`
    const bytes = Buffer.from(raw)
    const cap = Math.min(fileLimit, limits.remaining)
    const truncated = content.truncated || bytes.length > cap
    const patch = new TextDecoder().decode(bytes.subarray(0, cap), { stream: bytes.length > cap })
    state.patches.push({
      files: [file],
      text: `${patch}${patch.endsWith("\n") ? "" : "\n"}${truncated ? "# File contents truncated\n" : ""}`,
    })
    state.truncated ||= truncated
    limits.remaining -= Math.min(cap, bytes.length)
  }
  return state
}

async function readPrefix(target: string, signal: AbortSignal) {
  signal.throwIfAborted()
  if ((await realpath(target)) !== target) throw new Error("Goal evidence does not follow links")
  await using file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  const before = await file.stat({ bigint: true })
  if (!before.isFile() || before.nlink !== 1n)
    throw new Error("Goal evidence requires a regular file without hard links")
  const bytes = Buffer.alloc(Math.min(Number(before.size), fileLimit + 1))
  const state = { count: 0 }
  while (state.count < bytes.length) {
    signal.throwIfAborted()
    const chunk = await file.read(bytes, state.count, bytes.length - state.count, state.count)
    if (!chunk.bytesRead) break
    state.count += chunk.bytesRead
  }
  const after = await lstat(target, { bigint: true })
  if (
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs ||
    state.count !== bytes.length ||
    (await realpath(target)) !== target
  )
    throw new Error("Goal evidence file changed while reading")
  return {
    bytes: bytes.subarray(0, Math.min(state.count, fileLimit)),
    size: before.size.toString(),
    truncated: before.size > BigInt(fileLimit),
  }
}

function missing(error: unknown) {
  return (
    typeof error === "object" && error !== null && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code))
  )
}

export * as SessionGoalWalk from "./goal-changes-walk"
